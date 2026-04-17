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
 *      entry into _registry with a ref to the pattern that produced it.
 *   2. After eval, the UI layer scans the doc for `.flash(`, `.glow(`,
 *      `.wave(` call sites in top-to-bottom order and zips 1:1 with the
 *      registry (same trick as fixtures' .viz() — avoids stack parsing).
 *   3. On each scheduler tick, the UI samples each entry's pattern at the
 *      current cycle position and updates its editor decoration (background
 *      gradient, flash pulse, or sparkline).
 *
 * The methods are non-chain-breaking: `.flash()` / `.glow()` / `.wave()`
 * return the pattern itself, so you can still pass it into a fixture setter
 * on the same line.
 */

import type { PatternLike } from './dmx.js';

export type PatternVizKind = 'flash' | 'glow' | 'wave';

export interface PatternVizEntry {
  /** The pattern whose current value drives the decoration. */
  pattern: PatternLike;
  kind: PatternVizKind;
}

const _registry: PatternVizEntry[] = [];

export function registerPatternViz(pattern: PatternLike, kind: PatternVizKind): void {
  _registry.push({ pattern, kind });
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
 * Sample a pattern's value at a point on the cycle timeline. Strudel patterns
 * return an array of events from queryArc; fallback/reactive patterns return
 * a single event. Either way we grab the first event's .value and clamp to
 * a number; anything non-numeric becomes 0.
 */
export function samplePattern(pattern: PatternLike, cyclePos: number): number {
  try {
    const events = pattern.queryArc(cyclePos, cyclePos + 0.0001);
    if (!events || events.length === 0) return 0;
    const v = events[0]?.value;
    return typeof v === 'number' ? v : 0;
  } catch {
    return 0;
  }
}

/**
 * Mutate an object to add `.flash() / .glow() / .wave()` methods. Used by
 * our fallback waveform and audio-reactive factories (we own those objects).
 * Strudel patterns get the same methods via a one-time prototype monkey-patch
 * inside initStrudel() so we don't pay Proxy overhead on every pattern eval.
 *
 * The `obj` parameter is typed loosely because these factories return mixed
 * PatternLike + chain-method shapes that TS can't easily describe; the cast
 * keeps the call sites clean at the cost of one `unknown` hop here.
 */
export function attachPatternVizMethods(obj: PatternLike): PatternLike {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const target = obj as any;
  target.flash = function flash() { registerPatternViz(this, 'flash'); return this; };
  target.glow  = function glow()  { registerPatternViz(this, 'glow');  return this; };
  target.wave  = function wave()  { registerPatternViz(this, 'wave');  return this; };
  return obj;
}
