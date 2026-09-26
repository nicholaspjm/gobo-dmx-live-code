/**
 * One word for colour, wherever the colour lives.
 *
 * Two things used to decide whether `.color()` worked, and neither was "does
 * this light have a colour".
 *
 * The first was spelling. `.color()` compared channel names to the literals
 * 'red', 'green' and 'blue', while `.off()` and `.full()` read a name through
 * isEmitterChannel(), which lowercases it, drops separators and drops a
 * trailing number. So one definition answered one call and refused the other:
 * a fixture wired Red_1 / Green_1 / Blue_1 lit under `.full()` and threw under
 * `.color()`, reporting no red, green or blue channels while naming those
 * three in the message.
 *
 * The second was where the colour lived. A run of stops was refused outright,
 * on the reasoning that one light is one position. True of a par, false of a
 * pixel bar, which has as many positions as it has pixels and whose own
 * `.fill()` had spread a gradient across them all along.
 *
 * These pin both, and pin the gate that keeps `g` from meaning green on a
 * fixture where it means gobo.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { tick, clearDefs, getUniverseBuffer } from './dmx.js';
import {
  fixture, defineFixture, clearSimFixtures, getSimFixtures, group, type ChannelDef,
} from './fixtures.js';
import { COLORS } from './colors.js';

const red = COLORS.red;
const blue = COLORS.blue;

beforeEach(() => {
  clearDefs();
  clearSimFixtures();
  getUniverseBuffer(0).fill(0);
});

/** Read back the first `n` channels of universe 0 after a tick. */
function chans(n: number): number[] {
  tick(0);
  return Array.from(getUniverseBuffer(0).slice(0, n));
}

function define(id: string, channels: ChannelDef[], channelCount = channels.length): void {
  defineFixture(id, { name: id, manufacturer: 'test', type: 'generic', channelCount, channels });
}

/** A four-pixel RGB bar as a single strip channel, which is how a real one is
 *  declared: twelve channels reached through one name. */
function defineBar(id: string): void {
  define(id, [
    { offset: 0, name: 'pixels', type: 'strip', pixelCount: 4, pixelLayout: 'rgb' },
  ], 12);
}

// ─── spelling: the same rule .full() and .off() already used ──────────────────

describe('.color() reads a channel name the way every other call does', () => {
  it('takes the canonical words, whatever the channel type says', () => {
    define('canonical', [
      { offset: 0, name: 'red', type: 'color' },
      { offset: 1, name: 'green', type: 'color' },
      { offset: 2, name: 'blue', type: 'color' },
    ]);
    fixture(1, 'canonical').color(1, 0, 0);
    expect(chans(3)).toEqual([255, 0, 0]);
  });

  it('takes a capitalised, numbered spelling, which .full() always took', () => {
    define('numbered', [
      { offset: 0, name: 'Red_1', type: 'color' },
      { offset: 1, name: 'Green_1', type: 'color' },
      { offset: 2, name: 'Blue_1', type: 'color' },
    ]);
    fixture(1, 'numbered').color(1, 0, 0);
    expect(chans(3)).toEqual([255, 0, 0]);
  });

  it('takes r/g/b when the definition declared them colour channels', () => {
    define('initials', [
      { offset: 0, name: 'r', type: 'color' },
      { offset: 1, name: 'g', type: 'color' },
      { offset: 2, name: 'b', type: 'color' },
    ]);
    fixture(1, 'initials').color(0, 1, 0);
    expect(chans(3)).toEqual([0, 255, 0]);
  });

  it('leaves an undeclared g alone, because g is a gobo wheel too', () => {
    // The gate that earns the initials: on a moving head, `g` is as likely to
    // select a gobo as it is to mean green, and driving a gobo wheel to full
    // because a scene asked for a colour is the kind of wrong that looks like
    // broken hardware. A definition that means the colour says type: 'color'.
    define('gobo-head', [
      { offset: 0, name: 'r', type: 'generic' },
      { offset: 1, name: 'g', type: 'generic' },
      { offset: 2, name: 'b', type: 'generic' },
    ]);
    const head = fixture(1, 'gobo-head');
    expect(() => head.color(0, 1, 0)).toThrow(/no red\/green\/blue channels/);
    expect(chans(3)).toEqual([0, 0, 0]);
  });

  it('darkens under .off() whatever it painted under .color()', () => {
    // Widening one reader and not the other is how the original asymmetry got
    // here. Doing it again in the opposite direction produced a blackout that
    // did not black out: .color() lit an r/g/b fixture and .off() threw,
    // saying nothing on it emitted light, leaving the rig on.
    define('initials-off', [
      { offset: 0, name: 'r', type: 'color' },
      { offset: 1, name: 'g', type: 'color' },
      { offset: 2, name: 'b', type: 'color' },
    ]);
    const par = fixture(1, 'initials-off');
    par.color(1, 0, 0);
    expect(chans(3)).toEqual([255, 0, 0]);
    par.off();
    expect(chans(3)).toEqual([0, 0, 0]);
    par.full();
    expect(chans(3)).toEqual([255, 255, 255]);
  });

  it('does not mistake a channel named for an Object member', () => {
    // The initials are looked up in a plain object, so an unguarded index
    // reached the prototype: a channel called `constructor` came back with a
    // function where a role belongs.
    define('proto', [
      { offset: 0, name: 'constructor', type: 'color' },
      { offset: 1, name: 'toString', type: 'color' },
    ]);
    expect(() => fixture(1, 'proto').color(1, 0, 0)).toThrow(/no red\/green\/blue channels/);
  });

  it('says what a colour channel is when it cannot find one', () => {
    define('no-colour', [
      { offset: 0, name: 'pan', type: 'position' },
      { offset: 1, name: 'tilt', type: 'position' },
    ]);
    expect(() => fixture(1, 'no-colour').color(1, 0, 0))
      .toThrow(/named red, green, blue or white.*or one spelled r\/g\/b\/w and declared type: 'color'/s);
  });

  it('still takes the white as an opt-in fourth value', () => {
    define('rgbw-initials', [
      { offset: 0, name: 'r', type: 'color' },
      { offset: 1, name: 'g', type: 'color' },
      { offset: 2, name: 'b', type: 'color' },
      { offset: 3, name: 'w', type: 'color' },
    ]);
    const par = fixture(1, 'rgbw-initials');
    par.color(1, 0, 0);
    expect(chans(4)).toEqual([255, 0, 0, 0]);
    par.color(1, 0, 0, 1);
    expect(chans(4)).toEqual([255, 0, 0, 255]);
  });
});

