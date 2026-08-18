/**
 * Tests for the three fixture shapes the API could not express.
 *
 * Each mirrors a real light rather than a synthetic case:
 *
 *   a 154-channel wash whose pixels are a 12x4 grid, not a line
 *   a blinder whose emitters are called warm/cold rather than red/green/blue
 *   a moving head that picks colour and gobo by DMX range on one channel
 *
 * The blinder is the one that mattered most: .off() used to leave both bulbs
 * lit and report success, because the emitter list was six hardcoded names.
 *
 * Fixtures default to universe 0, so that is where the assertions read.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { tick, clearDefs, getUniverseBuffer, type PatternLike } from './dmx.js';
import { fixture, defineFixture, rgbStrip, rgbwStrip, isEmitterChannel } from './fixtures.js';

beforeEach(() => {
  clearDefs();
  getUniverseBuffer(0).fill(0);
});

/** Channels a..b (1-based, inclusive) of universe 0, after a tick. */
function read(from: number, to: number): number[] {
  tick(0);
  return Array.from(getUniverseBuffer(0).slice(from - 1, to));
}

/**
 * Narrow a named-channel accessor to a callable.
 *
 * Goes through `unknown` because a channel called `color` shadows the built-in
 * .color(r, g, b) helper on the instance, so the declared type is the helper's
 * while the value is the channel setter. That shadowing is what you want on a
 * head whose colour is a wheel rather than a mix.
 */
const setter = (inst: ReturnType<typeof fixture>, name: string) =>
  inst[name] as unknown as (v?: unknown) => void;

// ─── the 12x4 wash ────────────────────────────────────────────────────────────

describe('a strip that is really a grid', () => {
  it('defaults to a single row, so a plain strip is unchanged', () => {
    const s = rgbStrip(1, 6);
    expect([s.width, s.height]).toEqual([6, 1]);
    s.pixelXY(4, 0, 1, 0, 0);
    expect(read(13, 15)).toEqual([255, 0, 0]);
  });

  it('lays pixels out in rows when told how wide it is', () => {
    const s = rgbStrip(1, 48, 0, { columns: 12 });
    expect([s.width, s.height]).toEqual([12, 4]);
    // Row 1, column 3 is pixel 15, so channels 46-48.
    s.pixelXY(3, 1, 1, 0, 0);
    expect(read(46, 48)).toEqual([255, 0, 0]);
  });

  it('sets a whole column across every row', () => {
    const s = rgbStrip(1, 48, 0, { columns: 12 });
    s.column(0, 1, 0, 0);
    // Pixels 0, 12, 24, 36: the first channel of each.
    expect([read(1, 1)[0], read(37, 37)[0], read(73, 73)[0], read(109, 109)[0]])
      .toEqual([255, 255, 255, 255]);
    // ...and nothing in column 1.
    expect(read(4, 4)).toEqual([0]);
  });

  it('sets a whole row', () => {
    const s = rgbStrip(1, 48, 0, { columns: 12 });
    s.row(1, 0, 1, 0);
    expect(read(37, 42)).toEqual([0, 255, 0, 0, 255, 0]);  // row 1 starts at pixel 12
    expect(read(1, 3)).toEqual([0, 0, 0]);                  // row 0 untouched
  });

  it('walks the grid with eachXY, giving x, y and the dimensions', () => {
    const s = rgbStrip(1, 48, 0, { columns: 12 });
    const seen: Array<[number, number, number, number]> = [];
    s.eachXY((x, y, w, h) => { seen.push([x, y, w, h]); return 0; });
    expect(seen).toHaveLength(48);
    expect(seen[0]).toEqual([0, 0, 12, 4]);
    expect(seen[12]).toEqual([0, 1, 12, 4]);   // second row starts over at x = 0
    expect(seen[47]).toEqual([11, 3, 12, 4]);
  });

  it('mirrors odd rows when the strip is wired serpentine', () => {
    // 8 pixels, 4 wide. Row 1 is physically wired right-to-left, so grid x = 0
    // is the LAST pixel of that row. Getting this wrong is invisible until the
    // hardware is in front of you, which is why the fixture declares it.
    const snake = rgbStrip(1, 8, 0, { columns: 4, serpentine: true });
    snake.pixelXY(0, 1, 1, 0, 0);
    expect(read(22, 24)).toEqual([255, 0, 0]);   // pixel 7

    clearDefs();
    getUniverseBuffer(0).fill(0);
    const straight = rgbStrip(1, 8, 0, { columns: 4 });
    straight.pixelXY(0, 1, 1, 0, 0);
    expect(read(13, 15)).toEqual([255, 0, 0]);   // pixel 4
  });

  it('leaves row 0 alone on a serpentine strip', () => {
    const s = rgbStrip(1, 8, 0, { columns: 4, serpentine: true });
    s.pixelXY(0, 0, 1, 0, 0);
    expect(read(1, 3)).toEqual([255, 0, 0]);
  });

  it('refuses a width that would leave a ragged last row', () => {
    // Every (x, y) after the ragged row would land on the wrong pixel, so this
    // is caught at patch time rather than discovered on the rig.
    expect(() => rgbStrip(1, 48, 0, { columns: 7 })).toThrow(/do not divide into rows of 7/);
  });

  it('refuses a position outside the grid', () => {
    const s = rgbStrip(1, 48, 0, { columns: 12 });
    expect(() => s.pixelXY(12, 0, 1)).toThrow(/x 12 out of range \[0, 11\]/);
    expect(() => s.pixelXY(0, 4, 1)).toThrow(/y 4 out of range \[0, 3\]/);
  });

  it('carries the grid through a fixture definition', () => {
    // The whole point: the wash's shape is declared once, with the fixture,
    // rather than repeated in every scene that addresses it.
    defineFixture('wash-154', {
      name: 'Wash 154', manufacturer: 'Generic', type: 'generic', channelCount: 154,
      channels: [
        { offset: 0, name: 'dim', type: 'intensity' },
        { offset: 1, name: 'strobe', type: 'strobe' },
        { offset: 2, name: 'pixels', type: 'strip', pixelCount: 48, pixelLayout: 'rgb', columns: 12 },
        { offset: 146, name: 'sstrip', type: 'strip', pixelCount: 2, pixelLayout: 'rgbw' },
      ],
    });
    const w = fixture(1, 'wash-154');
    const px = w.pixels as ReturnType<typeof rgbStrip>;
    expect([px.width, px.height]).toEqual([12, 4]);
    px.pixelXY(0, 0, 1, 0, 0);
    expect(read(3, 5)).toEqual([255, 0, 0]);   // pixels start at channel 3
  });

  it('gives an RGBW grid the same treatment', () => {
    const s = rgbwStrip(1, 8, 0, { columns: 4 });
    expect([s.width, s.height]).toEqual([4, 2]);
    s.pixelXY(1, 1, 1, 0, 0, 0);
    expect(read(21, 24)).toEqual([255, 0, 0, 0]);   // pixel 5
  });
});

