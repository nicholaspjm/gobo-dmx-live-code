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
 *      registry (same trick as fixtures' .viz(), which avoids stack parsing).
 *   3. On each scheduler tick, the UI samples each entry's pattern at the
 *      current cycle position and updates its editor decoration (background
 *      gradient, flash pulse, or sparkline).
 *
 * The methods are non-chain-breaking: `.flash()` / `.glow()` / `.wave()`
 * return the pattern itself, so you can still pass it into a fixture setter
 * on the same line.
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
 * A pattern's value at one instant on the cycle timeline.
 *
 * Brightest wins among the events live at that instant, matching what the DMX
 * layer does with the same haps: a decoration reading only the first would
 * disagree with the light it is drawn beside whenever anything is layered.
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
 * Fraction object rather than a number. Testing it with `typeof === 'number'`
 * quietly failed for every event, which collapsed each one to zero width and
 * drew the structural decorations as hairlines. Number() takes the valueOf,
 * and anything that will not convert falls back rather than becoming NaN.
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
 * rather than a single instant.
 *
 * Handed back as plain spans so a widget can lay them out without knowing
 * anything about pattern internals. A pattern that throws yields nothing
 * rather than taking the decoration down with it.
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
      // fall back to part, then to a point, so a shape we do not recognise
      // still draws something rather than nothing.
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