// ─── a group resolves a role the same way the fixture does ────────────────────

describe('a group reads a member the way the member reads itself', () => {
  it('colours members whose channels are spelled r/g/b or Red_1', () => {
    // A group built its roles from literal channel names while the fixture
    // resolved them by role, so group(par).color(red) threw saying no member
    // had a colour channel — on members that answered .color(red) alone.
    define('ini', [
      { offset: 0, name: 'r', type: 'color' },
      { offset: 1, name: 'g', type: 'color' },
      { offset: 2, name: 'b', type: 'color' },
    ]);
    define('num', [
      { offset: 0, name: 'Red_1', type: 'color' },
      { offset: 1, name: 'Green_1', type: 'color' },
      { offset: 2, name: 'Blue_1', type: 'color' },
    ]);
    const a = fixture(1, 'ini');
    const b = fixture(4, 'num');
    group(a, b).color(blue);
    expect(chans(6)).toEqual([0, 0, 255, 0, 0, 255]);
  });

  it('still spreads a run across those members in order', () => {
    define('ini2', [
      { offset: 0, name: 'r', type: 'color' },
      { offset: 1, name: 'g', type: 'color' },
      { offset: 2, name: 'b', type: 'color' },
    ]);
    const a = fixture(1, 'ini2');
    const b = fixture(4, 'ini2');
    group(a, b).color([red, blue]);
    expect(chans(6)).toEqual([255, 0, 0, 0, 0, 255]);
  });
});

// ─── a run of colours goes where the fixture has room for it ──────────────────

