/**
 * `.chase()` exists so a moving light does not require writing a function.
 * These pin the geometry it generates: which cell gets which phase, and what
 * the options actually change.
 *
 * The waveform is stubbed rather than imported. `sine` comes from strudel,
 * which does not load under this runner, and the thing worth testing here is
 * the phase per pixel, not the shape of a sine.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { rgbStrip, monoStrip, setStripEffectWaveforms } from './fixtures.js';
import { clearDefs } from './dmx.js';

/** Calls recorded by the fake waveform, in the order chase() made them. */
let calls: Array<{ early: number; slow: number; lo: number; mul: number | null }>;

/** Chainable stand-in that records what was asked of it. `queryArc` is what
 *  makes the value count as a pattern to the channel writer. */
function fakeWave(): unknown {
  const rec = { early: NaN, slow: NaN, lo: NaN, mul: null as number | null };
  const self: Record<string, unknown> = {
    queryArc: () => [],
    early(p: number) { rec.early = p; return self; },
    slow(n: number) { rec.slow = n; return self; },
    range(lo: number) { rec.lo = lo; calls.push(rec); return self; },
    // One envelope per cell is shared by that cell's components, so a scaled
    // component is its own record rather than an overwrite of the envelope's.
    mul(n: number) { calls.push({ ...rec, mul: n }); return self; },
  };
  return self;
}

beforeEach(() => {
  calls = [];
  clearDefs();
  setStripEffectWaveforms(fakeWave as () => never, fakeWave as () => never);
});

describe('chase', () => {
  it('phases each column by its place across the strip', () => {
    const strip = rgbStrip(1, 12, 0, { skipSim: true });
    strip.chase('red');
    // One record per lit component. Red only, so one per pixel.
    expect(calls.map((c) => Number(c.early.toFixed(4))))
      .toEqual([0, 0.0833, 0.1667, 0.25, 0.3333, 0.4167, 0.5, 0.5833, 0.6667, 0.75, 0.8333, 0.9167]);
  });

  it('runs the other way when reversed', () => {
    const strip = rgbStrip(1, 4, 0, { skipSim: true });
    strip.chase('red', { reverse: true });
    expect(calls.map((c) => c.early)).toEqual([-0, -0.25, -0.5, -0.75]);
  });

  it('takes one lap every four cycles by default', () => {
    const strip = rgbStrip(1, 4, 0, { skipSim: true });
    strip.chase('red');
    expect(calls.every((c) => c.slow === 4)).toBe(true);
  });

  it('goes faster when asked', () => {
    const strip = rgbStrip(1, 4, 0, { skipSim: true });
    strip.chase('red', { cycles: 1 });
    expect(calls.every((c) => c.slow === 1)).toBe(true);
  });

  it('fits more crests on the strip', () => {
    const strip = rgbStrip(1, 4, 0, { skipSim: true });
    strip.chase('red', { waves: 2 });
    expect(calls.map((c) => c.early)).toEqual([0, 0.5, 1, 1.5]);
  });

  it('narrows the lit band as width falls', () => {
    // range(lo, 1) on a 0..1 wave: a lower floor clamps more of it away.
    const strip = rgbStrip(1, 2, 0, { skipSim: true });
    strip.chase('red', { width: 1 });
    expect(calls[0].lo).toBe(0);
    calls = [];
    strip.chase('red', { width: 0.5 });
    expect(calls[0].lo).toBe(-1);
    calls = [];
    strip.chase('red', { width: 0.25 });
    expect(calls[0].lo).toBe(-3);
  });

  it('scales a mixed colour and skips components that are zero', () => {
    const strip = rgbStrip(1, 1, 0, { skipSim: true });
    strip.chase([1, 0.5, 0]);
    // Red is 1 so it passes through unscaled; green is halved; blue is dropped.
    expect(calls).toHaveLength(2);
    expect(calls[0].mul).toBe(null);
    expect(calls[1].mul).toBe(0.5);
  });

  it('phases down the rows on a grid when asked', () => {
    const strip = rgbStrip(1, 12, 0, { columns: 4, skipSim: true });   // 4 x 3
    strip.chase('red', { down: true });
    // Three rows, four cells each, all cells in a row sharing a phase.
    expect(calls.map((c) => c.early))
      .toEqual([0, 0, 0, 0, 1 / 3, 1 / 3, 1 / 3, 1 / 3, 2 / 3, 2 / 3, 2 / 3, 2 / 3]);
  });

  it('needs no colour on a single-channel strip', () => {
    const cells = monoStrip(1, 4, 0, { skipSim: true });
    cells.chase();
    expect(calls.map((c) => c.early)).toEqual([0, 0.25, 0.5, 0.75]);
  });

  it('names the colours it knows when given one it does not', () => {
    const strip = rgbStrip(1, 2, 0, { skipSim: true });
    expect(() => strip.chase('puce')).toThrow(/not a colour I know/);
    expect(() => strip.chase('puce')).toThrow(/magenta/);
  });

  it('accepts a colour name in any case', () => {
    const strip = rgbStrip(1, 1, 0, { skipSim: true });
    expect(() => strip.chase('Red')).not.toThrow();
    expect(() => strip.chase(' BLUE ')).not.toThrow();
  });
});
