/**
 * The three verbs that work on any light.
 *
 * .mono() exists because .dim() cannot. A channel setter is only there when
 * the definition has that channel, so a bare rgb par — whose brightness lives
 * in its colour — answers "par.dim is not a function", which names the
 * variable and explains nothing. Brightness is a thing every light has; the
 * channel it arrives on is not.
 *
 * .temp() exists because lighting has always talked in Kelvin, and mixing a
 * tungsten white out of r, g and b by eye is arithmetic nobody should repeat.
 *
 * .solo() is the button every desk has.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { clearDefs, tick, getUniverseBuffer } from './dmx.js';
import {
  fixture, defineFixture, clearSimFixtures, clearFixtureActivity,
  group, rgbStrip, monoStrip,
} from './fixtures.js';
import { kelvinToColor } from './colors.js';

beforeEach(() => {
  clearDefs();
  clearSimFixtures();
  clearFixtureActivity();
  getUniverseBuffer(0).fill(0);
});

function chans(n: number): number[] {
  tick(0);
  return Array.from(getUniverseBuffer(0).slice(0, n));
}

describe('.mono()', () => {
  it('lights a par that has no dimmer, which .dim() cannot', () => {
    const par = fixture(1, 'rgb') as unknown as { mono(v: number): void; dim?: unknown };
    expect(typeof par.dim).toBe('undefined');   // the gap it fills
    par.mono(1);
    expect(chans(3)).toEqual([255, 255, 255]);
  });

  it('drives the master and the colour together on a dim-rgb par', () => {
    fixture(1, 'dim-rgb').mono(1);
    expect(chans(4)).toEqual([255, 255, 255, 255]);
  });

  it('works on a strip, a group and a mono strip alike', () => {
    const bar = rgbStrip(1, 2);
    bar.mono(1);
    expect(chans(6)).toEqual([255, 255, 255, 255, 255, 255]);

    clearDefs(); clearFixtureActivity(); getUniverseBuffer(0).fill(0);
    const cells = monoStrip(1, 3);
    cells.mono(1);
    expect(chans(3)).toEqual([255, 255, 255]);

    clearDefs(); clearFixtureActivity(); getUniverseBuffer(0).fill(0);
    group(fixture(1, 'rgb'), fixture(4, 'rgb')).mono(1);
    expect(chans(6)).toEqual([255, 255, 255, 255, 255, 255]);
  });

  it('takes a level, not only full', () => {
    fixture(1, 'rgb').mono(0.5);
    expect(chans(3)).toEqual([128, 128, 128]);
  });

  it('says so on a fixture that emits nothing', () => {
    defineFixture('mover', {
      name: 'Mover', manufacturer: 'test', type: 'generic', channelCount: 2,
      channels: [
        { offset: 0, name: 'pan', type: 'position' },
        { offset: 1, name: 'tilt', type: 'position' },
      ],
    });
    expect(() => (fixture(1, 'mover') as unknown as { mono(v: number): void }).mono(1))
      .toThrow(/no channel on this fixture emits light/);
  });
});

describe('.temp()', () => {
  it('puts a warm white on a par at tungsten', () => {
    fixture(1, 'rgb').temp(3200);
    const [r, g, b] = chans(3);
    expect(r).toBe(255);          // normalised on the brightest component
    expect(g).toBeLessThan(r);    // warm: green under red
    expect(b).toBeLessThan(g);    // and blue under green
  });

  it('goes blue above neutral', () => {
    fixture(1, 'rgb').temp(9000);
    const [r, , b] = chans(3);
    expect(b).toBeGreaterThan(r);
  });

  it('is a colour, not a brightness, so it pairs with .mono()', () => {
    const warm = kelvinToColor(3200);
    expect(Math.max(warm.r as number, warm.g as number, warm.b as number)).toBe(1);
  });

  it('clamps rather than extrapolating past the fit', () => {
    expect(() => fixture(1, 'rgb').temp(50)).not.toThrow();
    expect(() => fixture(4, 'rgb').temp(999999)).not.toThrow();
  });

  it('says what a colour temperature is when handed something else', () => {
    expect(() => (fixture(1, 'rgb') as unknown as { temp(k: unknown): void }).temp('warm'))
      .toThrow(/a number in Kelvin/);
  });
});

describe('.solo()', () => {
  it('darkens the others and leaves this one alone', () => {
    const a = fixture(1, 'rgb');
    const b = fixture(4, 'rgb');
    const c = fixture(7, 'rgb');
    a.full(); b.full(); c.full();
    expect(chans(9)).toEqual([255, 255, 255, 255, 255, 255, 255, 255, 255]);
    b.solo();
    expect(chans(9)).toEqual([0, 0, 0, 255, 255, 255, 0, 0, 0]);
  });

  it('reaches a bare strip too', () => {
    const par = fixture(1, 'rgb');
    const bar = rgbStrip(4, 2);
    par.full();
    bar.full();
    par.solo();
    expect(chans(10)).toEqual([255, 255, 255, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('forgets the rig between runs, as every other registry here does', () => {
    fixture(1, 'rgb').full();
    clearFixtureActivity();          // what eval.ts does before each run
    const par = fixture(1, 'rgb');
    expect(() => par.solo()).not.toThrow();
  });
});
