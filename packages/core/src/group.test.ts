/**
 * Tests for group(), the one shape the fixture API could not express.
 *
 * A phase ramp across a strip is strip.each(), across a bar's pixels is
 * bar.pixels.each(), and across two pars is two hand-written offsets. Running
 * ONE ramp through all of them in order was not writable at any length. These
 * pin that it is now, that the same verb reaches every kind of member, and
 * that the cases which cannot work say so out loud rather than doing nothing.
 *
 * Fixtures default to universe 0, so that is where the assertions read.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { tick, clearDefs, getUniverseBuffer, type PatternLike } from './dmx.js';
import { fixture, defineFixture, rgbStrip, rgbwStrip, group } from './fixtures.js';

beforeEach(() => {
  clearDefs();
  for (const b of [getUniverseBuffer(0), getUniverseBuffer(1)]) b.fill(0);
});

/** Channels a..b of universe 0, after a tick. */
function read(from: number, to: number): number[] {
  tick(0);
  return Array.from(getUniverseBuffer(0).slice(from - 1, to));
}

/**
 * The rig the whole feature exists for: two plain RGB pars and a four-pixel
 * strip. Six lightable elements, three different ways of addressing them.
 */
function mixedRig() {
  const a = fixture(1, 'rgb');
  const b = fixture(4, 'rgb');
  const s = rgbStrip(7, 4);
  return { a, b, s, rig: group(a, b, s) };
}

// ─── counting ─────────────────────────────────────────────────────────────────

describe('what counts as one element', () => {
  it('counts a fixture once and a strip once per pixel', () => {
    expect(mixedRig().rig.size).toBe(6);
  });

  it('flattens nested groups', () => {
    const inner = group(fixture(1, 'rgb'), fixture(4, 'rgb'));
    expect(group(inner, rgbStrip(7, 3)).size).toBe(5);
  });

  it('counts a pixel bar as one when the fixture is passed, many when .pixels is', () => {
    // The rule that makes the counting predictable: pass the fixture to move
    // it as a unit, pass its strip to move the pixels.
    defineFixture('test-bar', {
      name: 'Test bar',
      manufacturer: 'Generic',
      type: 'generic',
      channelCount: 33,
      channels: [
        { offset: 0, name: 'dim', type: 'intensity' },
        { offset: 1, name: 'pixels', type: 'strip', pixelCount: 8, pixelLayout: 'rgbw' },
      ],
    });
    const bar = fixture(1, 'test-bar');
    expect(group(bar).size).toBe(1);
    expect(group(bar.pixels as ReturnType<typeof rgbwStrip>).size).toBe(8);
  });

  it('reaches a bar\'s pixels through the fixture, as one unit', () => {
    // Passing the fixture means "move this as one thing", which for a bar
    // means every pixel together rather than a slot each.
    const bar = fixture(1, 'test-bar');
    group(bar).red(1);
    // dim untouched at channel 1; every pixel's red lit, four channels apart.
    expect(read(1, 9)).toEqual([0, 255, 0, 0, 0, 255, 0, 0, 0]);
  });
});

// ─── one verb, every kind of member ───────────────────────────────────────────

describe('the same verb reaches every kind of member', () => {
  it('sets red on pars and on pixels alike', () => {
    mixedRig().rig.red(1);
    expect(read(1, 18)).toEqual([
      255, 0, 0, 255, 0, 0,                          // the two pars
      255, 0, 0, 255, 0, 0, 255, 0, 0, 255, 0, 0,    // the four pixels
    ]);
  });

  it('takes an omitted value as full, like every other setter', () => {
    mixedRig().rig.red();
    expect(read(1, 3)).toEqual([255, 0, 0]);
  });

  it('sets a colour across the whole group', () => {
    mixedRig().rig.color(1, 0, 0);
    expect(read(1, 6)).toEqual([255, 0, 0, 255, 0, 0]);
  });

  it('drives everything to full and back off', () => {
    const { rig } = mixedRig();
    rig.full();
    expect(read(1, 18)).toEqual(Array(18).fill(255));

    rig.off();
    expect(read(1, 18)).toEqual(Array(18).fill(0));
  });

  it('reaches a white channel only where there is one', () => {
    const par = fixture(1, 'rgb');          // no white
    const strip = rgbwStrip(10, 2);         // white on every pixel
    group(par, strip).white(1);

    expect(read(1, 3)).toEqual([0, 0, 0]);
    expect(read(10, 17)).toEqual([0, 0, 0, 255, 0, 0, 0, 255]);
  });
});

