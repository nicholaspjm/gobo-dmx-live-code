/**
 * Pattern-level inline viz registry (flash / glow / wave).
 *
 * Distinct from the fixture-level `.viz('color' | 'wave' | ...)` registry in
 * fixtures.ts. That one decorates an entire fixture line with a summary
 * widget; this one decorates an individual *pattern expression* where the
 * user chained `.flash()`, `.glow()`, or `.wave()`.
 *
 * Flow:
 *   1. At eval time, every `.flash() / .glow() / .wave()` call pushes an
 *      entry into _registry with a ref to the pattern that produced it and,
 *      when known, the call's offset in the document.
 *   2. After eval, the UI layer places each entry at its offset. Entries
 *      without one are matched to `.flash(`, `.glow(`, `.wave(` call sites in
 *      top-to-bottom order (as fixtures' .viz() does, which avoids stack
 *      parsing).
 *   3. On each scheduler tick, the UI samples each entry's pattern at the
 *      current cycle position and updates its editor decoration (background
 *      gradient, flash pulse, or sparkline).
 *
 * `.flash()` / `.glow()` / `.wave()` return the pattern itself, so the chain
 * continues and the result can still go into a fixture setter on the same
 * line.
 */

import type { PatternLike } from './dmx.js';

/**
 * What a pattern-level decoration draws.
 *
 *   flash      the line pulses on each rising edge
 *   glow       the line's background tracks the value
 *   wave       a scrolling trace of recent values: the scope
 *   roll       the coming cycle as blocks, so the shape of a cue is visible
 *   punchcard  the cycle as a fixed grid of cells, for reading rhythm
 *   spiral     the cycle wound round, with the playhead sweeping it
 *   spectrum   which rates the recent values move at, for checking a strobe
 *
 * All are layerable: chaining two puts two widgets on the line, because each
 * call site is matched separately.
 */
export type PatternVizKind =
  | 'flash' | 'glow' | 'wave' | 'roll' | 'punchcard' | 'spiral' | 'spectrum';

export const PATTERN_VIZ_KINDS: readonly PatternVizKind[] =
  ['flash', 'glow', 'wave', 'roll', 'punchcard', 'spiral', 'spectrum'];

/**
 * Strudel's spellings of inline visuals gobo also has, so a pattern pasted from
 * its docs decorates instead of throwing. Strudel marks the inline form with a
 * leading underscore, and calls a wave a scope.
 *
 * Only names that mean the same thing for light as for sound. Strudel's
 * pianoroll is excluded because a lighting channel has no pitches; gobo's
 * equivalent is .roll(), and eval.ts's method hints point a pasted
 * ._pianoroll() at it.
 */
export const PATTERN_VIZ_ALIASES: Readonly<Record<string, PatternVizKind>> = {
  scope: 'wave',
  _scope: 'wave',
  _punchcard: 'punchcard',
  _spiral: 'spiral',
  _spectrum: 'spectrum',
};

/** The kind a viz method name registers as, or null if it is not one. */
export function patternVizKindOf(name: string): PatternVizKind | null {
  if ((PATTERN_VIZ_KINDS as readonly string[]).includes(name)) return name as PatternVizKind;
  return PATTERN_VIZ_ALIASES[name] ?? null;
}

/** Every method name that registers a pattern viz, for source scanners. */
export const PATTERN_VIZ_METHOD_NAMES: readonly string[] =
  [...PATTERN_VIZ_KINDS, ...Object.keys(PATTERN_VIZ_ALIASES)];

export interface PatternVizEntry {
  /** The pattern whose current value drives the decoration. */
  pattern: PatternLike;
  kind: PatternVizKind;
  /**
   * Where the call was written, as a character offset into the document.
   *
   * Pairing registrations with call sites by counting (the nth `.glow(` in the
   * text gets the nth registration) only works when every call site in the
   * buffer ran. In a file where looks are functions and only one is called, a
   * `.flash()` inside an uncalled look is a call site with no registration, so
   * counting would draw the running look's widget on a look that is not
   * running.
   *
   * Undefined when the call could not be tagged, in which case the UI falls
   * back to counting. A scene evaluated outside the editor has no offsets.
   */
  at?: number;
}