// ─── the warm/cold blinder ────────────────────────────────────────────────────

describe('emitters that are not called red, green or blue', () => {
  const BLINDER = {
    name: 'Blinder', manufacturer: 'Generic', type: 'generic' as const, channelCount: 4,
    channels: [
      { offset: 0, name: 'warm1', type: 'intensity' as const },
      { offset: 1, name: 'cold1', type: 'intensity' as const },
      { offset: 2, name: 'warm2', type: 'intensity' as const },
      { offset: 3, name: 'cold2', type: 'intensity' as const },
    ],
  };

  it('turns the whole thing off, which it used to leave lit', () => {
    // The bug this exists for: .off() walked six hardcoded names, so a blinder
    // matched none of them, both bulbs stayed at full, and the call reported
    // success. A blackout that does not black out.
    defineFixture('blinder', BLINDER);
    const b = fixture(1, 'blinder');
    setter(b, "warm1")(1);
    setter(b, "cold1")(1);
    b.off();
    expect(read(1, 4)).toEqual([0, 0, 0, 0]);
  });

  it('drives the whole thing to full, which it used to ignore', () => {
    defineFixture('blinder', BLINDER);
    fixture(1, 'blinder').full();
    expect(read(1, 4)).toEqual([255, 255, 255, 255]);
  });

  it('recognises an emitter from its declared type, whatever it is called', () => {
    expect(isEmitterChannel({ offset: 0, name: 'bulbA', type: 'intensity' })).toBe(true);
    expect(isEmitterChannel({ offset: 0, name: 'anything', type: 'intensity' })).toBe(true);
  });

  it('recognises the common colour names on untyped channels', () => {
    for (const name of ['red', 'warmWhite', 'cold_white', 'uv', 'lime', 'amber', 'cw']) {
      expect(isEmitterChannel({ offset: 0, name, type: 'generic' })).toBe(true);
    }
  });

  it('numbers a role without losing it', () => {
    // warm1 / cold2 are the same roles as warm / cold; a blinder just has two
    // of each.
    expect(isEmitterChannel({ offset: 0, name: 'warm1', type: 'generic' })).toBe(true);
    expect(isEmitterChannel({ offset: 0, name: 'cold2', type: 'generic' })).toBe(true);
  });

  it('leaves steering and shaping channels alone', () => {
    for (const name of ['pan', 'tilt', 'focus', 'zoom', 'speed']) {
      expect(isEmitterChannel({ offset: 0, name, type: 'control' })).toBe(false);
    }
  });

  it('says so rather than doing nothing when there is no emitter at all', () => {
    defineFixture('movement-only', {
      name: 'Yoke', manufacturer: 'Generic', type: 'generic', channelCount: 2,
      channels: [
        { offset: 0, name: 'pan', type: 'position' },
        { offset: 1, name: 'tilt', type: 'position' },
      ],
    });
    expect(() => fixture(1, 'movement-only').off()).toThrow(/no channel on this fixture emits light/);
  });

  it('says so when .color() lands on a fixture with no colour', () => {
    defineFixture('blinder', BLINDER);
    expect(() => fixture(1, 'blinder').color(1, 0, 0)).toThrow(/has no red\/green\/blue channels/);
  });
});