// ─── each() ───────────────────────────────────────────────────────────────────

describe('each() spreads one gesture across the whole group', () => {
  it('gives every element an even share of the phase, in written order', () => {
    mixedRig().rig.each((p) => p);
    // Six elements, so phases 0, 1/6, 2/6 … each written to all three
    // channels of its element.
    expect(read(1, 18)).toEqual([
      0, 0, 0, 43, 43, 43,
      85, 85, 85, 128, 128, 128, 170, 170, 170, 213, 213, 213,
    ]);
  });

  it('takes an [r, g, b] return for colour', () => {
    mixedRig().rig.each((_p, i) => [i / 6, 0, 1 - i / 6]);
    expect(read(1, 6)).toEqual([0, 0, 255, 43, 0, 213]);
  });

  it('leaves roles the array does not name alone', () => {
    // [1, 0, 0] on an RGBW pixel is red, not red-with-the-white-forced-off.
    const strip = rgbwStrip(1, 1);
    strip.white(1);
    group(strip).each(() => [1, 0, 0]);
    expect(read(1, 4)).toEqual([255, 0, 0, 255]);
  });

  it('moves the dimmer and leaves the colour, on a fixture that has one', () => {
    // The reason level() prefers a dimmer: a fade should not repaint the look.
    // A rule that wrote every colour role here would turn red into half white.
    const par = fixture(1, 'dim-rgb');
    par.color(1, 0, 0);
    group(par).each(() => 0.5);
    expect(read(1, 4)).toEqual([128, 255, 0, 0]);
  });

  it('falls back to the colour channels on a fixture with no dimmer', () => {
    const par = fixture(1, 'rgb');
    group(par).each(() => 0.5);
    expect(read(1, 3)).toEqual([128, 128, 128]);
  });

  it('carries patterns, not just numbers', () => {
    // The point of the whole exercise: a chase written once, phase-shifted
    // across a mixed rig.
    const ramp: PatternLike = { queryArc: (b) => [{ value: b % 1 }] };
    const shifted = (p: number): PatternLike => ({
      queryArc: (b) => ramp.queryArc(b + p, b + p),
    });
    mixedRig().rig.each((p) => shifted(p));

    // At cycle 0.5 the three elements read 0.5, 0.5 + 1/6 and 0.5 + 2/6.
    tick(0.5);
    const buf = getUniverseBuffer(0);
    expect([buf[0], buf[3], buf[6]]).toEqual([128, 170, 212]);
  });
});

// ─── loud failures ────────────────────────────────────────────────────────────

describe('cases that cannot work say so', () => {
  it('refuses a role no member has, rather than doing nothing', () => {
    // Skipping members that lack a role is what makes one line portable. A
    // role NOTHING has is a different thing: it would be a silent no-op, the
    // exact failure this pass exists to remove.
    expect(() => group(fixture(1, 'rgb'), rgbStrip(20, 2)).dim(0.5)).toThrow(
      /no member of this group has a "dim" channel/,
    );
  });

  it('lists what the group does have', () => {
    expect(() => group(fixture(1, 'rgb')).dim(0.5)).toThrow(/blue, green, red/);
  });

  it('still applies a role that only some members have', () => {
    const withDim = fixture(1, 'dim-rgb');
    group(withDim, rgbStrip(20, 2)).dim(0.5);
    expect(read(1, 4)).toEqual([128, 0, 0, 0]);
    expect(read(20, 25)).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it('names the argument that was not a fixture', () => {
    expect(() =>
      group(fixture(1, 'rgb'), 'nope' as unknown as ReturnType<typeof fixture>),
    ).toThrow(/argument 2 is not a fixture, a strip or a group/);
  });

  it('refuses an empty group', () => {
    expect(() => group()).toThrow(/at least one fixture/);
  });

  it('rejects a bad value with the group named', () => {
    expect(() => group(fixture(1, 'rgb')).red('1' as unknown as number)).toThrow(
      /group\.red\(\).*Drop the quotes/s,
    );
  });
});