const _registry: PatternVizEntry[] = [];

export function registerPatternViz(pattern: PatternLike, kind: PatternVizKind, at?: number): void {
  _registry.push({ pattern, kind, at });
}

/** Cleared by evalCode before each run. */
export function clearPatternVizRegistry(): void {
  _registry.length = 0;
}

/** UI-side: read in top-to-bottom order to match source scan order. */
export function getPatternVizEntries(): readonly PatternVizEntry[] {
  return _registry;
}

/**
 * A pattern's value at one instant on the cycle timeline.
 *
 * Brightest wins among the events live at that instant, matching what the DMX
 * layer does with the same haps. Reading only the first event would make the
 * decoration disagree with the light beside it whenever anything is layered.
 */
export function samplePattern(pattern: PatternLike, cyclePos: number): number {
  try {
    const events = pattern.queryArc(cyclePos, cyclePos + 0.0001);
    if (!events || events.length === 0) return 0;
    let best = 0;
    for (const e of events) {
      const v = levelOfHap((e as { value?: unknown })?.value);
      if (v !== null && v > best) best = v;
    }
    return best;
  } catch {
    return 0;
  }
}

/** Mirrors the DMX layer's reading of a hap, control objects included. */
function levelOfHap(v: unknown): number | null {
  if (typeof v === 'number') return v;
  if (v === null || typeof v !== 'object') return null;
  const inner = (v as { value?: unknown }).value;
  if (typeof inner !== 'number') return null;
  const gain = (v as { gain?: unknown }).gain;
  return typeof gain === 'number' ? inner * gain : inner;
}

/**
 * A hap's time as a number.
 *
 * Strudel keeps time in exact rational arithmetic, so `whole.begin` is a
 * Fraction object. A `typeof === 'number'` test fails for every event,
 * collapsing each to zero width and drawing the structural decorations as
 * hairlines. Number() takes the valueOf, and anything that will not convert
 * gets the fallback instead of NaN.
 */
function toTime(v: unknown, fallback: number): number {
  if (v === null || v === undefined) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** One event of a cycle, in cycle-relative 0-1 time. */
export interface PatternSpan {
  begin: number;
  end: number;
  value: number;
}

/**
 * Every event of one whole cycle, for the decorations that draw structure
 * across the cycle.
 *
 * Returned as plain spans so a widget can lay them out without knowing
 * pattern internals. A pattern that throws yields an empty list, so the
 * decoration survives.
 */
export function sampleCycle(pattern: PatternLike, cycle: number): PatternSpan[] {
  try {
    const start = Math.floor(cycle);
    const haps = pattern.queryArc(start, start + 1);
    if (!haps || haps.length === 0) return [];
    const out: PatternSpan[] = [];
    for (const h of haps) {
      const value = levelOfHap((h as { value?: unknown })?.value);
      if (value === null) continue;
      // A hap carries `whole` (the event's full extent) and `part` (the slice
      // this query returned). `whole` is what a person means by "the hit";
      // fall back to part, then to a point, so an unrecognised shape still
      // draws something.
      const hh = h as {
        whole?: { begin?: unknown; end?: unknown };
        part?: { begin?: unknown; end?: unknown };
      };
      const src = hh.whole ?? hh.part;
      const b = toTime(src?.begin, start);
      const e = toTime(src?.end, b);
      out.push({
        begin: Math.max(0, Math.min(1, b - start)),
        end: Math.max(0, Math.min(1, Math.max(e, b) - start)),
        value: Math.max(0, Math.min(1, value)),
      });
    }
    return out;
  } catch {
    return [];
  }
}
