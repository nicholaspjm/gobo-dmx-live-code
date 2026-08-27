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
import { COLORS } from './colors.js';
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

// A plain RGB par: one position, and so nowhere to spread a run of stops.
defineFixture('scalar-only', {
  name: 'Scalar only', manufacturer: 'test', type: 'generic', channelCount: 3,
  channels: [
    { offset: 0, name: 'red', type: 'color' },
    { offset: 1, name: 'green', type: 'color' },
    { offset: 2, name: 'blue', type: 'color' },
  ],
});

// Four single-channel cells: a level each, and no colour anywhere.
defineFixture('cell-bar', {
  name: 'Cell bar', manufacturer: 'test', type: 'generic', channelCount: 4,
  channels: [
    { offset: 0, name: 'cells', type: 'strip', pixelCount: 4, pixelLayout: 'mono' },
  ],
});

// The 154-channel wash, declared here rather than resolved by id: the real
// 'atomic-strobe-154ch' is a public definition the browser loads at runtime, so
// the engine's own tests cannot reach it. Same shape, channel for channel: a
// master dimmer, a strobe, a 12x4 RGB matrix and eight white segments.
defineFixture('atomic-154', {
  name: 'Atomic 154', manufacturer: 'Generic', type: 'generic', channelCount: 154,
  channels: [
    { offset: 0, name: 'dim', type: 'intensity' },
    { offset: 1, name: 'strobe', type: 'strobe' },
    { offset: 2, name: 'pixels', type: 'strip', pixelCount: 48, pixelLayout: 'rgb', columns: 12, origin: 'bottom-right' },
    { offset: 146, name: 'strip', type: 'strip', pixelCount: 8, pixelLayout: 'mono', origin: 'top-right' },
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

/**
 * .color() follows the same rule as the named setters above.
 *
 * It did not, and the fixture that shows it is the one people own: on the
 * 154-channel wash, `.red(1)` painted all 48 pixels and `.color(red)` threw
 * "this fixture has no red/green/blue channels", while the hover panel listed
 * color(r,g,b) among the calls the fixture answers to. A mix now reaches every
 * colour strip, exactly as .fill() on that strip writes it.
 */
describe('.color() on a fixture whose colour lives in a strip', () => {
  /** The 48 pixels of the matrix as r, g, b triples. */
  function matrix(): number[][] {
    tick(0);
    const b = getUniverseBuffer(0);
    return Array.from({ length: 48 }, (_, i) => [b[2 + i * 3], b[3 + i * 3], b[4 + i * 3]]);
  }

  /** The eight white strobe segments, one level each. */
  function segments(): number[] {
    tick(0);
    return Array.from(getUniverseBuffer(0).slice(146, 154));
  }

  it('paints every pixel of the matrix', () => {
    const wash = fixture(1, 'atomic-154');
    wash.color(COLORS.red);
    expect(matrix()).toEqual(Array.from({ length: 48 }, () => [255, 0, 0]));
  });

  it('takes the same mix spelled as three values', () => {
    const wash = fixture(1, 'atomic-154');
    wash.color(1, 0.4, 0);
    expect(matrix()).toEqual(Array.from({ length: 48 }, () => [255, 102, 0]));
  });

  it('takes a pattern of colour tokens', () => {
    // One colour that changes with the pattern, held by every pixel at once.
    // The stand-in is what a pick() of colour names hands the channel writer.
    const wash = fixture(1, 'atomic-154');
    wash.color({ queryArc: () => [{ value: COLORS.blue }] });
    expect(matrix()).toEqual(Array.from({ length: 48 }, () => [0, 0, 255]));
  });

  it('is full white on the pixels when handed nothing', () => {
    const wash = fixture(1, 'atomic-154');
    wash.color();
    expect(matrix()).toEqual(Array.from({ length: 48 }, () => [255, 255, 255]));
  });

  it('leaves the control channels and the white segments alone', () => {
    // The eight segments are a dedicated white emitter, and a three-component
    // mix does not touch one. .full() is the call that lights everything, and
    // dim and strobe steer rather than emit.
    const wash = fixture(1, 'atomic-154');
    wash.color(COLORS.green);
    tick(0);
    expect(Array.from(getUniverseBuffer(0).slice(0, 2))).toEqual([0, 0]);
    expect(segments()).toEqual(Array(8).fill(0));
  });

  it('drives the fixture channel and the pixels together', () => {
    // Both spellings of red on one fixture, the way .red(1) already drives both.
    const wash = fixture(1, 'scalar-and-strip');
    wash.color(1, 0, 0);
    expect(channels(9)).toEqual([255, 255, 0, 0, 0, 255, 0, 0, 0]);
  });

  it('leaves the dedicated white of an RGBW strip where the scene put it', () => {
    const wash = fixture(1, 'scalar-and-strip');
    (wash.white as (v: number) => void)(0.5);
    wash.color(1, 0, 0);
    expect(channels(9)).toEqual([255, 255, 0, 0, 128, 255, 0, 0, 128]);
  });

  it('writes that white when the call names it', () => {
    const wash = fixture(1, 'scalar-and-strip');
    wash.color(1, 0, 0, 0.2);
    expect(channels(9)).toEqual([255, 255, 0, 0, 51, 255, 0, 0, 51]);
  });

  it('spreads a palette across a light that has pixels to spread it over', () => {
    // This used to refuse, on the reasoning that one light is one position
    // whether it is a par or 48 pixels behaving as one. The pixels won the
    // argument: a wash with 48 of them has 48 positions, .fill() on its strip
    // spread a run across them all along, and refusing the same run under
    // .color() meant the fixture answered one word and not the other. A run
    // still has nowhere to go on a par, which the test below pins.
    const wash = fixture(1, 'atomic-154');
    (wash.color as (...a: unknown[]) => void)([COLORS.red, COLORS.blue]);
    const out = channels(154);
    // The strip starts after the two scalar channels; its first pixel takes
    // the first stop and its last takes the last.
    expect(out.slice(2, 5)).toEqual([255, 0, 0]);
  });

  it('still refuses a palette on a light that is only one position', () => {
    // A par has nowhere to put a gradient, and painting it with the first stop
    // and dropping the rest is the silent wrong this refusal exists to stop.
    const par = fixture(1, 'scalar-only');
    expect(() => (par.color as (...a: unknown[]) => void)([COLORS.red, COLORS.blue]))
      .toThrow('takes one colour, not 2');
  });

  it('still throws on a fixture with no colour anywhere', () => {
    // Mono cells are levels, so there is no mix to paint and returning quietly
    // would leave the scene looking correct and the bar unchanged.
    const bar = fixture(1, 'cell-bar');
    expect(() => bar.color(1, 0, 0)).toThrow(
      'Fixture "Cell bar".color(): this fixture has no red/green/blue channels. Channels: cells.',
    );
  });

  it('leaves .full() as the call that lights the white segments too', () => {
    const wash = fixture(1, 'atomic-154');
    wash.full();
    expect(segments()).toEqual(Array(8).fill(255));
    expect(matrix()).toEqual(Array.from({ length: 48 }, () => [255, 255, 255]));
  });
});
