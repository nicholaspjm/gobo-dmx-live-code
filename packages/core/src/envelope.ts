/**
 * Fades per step: how each hit of a pattern comes up, holds and goes out.
 *
 * A pattern on a channel is a gate. `mini('1 - 1 -')` is full for its step and
 * dark for the next, which is a bump button, and a chase built from it jumps.
 * A lighting desk gives every step of a chase a fade in and a fade out, and a
 * light that the chase has moved on from keeps glowing for a moment as it goes
 * out. That tail is most of what makes a chase look like one.
 *
 * Strudel has the same idea for sound: every note gets an envelope, attack,
 * decay, sustain and release. This is that envelope, ported to light:
 *
 *   .fadeIn(beats)          how long a step takes to come up         (attack)
 *   .settle(beats, level)   how it falls to the level it holds       (decay,
 *                           while the step lasts; level 0 by default  sustain)
 *                           makes every step a flash
 *   .fadeOut(beats)         how long it glows after the step ends    (release)
 *
 * In beats, because a lighting cue follows the music and the music's unit is
 * the beat: `.fadeOut(1)` is a one-beat tail at any tempo. Strudel's own names
 * (.attack .decay .sustain .release .adsr) do the same thing in seconds, the
 * units Strudel uses, so a pattern pasted from its docs shapes the light the
 * way it shaped the note.
 *
 * The release cannot be computed per hap in the tick: a tail lives in the
 * time after its step, where the pattern has no event. So a faded pattern
 * looks back as far as its longest tail when it is queried, finds the steps
 * that have ended recently, and lets the brightest of them win.
 */

import { levelOf } from './dmx.js';
import { getBPM } from './scheduler.js';
import { stringPattern } from './string-patterns.js';

/** The Strudel classes this needs, handed over by eval.ts once Strudel loads. */
export interface StrudelKit {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Pattern: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Hap: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  TimeSpan: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Fraction: any;
}

/** One stage's length: in beats (gobo's names) or seconds (Strudel's). */
export interface Span {
  amount: number;
  unit: 'beats' | 'seconds';
  /** A length that changes, as Strudel writes .release('<0.1 0.5>'): read
   *  at the start of each step. `amount` is unused when this is set. */
  pattern?: { queryArc(begin: number, end: number): Array<{ value: unknown }> };
}

/** The length a span gives a step starting at `when`. */
function spanAt(span: Span | undefined, when: number): Span | undefined {
  if (!span?.pattern) return span;
  return { amount: patternAmount(span.pattern, when, when + 1e-6), unit: span.unit };
}

/** The largest length a patterned span reaches over [from, to), for the look back. */
function patternAmount(p: NonNullable<Span['pattern']>, from: number, to: number): number {
  let most = 0;
  try {
    for (const hap of p.queryArc(from, to)) {
      const n = levelOf(hap.value) ?? Number(hap.value);
      if (Number.isFinite(n) && n > most) most = n;
    }
  } catch {
    // A length that cannot be read counts as 0.
  }
  return most;
}

/** The shape of every step's fade. Absent stages are instant. */
export interface Shape {
  attack?: Span;
  decay?: Span;
  /** 0..1, the level held after the decay. */
  sustain?: number;
  release?: Span;
}

/** A stage's length in cycles at the current tempo. One cycle is four beats. */
export function cyclesOf(span: Span | undefined, bpm: number): number {
  if (!span || !(span.amount > 0)) return 0;
  return span.unit === 'beats' ? span.amount / 4 : (span.amount * bpm) / 240;
}

/**
 * The fade's level `dt` cycles into a step, before any release.
 *
 * With no decay the step holds full after its attack. With a decay and no
 * sustain it falls to nothing, which turns every step into a flash: the
 * lighting reading of Strudel's decay on a plucked note.
 */
export function stepLevel(dt: number, a: number, d: number, sustain: number | undefined): number {
  if (a > 0 && dt < a) return dt / a;
  const held = sustain ?? (d > 0 ? 0 : 1);
  if (d <= 0) return held;
  const x = dt - a;
  return x < d ? 1 - (1 - held) * (x / d) : held;
}

