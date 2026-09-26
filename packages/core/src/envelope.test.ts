/**
 * Per-step fades: the arithmetic, without the pattern engine.
 *
 * The engine end is checked where strudel loads (the scene tests); what is
 * pinned here is the shape a step makes: up over the fade in, down to what it
 * holds, and out over the fade out after the step has ended.
 */

import { describe, it, expect } from 'vitest';

import { cyclesOf, parseAdsr, shapedLevel, stepLevel } from './envelope.js';

describe('stage lengths', () => {
  it('reads beats as quarters of a cycle, at any tempo', () => {
    expect(cyclesOf({ amount: 1, unit: 'beats' }, 120)).toBe(0.25);
    expect(cyclesOf({ amount: 1, unit: 'beats' }, 90)).toBe(0.25);
  });

  it('reads seconds at the tempo, as strudel means them', () => {
    // 120 BPM: a beat is half a second, so half a second is a quarter cycle.
    expect(cyclesOf({ amount: 0.5, unit: 'seconds' }, 120)).toBe(0.25);
    expect(cyclesOf({ amount: 0.5, unit: 'seconds' }, 60)).toBe(0.125);
  });

  it('treats a missing or empty stage as instant', () => {
    expect(cyclesOf(undefined, 120)).toBe(0);
    expect(cyclesOf({ amount: 0, unit: 'beats' }, 120)).toBe(0);
  });
});

describe('the level through a step', () => {
  it('holds full with no stages at all', () => {
    expect(stepLevel(0, 0, 0, undefined)).toBe(1);
    expect(stepLevel(10, 0, 0, undefined)).toBe(1);
  });

  it('comes up over the fade in', () => {
    expect(stepLevel(0.05, 0.1, 0, undefined)).toBeCloseTo(0.5);
  });

  it('settles to nothing when told only how fast, which is a flash', () => {
    expect(stepLevel(0.05, 0, 0.1, undefined)).toBeCloseTo(0.5);
    expect(stepLevel(0.2, 0, 0.1, undefined)).toBe(0);
  });

  it('settles to the level it was given', () => {
    expect(stepLevel(0.2, 0, 0.1, 0.4)).toBeCloseTo(0.4);
  });
});

describe('the tail after a step', () => {
  it('fades out over the release from wherever the step ended', () => {
    // A step from 0 to 0.25, a quarter-cycle tail.
    expect(shapedLevel(0.1, 0, 0.25, 0, 0, undefined, 0.25)).toBe(1);
    expect(shapedLevel(0.375, 0, 0.25, 0, 0, undefined, 0.25)).toBeCloseTo(0.5);
    expect(shapedLevel(0.5, 0, 0.25, 0, 0, undefined, 0.25)).toBeNull();
  });

  it('ends with the step when there is no fade out', () => {
    expect(shapedLevel(0.3, 0, 0.25, 0, 0, undefined, 0)).toBeNull();
  });

  it('starts the tail from the settled level, not from full', () => {
    expect(shapedLevel(0.375, 0, 0.25, 0, 0.1, 0.4, 0.25)).toBeCloseTo(0.2);
  });

  it('is nothing before the step starts', () => {
    expect(shapedLevel(0.1, 0.25, 0.5, 0, 0, undefined, 1)).toBeNull();
  });
});

describe("strudel's adsr string", () => {
  it('reads attack:decay:sustain:release in seconds', () => {
    expect(parseAdsr('0.01:0.2:0.5:1')).toEqual({
      attack: { amount: 0.01, unit: 'seconds' },
      decay: { amount: 0.2, unit: 'seconds' },
      sustain: 0.5,
      release: { amount: 1, unit: 'seconds' },
    });
  });

  it('takes as many parts as it is given', () => {
    expect(parseAdsr('0.1')).toEqual({ attack: { amount: 0.1, unit: 'seconds' } });
  });
});