describe('.color() spreads a run across the pixels a fixture has', () => {
  it('spreads an array of colours endpoint to endpoint', () => {
    defineBar('bar-array');
    fixture(1, 'bar-array').color([red, blue]);
    const out = chans(12);
    expect(out.slice(0, 3)).toEqual([255, 0, 0]);    // pixel 0 is the first stop
    expect(out.slice(9, 12)).toEqual([0, 0, 255]);   // pixel 3 is the last
  });

  it('spreads colours written as separate arguments the same way', () => {
    defineBar('bar-args');
    fixture(1, 'bar-args').color(red, blue);
    const out = chans(12);
    expect(out.slice(0, 3)).toEqual([255, 0, 0]);
    expect(out.slice(9, 12)).toEqual([0, 0, 255]);
  });

  it('blends the pixels in between rather than stepping', () => {
    defineBar('bar-blend');
    fixture(1, 'bar-blend').color([red, blue]);
    const out = chans(12);
    const middles = [out.slice(3, 6), out.slice(6, 9)];
    for (const px of middles) {
      expect(px[0]).toBeGreaterThan(0);
      expect(px[2]).toBeGreaterThan(0);
    }
    // and they are not all the same pixel
    expect(out.slice(3, 6)).not.toEqual(out.slice(6, 9));
  });

  it('repeats one colour across every pixel, as it always did', () => {
    defineBar('bar-single');
    fixture(1, 'bar-single').color(red);
    const out = chans(12);
    for (let i = 0; i < 4; i++) expect(out.slice(i * 3, i * 3 + 3)).toEqual([255, 0, 0]);
  });

  it('brings a scalar emitter along with the run rather than leaving it stale', () => {
    // A fixture can have both spellings of red: a scalar channel and a strip.
    // The strip has room for the gradient and the scalar has one position, so
    // the scalar takes the run's first stop. Leaving it where it was showed a
    // gradient across the pixels beside a colour nothing had asked for.
    define('scalar-and-strip', [
      { offset: 0, name: 'red', type: 'color' },
      { offset: 1, name: 'pixels', type: 'strip', pixelCount: 2, pixelLayout: 'rgb' },
    ], 7);
    const wash = fixture(1, 'scalar-and-strip');
    (wash.red as (v: number) => void)(0.5);
    expect(chans(7)[0]).toBe(128);

    (wash.color as (...a: unknown[]) => void)([red, blue]);
    const out = chans(7);
    expect(out[0]).toBe(255);                    // scalar red takes the first stop
    expect(out.slice(1, 4)).toEqual([255, 0, 0]); // pixel 0
    expect(out.slice(4, 7)).toEqual([0, 0, 255]); // pixel 1
  });

  it('still refuses a run on a fixture that is only one position', () => {
    // A par has nowhere to put a gradient, and painting it with the first stop
    // and dropping the rest is the silent wrong this refusal exists to stop.
    define('par', [
      { offset: 0, name: 'red', type: 'color' },
      { offset: 1, name: 'green', type: 'color' },
      { offset: 2, name: 'blue', type: 'color' },
    ]);
    expect(() => fixture(1, 'par').color([red, blue])).toThrow(/takes one colour, not 2/);
    expect(chans(3)).toEqual([0, 0, 0]);
  });
});

// ─── the strip answers to the same word ───────────────────────────────────────

describe('a strip answers to .color()', () => {
  it('takes one colour, the same as .fill()', () => {
    defineBar('strip-one');
    const bar = fixture(1, 'strip-one') as unknown as { pixels: { color(c: unknown): void } };
    bar.pixels.color(red);
    const out = chans(12);
    for (let i = 0; i < 4; i++) expect(out.slice(i * 3, i * 3 + 3)).toEqual([255, 0, 0]);
  });

  it('takes a run, the same as .fill()', () => {
    defineBar('strip-run');
    const bar = fixture(1, 'strip-run') as unknown as { pixels: { color(c: unknown): void } };
    bar.pixels.color([red, blue]);
    const out = chans(12);
    expect(out.slice(0, 3)).toEqual([255, 0, 0]);
    expect(out.slice(9, 12)).toEqual([0, 0, 255]);
  });

  it('writes exactly what .fill() writes, for the same call', () => {
    defineBar('strip-a');
    const a = fixture(1, 'strip-a') as unknown as { pixels: { color(c: unknown): void } };
    a.pixels.color([red, blue]);
    const viaColor = chans(12);

    clearDefs();
    clearSimFixtures();
    getUniverseBuffer(0).fill(0);

    defineBar('strip-b');
    const b = fixture(1, 'strip-b') as unknown as { pixels: { fill(c: unknown): void } };
    b.pixels.fill([red, blue]);
    expect(chans(12)).toEqual(viaColor);
  });

  it('is there on an rgbw strip too', () => {
    define('bar-rgbw', [
      { offset: 0, name: 'pixels', type: 'strip', pixelCount: 2, pixelLayout: 'rgbw' },
    ], 8);
    const bar = fixture(1, 'bar-rgbw') as unknown as { pixels: { color(c: unknown): void } };
    bar.pixels.color(red);
    const out = chans(8);
    // W is left where the scene put it, the rule every colour path here follows.
    expect(out.slice(0, 3)).toEqual([255, 0, 0]);
    expect(out.slice(4, 7)).toEqual([255, 0, 0]);
  });

  it('is not on a mono strip, which has no colour to set', () => {
    define('bar-mono', [
      { offset: 0, name: 'cells', type: 'strip', pixelCount: 4, pixelLayout: 'mono' },
    ], 4);
    const bar = fixture(1, 'bar-mono') as unknown as { cells: Record<string, unknown> };
    expect(bar.cells.color).toBeUndefined();
    expect(typeof bar.cells.fill).toBe('function');
  });
});

