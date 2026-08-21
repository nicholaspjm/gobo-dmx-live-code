/**
 * An emitter name on a fixture means that emitter everywhere the fixture has
 * one.
 *
 * The loop that attaches named setters only ever saw scalar channels, so on a
 * fixture whose emitters ARE its pixels, `wash.red(1)` reached nothing at all:
 * no such method, or on a fixture that also has a scalar red, one channel lit
 * while 48 pixels stayed dark and nothing said so. `.off()` and `.full()` have
 * always driven the strip as well, so the named setters were the odd ones out.
 *
 * The strip itself was never the problem: `wash.pixels.red(1)` worked before
 * any of this, and still does.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { defineFixture, fixture, rgbStrip } from './fixtures.js';
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

// ch 1 dim, ch 2-13 four RGB pixels.
defineFixture('strip-wash', {
  name: 'Strip wash', manufacturer: 'test', type: 'generic', channelCount: 13,
  channels: [
    { offset: 0, name: 'dim', type: 'intensity' },
    { offset: 1, name: 'pixels', type: 'strip', pixelCount: 4, pixelLayout: 'rgb' },
  ],
});

// ch 1 red, ch 2-9 two RGBW pixels: a fixture with both spellings of red.
defineFixture('scalar-and-strip', {
  name: 'Scalar and strip', manufacturer: 'test', type: 'generic', channelCount: 9,
  channels: [
    { offset: 0, name: 'red', type: 'color' },
    { offset: 1, name: 'pixels', type: 'strip', pixelCount: 2, pixelLayout: 'rgbw' },
  ],
});

// Four single-channel cells: a level each, and no colour anywhere.
defineFixture('cell-bar', {
  name: 'Cell bar', manufacturer: 'test', type: 'generic', channelCount: 4,
  channels: [
    { offset: 0, name: 'cells', type: 'strip', pixelCount: 4, pixelLayout: 'mono' },
  ],
});

describe('a named emitter on a fixture with a strip', () => {
  it('reaches the strip pixels', () => {
    const wash = fixture(1, 'strip-wash');
    (wash.red as (v: number) => void)(1);
    // Red of each of the four pixels, which start at channel 2.
    expect(channels(13)).toEqual([0, 255, 0, 0, 255, 0, 0, 255, 0, 0, 255, 0, 0]);
  });

  it('drives the fixture channel and the pixels together', () => {
    // Both, on a fixture that has both. Driving one and leaving the other is
    // the half-lit rig this exists to prevent.
    const wash = fixture(1, 'scalar-and-strip');
    (wash.red as (v: number) => void)(1);
    expect(channels(9)).toEqual([255, 255, 0, 0, 0, 255, 0, 0, 0]);
  });

  it('takes a level, a pattern, or nothing for full, the way a setter does', () => {
    const wash = fixture(1, 'strip-wash');
    (wash.green as () => void)();
    expect(channels(5)).toEqual([0, 0, 255, 0, 0]);
  });

  it('reaches the dedicated white of an RGBW strip', () => {
    const wash = fixture(1, 'scalar-and-strip');
    (wash.white as (v: number) => void)(1);
    // W is the fourth channel of each pixel. The fixture has no white channel
    // of its own, so the pixels are all there is to drive.
    expect(channels(9)).toEqual([0, 0, 0, 0, 255, 0, 0, 0, 255]);
  });

  it('does not appear on a strip with no colour to name', () => {
    // A mono cell is one level, so there is no red on it to drive and a method
    // that quietly did nothing would be worse than no method.
    const bar = fixture(1, 'cell-bar');
    expect(bar.red).toBeUndefined();
    expect(bar.white).toBeUndefined();
  });

  it('leaves .set() addressing the fixture channel alone', () => {
    // The broad call is the setter; .set(name, v) stays the exact one, so a
    // scene that means only the fixture's own channel still has a way to say so.
    const wash = fixture(1, 'scalar-and-strip');
    wash.set('red', 1);
    expect(channels(9)).toEqual([255, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('leaves a strip channel named for a role as the strip', () => {
    // A def is free to call its strip `red`. That name is the strip, which
    // answers .fill() and .pixel(); a setter here would take its place and the
    // fixture would lose the pixels entirely.
    defineFixture('red-named-strip', {
      name: 'Red named strip', manufacturer: 'test', type: 'generic', channelCount: 6,
      channels: [
        { offset: 0, name: 'red', type: 'strip', pixelCount: 2, pixelLayout: 'rgb' },
      ],
    });
    const odd = fixture(1, 'red-named-strip');
    const strip = odd.red as ReturnType<typeof rgbStrip>;
    expect(typeof strip.fill).toBe('function');
    strip.fill(1, 0, 0);
    expect(channels(6)).toEqual([255, 0, 0, 255, 0, 0]);
    // The roles it does not take are still attached.
    clearDefs();
    getUniverseBuffer(0).fill(0);
    (odd.green as (v: number) => void)(1);
    expect(channels(6)).toEqual([0, 255, 0, 0, 255, 0]);
  });

  it('leaves the generic methods where they are', () => {
    // .off() and .full() drive every emitter, pixels included, and a setter
    // attached over one of them would be a blackout that does not black out.
    const wash = fixture(1, 'strip-wash');
    wash.full();
    expect(channels(13)).toEqual(Array(13).fill(255));
    clearDefs();
    getUniverseBuffer(0).fill(0);
    (wash.red as (v: number) => void)(1);
    wash.off();
    expect(channels(13)).toEqual(Array(13).fill(0));
  });
});