/**
 * The level at `t` of one step spanning [on, off), shaped by the stages
 * (already in cycles). Null when the step contributes nothing at `t`.
 */
export function shapedLevel(
  t: number,
  on: number,
  off: number,
  a: number,
  d: number,
  sustain: number | undefined,
  r: number,
): number | null {
  if (t < on) return null;
  if (t < off) return stepLevel(t - on, a, d, sustain);
  if (r <= 0) return null;
  const dt = t - off;
  if (dt >= r) return null;
  return stepLevel(off - on, a, d, sustain) * (1 - dt / r);
}

/** Parse Strudel's "attack:decay:sustain:release" string. */
export function parseAdsr(spec: unknown): Shape {
  const parts = String(spec).split(':').map((p) => Number(p.trim()));
  const [a, d, s, r] = parts;
  const shape: Shape = {};
  if (Number.isFinite(a)) shape.attack = { amount: a, unit: 'seconds' };
  if (Number.isFinite(d)) shape.decay = { amount: d, unit: 'seconds' };
  if (Number.isFinite(s)) shape.sustain = Math.max(0, Math.min(1, s));
  if (Number.isFinite(r)) shape.release = { amount: r, unit: 'seconds' };
  return shape;
}

/** Where a faded pattern keeps what it was made from and how, for chaining. */
const SOURCE = Symbol('gobo.fadeSource');

interface Faded {
  [SOURCE]?: { source: unknown; shape: Shape };
}

/** The gain a colour step carries (1 for a bare colour), which is its level. */
function carriedGain(v: unknown): number {
  if (v === null || typeof v !== 'object') return 1;
  const { gain, velocity } = v as { gain?: unknown; velocity?: unknown };
  return (typeof gain === 'number' ? gain : 1) * (typeof velocity === 'number' ? velocity : 1);
}

/** Longest look back for a tail, so a typo of 1000 beats cannot stall a tick. */
const MAX_TAIL_CYCLES = 16;

/** Finer than this, a query is one sample; coarser, it is cut into samples. */
const SAMPLE_CYCLES = 1 / 64;

/**
 * `pattern` with every step shaped by `shape`, merged with any shape it was
 * already given: `.fadeIn(1).fadeOut(2)` is one fade with both stages rather
 * than a fade of a fade.
 */