// ─── a group darkens what the fixture darkens ─────────────────────────────────

describe('group blackout reaches the same channels the fixture does', () => {
  it('zeroes a master called intensity, not only one called dim', () => {
    // group.off() walked the member's literal channel names and zeroed only the
    // one spelled exactly 'dim', so a fixture whose master is 'intensity' went
    // dark under fixture.off() and stayed at full under group.off() — the call
    // a group exists to make.
    define('master', [
      { offset: 0, name: 'intensity', type: 'intensity' },
      { offset: 1, name: 'red', type: 'color' },
    ]);
    const a = fixture(1, 'master');
    a.full();
    expect(chans(2)).toEqual([255, 255]);
    group(a).off();
    expect(chans(2)).toEqual([0, 0]);
  });

  it('agrees with fixture.off() on a master called dimmer', () => {
    define('dimmer-named', [
      { offset: 0, name: 'Dimmer', type: 'generic' },
      { offset: 1, name: 'red', type: 'color' },
    ]);
    const a = fixture(1, 'dimmer-named');
    a.full();
    group(a).off();
    expect(chans(2)).toEqual([0, 0]);
  });

  it('still drives the group to full through that same channel', () => {
    define('master2', [
      { offset: 0, name: 'intensity', type: 'intensity' },
      { offset: 1, name: 'red', type: 'color' },
    ]);
    group(fixture(1, 'master2')).full();
    expect(chans(2)).toEqual([255, 255]);
  });
});

// ─── a group blackout reaches every emitter, not four names ──────────────────

describe('group.off() darkens whatever the fixture darkens', () => {
  it('takes amber and uv down with the rest', () => {
    // off() filtered roles against dim plus red/green/blue/white, so every
    // other emitter burned through a blackout: amber and uv here, and lime,
    // cyan, magenta and the warm/cold halves of a blinder elsewhere. On the
    // same fixture whose own .off() darkened all of them.
    define('rgbau', [
      { offset: 0, name: 'red', type: 'color' },
      { offset: 1, name: 'green', type: 'color' },
      { offset: 2, name: 'blue', type: 'color' },
      { offset: 3, name: 'amber', type: 'color' },
      { offset: 4, name: 'uv', type: 'color' },
    ]);
    const par = fixture(1, 'rgbau');
    par.full();
    expect(chans(5)).toEqual([255, 255, 255, 255, 255]);
    group(par).off();
    expect(chans(5)).toEqual([0, 0, 0, 0, 0]);
  });

  it('darkens a blinder whose halves are warm and cold', () => {
    define('blinder', [
      { offset: 0, name: 'warm', type: 'generic' },
      { offset: 1, name: 'cold', type: 'generic' },
    ]);
    const b = fixture(1, 'blinder');
    b.full();
    group(b).off();
    expect(chans(2)).toEqual([0, 0]);
  });

  it('darkens the mono cells of a fixture with a white segment bar', () => {
    // The shape the public atomic-strobe-154ch ships: a mono strip alongside a
    // colour one. A group added red/green/blue for every strip, and a mono
    // strip answers to none of them, so its cells were never written at all.
    define('seg-bar', [
      { offset: 0, name: 'dim', type: 'intensity' },
      { offset: 1, name: 'segments', type: 'strip', pixelCount: 4, pixelLayout: 'mono' },
    ], 5);
    const bar = fixture(1, 'seg-bar');
    bar.full();
    expect(chans(5)).toEqual([255, 255, 255, 255, 255]);
    group(bar).off();
    expect(chans(5)).toEqual([0, 0, 0, 0, 0]);
  });

  it('still brings the whole group up under full()', () => {
    define('rgbau2', [
      { offset: 0, name: 'red', type: 'color' },
      { offset: 1, name: 'amber', type: 'color' },
      { offset: 2, name: 'uv', type: 'color' },
    ]);
    group(fixture(1, 'rgbau2')).full();
    expect(chans(3)).toEqual([255, 255, 255]);
  });
});

// ─── the panel draws what the colour call can paint ──────────────────────────

