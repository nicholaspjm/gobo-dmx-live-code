/**
 * Tests for what the inline decorations are fed.
 *
 * These use stub haps rather than real strudel patterns, because the pattern
 * engine will not load under Node. That is enough: the two things worth
 * pinning are how a hap's TIME is read and how its VALUE is read, and both
 * bit when the shapes were first drawn.
 */

import { describe, it, expect } from 'vitest';

import { samplePattern, sampleCycle } from './pattern-viz.js';
import type { PatternLike } from './dmx.js';

/** A pattern returning fixed haps, whatever is asked of it. */
function haps(...list: unknown[]): PatternLike {
  return { queryArc: () => list as Array<{ value: unknown }> };
}

/**
 * Strudel keeps time in exact rational arithmetic, so a hap's begin/end are
 * Fraction objects rather than numbers. This is the shape that matters.
 */
function fraction(n: number): { valueOf: () => number } {
  return { valueOf: () => n };
}

describe('reading a hap time', () => {
  it('accepts a plain number', () => {
    const p = haps({ whole: { begin: 0.25, end: 0.5 }, value: 1 });
    expect(sampleCycle(p, 0)).toEqual([{ begin: 0.25, end: 0.5, value: 1 }]);
  });

  it('accepts a rational, which is what strudel actually hands over', () => {
    // Testing these with `typeof === number` silently failed for every event,
    // collapsing each to zero width and drawing the shapes as hairlines.
    const p = haps({ whole: { begin: fraction(0.25), end: fraction(0.75) }, value: 1 });
    expect(sampleCycle(p, 0)).toEqual([{ begin: 0.25, end: 0.75, value: 1 }]);
  });

  it('prefers the whole event over the queried slice', () => {
    // `whole` is what a person means by "the hit"; `part` is just the piece
    // this query happened to return.
    const p = haps({
      whole: { begin: fraction(0), end: fraction(0.75) },
      part: { begin: fraction(0.5), end: fraction(0.75) },
      value: 1,
    });
    expect(sampleCycle(p, 0)[0]).toEqual({ begin: 0, end: 0.75, value: 1 });
  });

  it('falls back to the slice when there is no whole', () => {
    const p = haps({ part: { begin: fraction(0.5), end: fraction(0.6) }, value: 1 });
    expect(sampleCycle(p, 0)[0]).toEqual({ begin: 0.5, end: 0.6, value: 1 });
  });

  it('reports times relative to the cycle being drawn', () => {
    const p = haps({ whole: { begin: fraction(7.25), end: fraction(7.5) }, value: 1 });
    expect(sampleCycle(p, 7)[0]).toEqual({ begin: 0.25, end: 0.5, value: 1 });
  });

  it('never lets an event end before it begins', () => {
    const p = haps({ whole: { begin: fraction(0.5), end: fraction(0.2) }, value: 1 });
    const [span] = sampleCycle(p, 0);
    expect(span.end).toBeGreaterThanOrEqual(span.begin);
  });

  it('yields nothing rather than throwing when the pattern does', () => {
    const p: PatternLike = { queryArc() { throw new Error('boom'); } };
    expect(sampleCycle(p, 0)).toEqual([]);
    expect(samplePattern(p, 0)).toBe(0);
  });
});

describe('reading a hap value', () => {
  it('takes the brightest of the events live at one instant', () => {
    // Matching the DMX layer: a decoration reading only the first would
    // disagree with the light it is drawn beside whenever anything is layered.
    expect(samplePattern(haps({ value: 0.25 }, { value: 0.75 }), 0)).toBe(0.75);
    expect(samplePattern(haps({ value: 0.75 }, { value: 0.25 }), 0)).toBe(0.75);
  });

  it('reads a level out of a control object, gain included', () => {
    expect(samplePattern(haps({ value: { value: 1, gain: 0.5 } }), 0)).toBe(0.5);
    expect(samplePattern(haps({ value: { value: 0.5, speed: 2 } }), 0)).toBe(0.5);
  });

  it('ignores an event carrying no level', () => {
    expect(samplePattern(haps({ value: 'loud' }, { value: 0.4 }), 0)).toBe(0.4);
    expect(sampleCycle(haps({ whole: { begin: 0, end: 1 }, value: 'loud' }), 0)).toEqual([]);
  });

  it('clamps a level into 0-1 for drawing', () => {
    const p = haps({ whole: { begin: 0, end: 1 }, value: 4 });
    expect(sampleCycle(p, 0)[0].value).toBe(1);
  });
});