export function fade(kit: StrudelKit, pattern: unknown, shape: Shape): unknown {
  const previous = (pattern as Faded)[SOURCE];
  const source = previous ? previous.source : pattern;
  const merged: Shape = { ...(previous?.shape ?? {}), ...shape };
  const { Pattern, Hap, TimeSpan, Fraction } = kit;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const src = source as any;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sampleAt = (state: any, t: number, span: any): unknown[] => {
    const bpm = getBPM();
    // A patterned release looks back as far as the longest it reaches lately.
    const release = merged.release?.pattern
      ? { amount: patternAmount(merged.release.pattern, t - 2, t + 1e-6), unit: merged.release.unit }
      : merged.release;
    const r = Math.min(cyclesOf(release, bpm), MAX_TAIL_CYCLES);
    const patterned = !!(merged.attack?.pattern || merged.decay?.pattern || merged.release?.pattern);
    const from = Fraction(t - r);
    const to = Fraction(t + 1e-6);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wide: any[] = src.query(state.setSpan(new TimeSpan(from, to)));
    // A continuous signal has no steps to shape, and a query as wide as the
    // look back reads it at the far end of it: it is read again at t itself.
    // Only then, since the second query is most of the cost of a fade.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const haps: any[] = wide.every((h: any) => h.whole)
      ? wide
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      : [...wide.filter((h: any) => h.whole), ...src.query(state.setSpan(new TimeSpan(Fraction(t), to))).filter((h: any) => !h.whole)];
    let best: number | null = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let bestHap: any = null;
    for (const hap of haps) {
      // A colour step has no level of its own: it is full, and the fade
      // becomes a gain on it (see rgbOf in colors.ts).
      const level = levelOf(hap.value) ?? carriedGain(hap.value);
      let shaped: number | null;
      if (!hap.whole) {
        // A continuous signal has no steps to shape: it passes through while
        // it is sounding, which is at t.
        shaped = hap.part.begin.valueOf() <= t && t < hap.part.end.valueOf() ? level : null;
      } else {
        const on = hap.whole.begin.valueOf();
        // Each step reads its own lengths when they are patterned.
        const a = cyclesOf(patterned ? spanAt(merged.attack, on) : merged.attack, bpm);
        const d = cyclesOf(patterned ? spanAt(merged.decay, on) : merged.decay, bpm);
        const rs = patterned ? Math.min(cyclesOf(spanAt(merged.release, on), bpm), MAX_TAIL_CYCLES) : r;
        const f = shapedLevel(t, on, hap.whole.end.valueOf(), a, d, merged.sustain, rs);
        shaped = f === null ? null : level * f;
      }
      if (shaped !== null && (best === null || shaped > best)) {
        best = shaped;
        bestHap = hap;
      }
    }
    if (best === null) return [];
    // The step's own fields ride along with the faded level (a position from
    // .across(), a side from .jux()), so a group still places it. gain and
    // velocity are already folded into the level, so they go.
    const v = bestHap.value;
    let value: unknown = best;
    if (levelOf(v) === null) {
      // A colour, bare or carried: it keeps its fields, and the fade rides as
      // the gain. Any gain it had is already in `best`.
      const fields: Record<string, unknown> =
        v !== null && typeof v === 'object' && 'value' in v ? (v as Record<string, unknown>) : { value: v };
      const { gain: _gain, velocity: _velocity, ...rest } = fields;
      value = { ...rest, gain: best };
    } else if (v !== null && typeof v === 'object') {
      const { gain: _gain, velocity: _velocity, ...rest } = v as Record<string, unknown>;
      value = { ...rest, value: best };
    }
    return [new Hap(undefined, span, value, bestHap.context)];
  };

  // The last answer, for the same instant asked again: the red, green and
  // blue of one pixel all ask, and the look back is the expensive part.
  let memoBegin = NaN;
  let memoEnd = NaN;
  let memoBpm = NaN;
  let memo: unknown[] = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const faded = new Pattern((state: any) => {
    const begin = state.span.begin.valueOf();
    const end = state.span.end.valueOf();
    const bpm = getBPM();
    if (begin === memoBegin && end === memoEnd && bpm === memoBpm) return memo;
    memoBegin = begin;
    memoEnd = end;
    memoBpm = bpm;
    memo = end - begin <= SAMPLE_CYCLES ? sampleAt(state, begin, state.span) : sampleSpan(state, begin, end);
    return memo;
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function sampleSpan(state: any, begin: number, end: number): unknown[] {
    // A wide query (a punchcard or roll drawing a whole cycle) gets one sample
    // per slice, so the picture shows the fades rather than one flat block.
    const out: unknown[] = [];
    for (let b = begin; b < end; b += SAMPLE_CYCLES) {
      const e = Math.min(end, b + SAMPLE_CYCLES);
      out.push(...sampleAt(state, b, new TimeSpan(Fraction(b), Fraction(e))));
    }
    return out;
  }
  (faded as Faded)[SOURCE] = { source, shape: merged };
  return faded;
}

/** Every step of `pattern` held for `fraction` of its length, from its start. */
function shorten(kit: StrudelKit, pattern: unknown, fraction: number): unknown {
  const { Pattern, Hap, TimeSpan, Fraction } = kit;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const src = pattern as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new Pattern((state: any) => src.query(state).flatMap((hap: any) => {
    if (!hap.whole) return [hap];
    const begin = hap.whole.begin.valueOf();
    const end = begin + (hap.whole.end.valueOf() - begin) * fraction;
    if (hap.part.begin.valueOf() >= end) return [];
    const whole = new TimeSpan(hap.whole.begin, Fraction(end));
    const part = hap.part.end.valueOf() > end ? new TimeSpan(hap.part.begin, Fraction(end)) : hap.part;
    return [new Hap(whole, part, hap.value, hap.context)];
  }));
}

/** A length written as a pattern ('<0.1 0.5>', or a pattern itself), or null for a plain number. */
function lengthPattern(v: unknown, what: string): Span['pattern'] | null {
  if (v !== null && typeof v === 'object' && typeof (v as { queryArc?: unknown }).queryArc === 'function') {
    return v as Span['pattern'];
  }
  if (typeof v === 'string' && v.trim() !== '' && !Number.isFinite(Number(v))) {
    return (stringPattern(v, what) as Span['pattern']) ?? null;
  }
  return null;
}

/** Read a stage length a scene wrote, or say what it should have been. */
function amountOf(v: unknown, what: string, unit: string): number {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) {
    throw new Error(`${what} takes a length in ${unit}, 0 or more, as in ${what}(0.5).`);
  }
  return n;
}

/** Read a level a scene wrote (a sustain, a settle's hold), 0 to 1. */
function levelArg(v: unknown, what: string, example: string): number {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) {
    throw new Error(`${what} takes a level from 0 to 1, as in ${example}.`);
  }
  return n;
}

