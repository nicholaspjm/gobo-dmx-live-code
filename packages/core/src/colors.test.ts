/**
 * A colour is a value with two spellings and no others: a predefined name, or
 * three numbers. The quoted form is the one this file exists to keep out.
 */

import { describe, it, expect } from 'vitest';
import { COLORS, COLOR_NAMES, makeColor, isColor, readColor } from './colors.js';

describe('the colour vocabulary', () => {
  it('is one table, and every entry is a colour value', () => {
    expect(COLOR_NAMES).toHaveLength(11);
    for (const name of COLOR_NAMES) expect(isColor(COLORS[name])).toBe(true);
  });

  it('cannot be edited by a scene', () => {
    expect(Object.isFrozen(COLORS)).toBe(true);
    expect(Object.isFrozen(COLORS.red)).toBe(true);
  });

  it('keeps white as the mix, not "every emitter"', () => {
    // A dedicated white LED is lit by .full(), not by the colour white, so a
    // three-component mix never disturbs it.
    expect(COLORS.white).toMatchObject({ r: 1, g: 1, b: 1 });
  });
});

describe('readColor', () => {
  it('takes a predefined colour', () => {
    expect(readColor([COLORS.blue], '.chase()')).toMatchObject({ r: 0, g: 0, b: 1 });
  });

  it('takes three numbers, the spelling .color() already uses', () => {
    expect(readColor([1, 0.4, 0], '.chase()')).toMatchObject({ r: 1, g: 0.4, b: 0 });
  });

  it('clamps a mix into range rather than passing it on', () => {
    expect(readColor([2, -1, 0.5], '.chase()')).toMatchObject({ r: 1, g: 0, b: 0.5 });
  });

  it('refuses a quoted colour, naming the identifier', () => {
    expect(() => readColor(['red'], '.chase()'))
      .toThrow(/colours are written without quotes. Use red rather than 'red'/);
  });

  it('refuses a quoted name that is not a colour, and lists the ones that are', () => {
    expect(() => readColor(['puce'], '.chase()')).toThrow(/"puce" is not a colour/);
    expect(() => readColor(['puce'], '.chase()')).toThrow(/red, orange, amber/);
  });

  it('treats a quoted name case-insensitively when telling you off', () => {
    expect(() => readColor([' RED '], '.chase()')).toThrow(/Use red rather than/);
  });

  it('names the call it was made from', () => {
    expect(() => readColor([undefined], '.chase()')).toThrow(/^\.chase\(\)/);
  });

  it('says what it needs when given nothing usable', () => {
    expect(() => readColor([], '.chase()')).toThrow(/needs a colour/);
    expect(() => readColor([{}], '.chase()')).toThrow(/needs a colour/);
    expect(() => readColor([1, 2], '.chase()')).toThrow(/needs a colour/);
  });

  it('still accepts an array, so a callback can hand one back', () => {
    // .each() and .pixelGrid() return [r, g, b]; that shape has to keep working.
    expect(readColor([[1, 0, 0.5]], '.chase()')).toMatchObject({ r: 1, g: 0, b: 0.5 });
  });
});

describe('makeColor', () => {
  it('brands what it builds, so a bare object is not mistaken for a colour', () => {
    expect(isColor(makeColor(0, 0, 0))).toBe(true);
    expect(isColor({ r: 1, g: 0, b: 0 })).toBe(false);
    expect(isColor([1, 0, 0])).toBe(false);
    expect(isColor('red')).toBe(false);
    expect(isColor(null)).toBe(false);
  });
});
