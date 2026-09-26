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
 * units strudel uses, so a pattern pasted from its docs shapes the light the
 * way it shaped the note.
 *
 * The release is the reason this is not a per-hap calculation in the tick: a
 * tail lives in the time after its step, where the pattern has no event at
 * all. So a faded pattern looks back as far as its longest tail when it is
 * queried, finds the steps that have ended recently, and lets the brightest of
 * them win.
 */

import { levelOf } from './dmx.js';
import { getBPM } from './scheduler.js';

/** The strudel classes this needs, handed over by eval.ts once strudel loads. */
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

/** One stage's length: in beats (gobo's names) or seconds (strudel's). */
export interface Span {
  amount: number;
  unit: 'beats' | 'seconds';
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
 * lighting reading of strudel's decay on a plucked note.
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

/** Parse strudel's "attack:decay:sustain:release" string. */
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
    const a = cyclesOf(merged.attack, bpm);
    const d = cyclesOf(merged.decay, bpm);
    const r = Math.min(cyclesOf(merged.release, bpm), MAX_TAIL_CYCLES);
    const from = Fraction(t - r);
    const to = Fraction(t + 1e-6);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const haps: any[] = src.query(state.setSpan(new TimeSpan(from, to)));
    let best: number | null = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let bestHap: any = null;
    for (const hap of haps) {
      const level = levelOf(hap.value);
      if (level === null) continue;
      let shaped: number | null;
      if (!hap.whole) {
        // A continuous signal has no steps to shape: it passes through while
        // it is sounding, which is at t.
        shaped = hap.part.begin.valueOf() <= t && t < hap.part.end.valueOf() ? level : null;
      } else {
        const f = shapedLevel(t, hap.whole.begin.valueOf(), hap.whole.end.valueOf(), a, d, merged.sustain, r);
        shaped = f === null ? null : level * f;
      }
      if (shaped !== null && (best === null || shaped > best)) {
        best = shaped;
        bestHap = hap;
      }
    }
    return best === null ? [] : [new Hap(undefined, span, best, bestHap.context)];
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const faded = new Pattern((state: any) => {
    const begin = state.span.begin.valueOf();
    const end = state.span.end.valueOf();
    if (end - begin <= SAMPLE_CYCLES) return sampleAt(state, begin, state.span);
    // A wide query (a punchcard or roll drawing a whole cycle) gets one sample
    // per slice, so the picture shows the fades rather than one flat block.
    const out: unknown[] = [];
    for (let b = begin; b < end; b += SAMPLE_CYCLES) {
      const e = Math.min(end, b + SAMPLE_CYCLES);
      out.push(...sampleAt(state, b, new TimeSpan(Fraction(b), Fraction(e))));
    }
    return out;
  });
  (faded as Faded)[SOURCE] = { source, shape: merged };
  return faded;
}

/** Read a stage length a scene wrote, or say what it should have been. */
function amountOf(v: unknown, what: string, unit: string): number {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) {
    throw new Error(`${what} takes a length in ${unit}, 0 or more, as in ${what}(0.5).`);
  }
  return n;
}

/**
 * Put the fade methods on strudel's Pattern prototype.
 *
 * Strudel's attack, decay, sustain, release and adsr are replaced rather than
 * joined: on a pattern they only ever attached a field a light ignores, so a
 * scene that used them did nothing, and now it fades. Nothing inside strudel
 * calls them; they exist for code a person writes.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function installFades(kit: StrudelKit, proto: any): void {
  const stage = (key: 'attack' | 'decay' | 'release', unit: 'beats' | 'seconds', name: string) =>
    function (this: unknown, v: unknown) {
      const amount = amountOf(v, `.${name}`, unit);
      return fade(kit, this, { [key]: { amount, unit } });
    };
  // Not hold or drop, which read well for light but are strudel's own
  // methods (a hold on the value, and dropping steps) and in use.
  proto.fadeIn = stage('attack', 'beats', 'fadeIn');
  proto.fadeOut = stage('release', 'beats', 'fadeOut');
  proto.settle = function (this: unknown, beats: unknown, level: unknown = 0) {
    const amount = amountOf(beats, '.settle', 'beats');
    const held = amountOf(level, '.settle', 'a level from 0 to 1 as its second argument');
    return fade(kit, this, { decay: { amount, unit: 'beats' }, sustain: Math.min(1, held) });
  };
  proto.attack = stage('attack', 'seconds', 'attack');
  proto.decay = stage('decay', 'seconds', 'decay');
  proto.release = stage('release', 'seconds', 'release');
  proto.sustain = function (this: unknown, v: unknown) {
    const level = amountOf(v, '.sustain', 'a level from 0 to 1');
    return fade(kit, this, { sustain: Math.min(1, level) });
  };
  proto.adsr = function (this: unknown, spec: unknown) {
    return fade(kit, this, parseAdsr(spec));
  };
}