/**
 * Put the fade methods on Strudel's Pattern prototype.
 *
 * Strudel's attack, decay, sustain, release and adsr are replaced outright:
 * Strudel's versions only attach a field that a light ignores. Nothing inside
 * Strudel calls them; they exist for code a person writes.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function installFades(kit: StrudelKit, proto: any): void {
  const stage = (key: 'attack' | 'decay' | 'release', unit: 'beats' | 'seconds', name: string) =>
    function (this: unknown, v: unknown) {
      const pattern = lengthPattern(v, `.${name}`);
      if (pattern) return fade(kit, this, { [key]: { amount: 0, unit, pattern } });
      const amount = amountOf(v, `.${name}`, unit);
      return fade(kit, this, { [key]: { amount, unit } });
    };
  // hold and drop would read well for light, but they are Strudel's own
  // methods (a hold on the value, and dropping steps) and in use.
  proto.fadeIn = stage('attack', 'beats', 'fadeIn');
  proto.fadeOut = stage('release', 'beats', 'fadeOut');
  proto.settle = function (this: unknown, beats: unknown, level: unknown = 0) {
    const amount = amountOf(beats, '.settle', 'beats');
    const held = levelArg(level, '.settle', '.settle(0.25, 0.4)');
    return fade(kit, this, { decay: { amount, unit: 'beats' }, sustain: Math.min(1, held) });
  };
  proto.attack = stage('attack', 'seconds', 'attack');
  proto.decay = stage('decay', 'seconds', 'decay');
  proto.release = stage('release', 'seconds', 'release');
  proto.sustain = function (this: unknown, v: unknown) {
    const level = levelArg(v, '.sustain', '.sustain(0.5)');
    return fade(kit, this, { sustain: Math.min(1, level) });
  };
  proto.adsr = function (this: unknown, spec: unknown) {
    return fade(kit, this, parseAdsr(spec));
  };
  // How much of each step is lit. In Strudel .clip() and .legato() say how
  // long a note sounds against its step; for a light that is how long the
  // step stays on: '1*8'.clip(0.25) is eight short flashes, and a fade out
  // after it starts where the flash ends. Numbers only; a patterned length
  // keeps Strudel's own meaning.
  for (const name of ['clip', 'legato'] as const) {
    const own = proto[name];
    proto[name] = function (this: unknown, v: unknown, ...rest: unknown[]) {
      const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
      if (typeof n !== 'number' || !Number.isFinite(n) || rest.length > 0) {
        return typeof own === 'function' ? own.call(this, v, ...rest) : this;
      }
      return shorten(kit, this, Math.max(0, n));
    };
  }

  // Position across a group, in lighting words. It rides on Strudel's pan
  // control, which the group reads (fixtures.ts, placeAcross), so the two are
  // one thing; pan keeps its Strudel name for pasted code, and across is the
  // one a lighting scene uses, since pan on a moving head means the head.
  if (typeof proto.pan === 'function') {
    const pan = proto.pan;
    proto.across = function (this: unknown, position: unknown) {
      return pan.call(this, position);
    };
  }
}
