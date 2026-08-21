/**
 * On an RGBW strip, a colour is three components and the fourth channel is a
 * dedicated white emitter that a three-component mix does not touch.
 *
 * The colour paths already worked that way. The per-component spelling did not:
 * `.fill(r, g, b)` is how an RGB strip is written, and the RGBW one demanded
 * all four, so the same line worked on one strip and threw on the other. Now
 * three means r, g and b, with W left wherever the scene last put it, and four
 * is the explicit spelling that sets it.
 *
 * `.full()` is still the call that lights every emitter. `.chase()` leaves W
 * alone under the same rule, which is pinned next door in chase.test.ts.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { rgbwStrip } from './fixtures.js';
import { tick, clearDefs, getUniverseBuffer } from './dmx.js';

beforeEach(() => {
  clearDefs();
  getUniverseBuffer(0).fill(0);
});

/** The first `n` channels of universe 0 after a tick. */
function channels(n: number): number[] {
  tick(0);
  return Array.from(getUniverseBuffer(0).slice(0, n));
}

/** A stand-in for a waveform: what makes a value count as a pattern to the
 *  channel writer is that it answers queries. */
function level(v: number): { queryArc: () => Array<{ value: number }> } {
  return { queryArc: () => [{ value: v }] };
}

describe('rgbwStrip.fill', () => {
  it('takes three numbers as a mix and leaves the white alone', () => {
    const strip = rgbwStrip(1, 2, 0, { skipSim: true });
    strip.white(0.5);
    strip.fill(1, 0.4, 0);
    expect(channels(8)).toEqual([255, 102, 0, 128, 255, 102, 0, 128]);
  });

  it('leaves a white that was never set at zero, rather than raising it', () => {
    const strip = rgbwStrip(1, 1, 0, { skipSim: true });
    strip.fill(1, 0, 0);
    expect(channels(4)).toEqual([255, 0, 0, 0]);
  });

  it('still writes the white when the call names it', () => {
    const strip = rgbwStrip(1, 2, 0, { skipSim: true });
    strip.white(0.5);
    strip.fill(1, 0, 0, 0.2);
    expect(channels(8)).toEqual([255, 0, 0, 51, 255, 0, 0, 51]);
  });

  it('takes patterns in the three-value form, the way an RGB strip does', () => {
    const strip = rgbwStrip(1, 1, 0, { skipSim: true });
    strip.fill(level(0.8), 0, level(0.2));
    expect(channels(4)).toEqual([204, 0, 51, 0]);
  });

  it('is full on every channel when handed nothing', () => {
    // Nothing at all is full, W included: it is the same call .full() makes.
    const strip = rgbwStrip(1, 1, 0, { skipSim: true });
    strip.fill();
    expect(channels(4)).toEqual([255, 255, 255, 255]);
  });

  it('names both spellings when the colour is half written', () => {
    const strip = rgbwStrip(1, 1, 0, { skipSim: true });
    const message = '.fill(): needs r, g and b, or all four of r, g, b, w (got 2), '
      + 'or none of them for full.';
    expect(() => (strip.fill as (...a: unknown[]) => void)(1, 0)).toThrow(message);
    expect(() => (strip.fill as (...a: unknown[]) => void)(0.5))
      .toThrow('needs r, g and b, or all four of r, g, b, w (got 1)');
  });
});

describe('rgbwStrip.pixel', () => {
  it('takes three values as a mix and leaves the white alone', () => {
    const strip = rgbwStrip(1, 2, 0, { skipSim: true });
    strip.white(0.5);
    strip.pixel(1, 0, 1, 0);
    expect(channels(8)).toEqual([0, 0, 0, 128, 0, 255, 0, 128]);
  });

  it('still zeroes the white on the monochrome shortcut', () => {
    // One value is a level rather than a colour: "this pixel, this bright". A
    // white left up under it would be a second colour nobody asked for, and
    // .each() and .eachXY() already read a single value that way.
    const strip = rgbwStrip(1, 1, 0, { skipSim: true });
    strip.white(0.5);
    strip.pixel(0, 0.4);
    expect(channels(4)).toEqual([102, 102, 102, 0]);
  });

  it('carries the three-value form through the grid methods', () => {
    // pixelXY, row and column all hand their values to pixel(), so the rule
    // arrives here rather than being restated three times.
    const strip = rgbwStrip(1, 4, 0, { columns: 2, skipSim: true });
    strip.white(0.5);
    strip.row(1, 1, 0, 0);
    expect(channels(16)).toEqual([
      0, 0, 0, 128, 0, 0, 0, 128,
      255, 0, 0, 128, 255, 0, 0, 128,
    ]);
  });
});