describe('the sim resolves a fixture the way .color() does', () => {
  it('draws a fixture whose channels are Red_1 / Green_1 / Blue_1', () => {
    // The panel looked its channels up as the exact words red, green and blue,
    // which stopped matching the moment .color() learned to read Red_1 and
    // r/g/b. Such a fixture drove correctly on the rig and drew nothing — and
    // with no channel named 'dim' either it registered no element at all, so a
    // working light was invisible in the one place you check before doors.
    define('numbered-sim', [
      { offset: 0, name: 'Red_1', type: 'color' },
      { offset: 1, name: 'Green_1', type: 'color' },
      { offset: 2, name: 'Blue_1', type: 'color' },
    ]);
    fixture(1, 'numbered-sim');
    const drawn = getSimFixtures();
    expect(drawn).toHaveLength(1);
    expect(drawn[0].render.kind).toBe('globe-rgbw');
  });

  it('draws one whose channels are r / g / b declared as colour', () => {
    define('initial-sim', [
      { offset: 0, name: 'r', type: 'color' },
      { offset: 1, name: 'g', type: 'color' },
      { offset: 2, name: 'b', type: 'color' },
    ]);
    fixture(1, 'initial-sim');
    expect(getSimFixtures()[0].render.kind).toBe('globe-rgbw');
  });

  it('points at the right channels, not merely at some channel', () => {
    define('offset-sim', [
      { offset: 0, name: 'strobe', type: 'strobe' },
      { offset: 1, name: 'Red_1', type: 'color' },
      { offset: 2, name: 'Green_1', type: 'color' },
      { offset: 3, name: 'Blue_1', type: 'color' },
    ]);
    fixture(1, 'offset-sim');
    const r = getSimFixtures()[0].render as { kind: string; r?: number; g?: number; b?: number };
    expect([r.r, r.g, r.b]).toEqual([1, 2, 3]);
  });

  it('still finds a master called intensity for a dimmer-only fixture', () => {
    define('master-sim', [{ offset: 0, name: 'intensity', type: 'intensity' }]);
    fixture(1, 'master-sim');
    const drawn = getSimFixtures();
    expect(drawn).toHaveLength(1);
    expect(drawn[0].render.kind).toBe('globe-dim');
  });
});

// ─── a quoted colour says the same thing everywhere ──────────────────────────

describe('a quoted colour name', () => {
  it('tells a fixture what a strip has always been told', () => {
    // .fill() goes through the colour reader, which has said the useful thing
    // since it was written. A fixture fell past it to the component path and
    // complained about arity — "needs all 3 of r, g, b (got 1)" — which is
    // true and no help to someone who has just typed a colour.
    define('quoted', [
      { offset: 0, name: 'red', type: 'color' },
      { offset: 1, name: 'green', type: 'color' },
      { offset: 2, name: 'blue', type: 'color' },
    ]);
    expect(() => (fixture(1, 'quoted') as unknown as { color(s: string): void }).color('red'))
      .toThrow(/colours are written without quotes\. Use red rather than 'red'/);
  });

  it('names the colours it knows when the word is not one', () => {
    define('quoted2', [
      { offset: 0, name: 'red', type: 'color' },
      { offset: 1, name: 'green', type: 'color' },
      { offset: 2, name: 'blue', type: 'color' },
    ]);
    expect(() => (fixture(1, 'quoted2') as unknown as { color(s: string): void }).color('puce'))
      .toThrow(/"puce" is not a colour/);
  });

  it('tells a group the same thing', () => {
    define('quoted3', [
      { offset: 0, name: 'red', type: 'color' },
      { offset: 1, name: 'green', type: 'color' },
      { offset: 2, name: 'blue', type: 'color' },
    ]);
    const rig = group(fixture(1, 'quoted3'), fixture(4, 'quoted3')) as unknown as { color(s: string): void };
    expect(() => rig.color('red')).toThrow(/group\.color\(\): colours are written without quotes\. Use red rather than 'red'/);
  });

  it('still sends a slot name to a colour wheel that has one', () => {
    // The branch above this must not swallow the documented wheel call.
    define('wheel', [
      { offset: 0, name: 'dim', type: 'intensity' },
      {
        offset: 1, name: 'color', type: 'color',
        slots: [{ name: 'open', value: 0 }, { name: 'red', from: 10, to: 19 }],
      },
    ]);
    const head = fixture(1, 'wheel') as unknown as { color(s: string): void };
    expect(() => head.color('red')).not.toThrow();
    expect(chans(2)[1]).toBeGreaterThan(0);
  });
});