// ─── the moving head's wheels ─────────────────────────────────────────────────

describe('channels that select rather than dim', () => {
  const HEAD = {
    name: 'Beam', manufacturer: 'Generic', type: 'moving-head' as const, channelCount: 5,
    channels: [
      { offset: 0, name: 'pan', type: 'position' as const },
      { offset: 1, name: 'dim', type: 'intensity' as const },
      {
        offset: 2, name: 'color', type: 'color' as const,
        slots: [
          { name: 'open', value: 0 },
          { name: 'red', from: 10, to: 19 },
          { name: 'blue', from: 20, to: 29 },
          { name: 'red/blue', from: 40, to: 49 },
        ],
      },
      {
        offset: 3, name: 'gobo', type: 'control' as const,
        slots: [{ name: 'open', value: 0 }, { name: 'dots', from: 8, to: 15 }],
      },
      { offset: 4, name: 'focus', type: 'control' as const },
    ],
  };

  function head() {
    defineFixture('beam', HEAD);
    return fixture(1, 'beam');
  }


  it('takes a slot name instead of a number out of the manual', () => {
    setter(head(), "color")('red');
    expect(read(3, 3)).toEqual([15]);   // the middle of 10-19
  });

  it('aims at the middle of a range, not its edge', () => {
    // Manuals quote the edges, and hardware often treats a boundary as
    // belonging to the neighbouring slot, so the middle is the safe target.
    setter(head(), "gobo")('dots');
    expect(read(4, 4)).toEqual([12]);   // 8-15
  });

  it('matches a name regardless of case and punctuation', () => {
    const h = head();
    setter(h, "color")('RED/Blue');
    expect(read(3, 3)).toEqual([45]);
  });

  it('still takes a raw DMX value', () => {
    setter(head(), "color")(37);
    expect(read(3, 3)).toEqual([37]);
  });

  it('steps through slots from a pattern', () => {
    // A named slot arriving from a pattern used to reach the buffer in the
    // wrong domain: pattern values are 0-1 levels, so a raw slot number was
    // above 1 and clamped, making every colour come out as full.
    const cycle: PatternLike = {
      queryArc: (b) => [{ value: ['red', 'blue', 'open'][Math.floor(b) % 3] }],
    };
    setter(head(), "color")(cycle);
    tick(0); expect(getUniverseBuffer(0)[2]).toBe(15);
    tick(1); expect(getUniverseBuffer(0)[2]).toBe(25);
    tick(2); expect(getUniverseBuffer(0)[2]).toBe(0);
  });

  it('names the slots it does have when given one it does not', () => {
    expect(() => setter(head(), "color")('puce'))
      .toThrow(/no slot named "puce"\. Available: open, red, blue, red\/blue/);
  });

  it('lists the slots on a channel', () => {
    expect(head().slots('color')).toEqual(['open', 'red', 'blue', 'red/blue']);
    expect(head().slots('focus')).toEqual([]);
  });

  it('leaves the wheels where they are through a blackout', () => {
    // A slotted channel selects; it does not emit. Driving a colour wheel to
    // full during .full() would spin it to whatever slot sits at 255.
    const h = head();
    setter(h, "color")('red');
    setter(h, "gobo")('dots');
    h.full();
    expect(read(1, 5)).toEqual([0, 255, 15, 12, 0]);
  });
});
