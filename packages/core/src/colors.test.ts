/**
 * A colour is a value with two spellings and no others: a predefined name, or
 * three numbers. The quoted form is the one this file exists to keep out.
 *
 * A palette is a plain array of those values, so the tests below also pin the
 * line between the two spellings that are both arrays: [1, 0, 0.5] is one
 * colour and [red, blue] is two. Everything that reads a colour from a call
 * goes down one ladder, and the rung it stops on decides how many stops come
 * back, so the ladder is walked rung by rung here.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  COLORS,
  COLOR_NAMES,
  makeColor,
  livingColor,
  isColor,
  toColorValue,
  isPalette,
  phaseFor,
  sampleStops,
  mix,
  colorFromToken,
  colorPattern,
  readColorStops,
  readColor,
  readColorRun,
} from './colors.js';
import type { Color, ColorComponent } from './colors.js';

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

// ─── Fakes and small helpers ──────────────────────────────────────────────────

/** The hap shape a pattern answers with, as much of it as this file reads. */
type FakeHap = { value: unknown };
type FakePattern = { queryArc(begin: number, end: number): FakeHap[] };

/**
 * A pattern, as far as anything that takes a colour is concerned.
 *
 * strudel is never imported here. Its entry pulls in a browser-only module and
 * will not load under this runner, and it is not needed: `pick()` builds this
 * exact shape, an object whose only member is queryArc handing back haps with a
 * value, so a fake of the same shape is the thing itself rather than a stand-in.
 */
function fakePattern(...values: unknown[]): FakePattern {
  return { queryArc: () => values.map((value) => ({ value })) };
}

/** A pattern whose answer depends on the arc it was asked about, which is how a
 *  token can get past a check that only looks at the first cycle. */
function arcPattern(f: (begin: number, end: number) => unknown[]): FakePattern {
  return { queryArc: (begin, end) => f(begin, end).map((value) => ({ value })) };
}

/** Query one component the way the channel writer does, and read the levels
 *  out. Fails loudly on a plain number, since that is a different assertion. */
function levelsOf(c: ColorComponent, begin = 0, end = 1): number[] {
  if (typeof c === 'number') throw new Error(`expected a pattern component, got the number ${c}`);
  const haps = (c as { queryArc(b: number, e: number): FakeHap[] }).queryArc(begin, end);
  return haps.map((h) => h.value as number);
}

/**
 * The whole message, not a fragment of it.
 *
 * expect().toThrow(string) passes on a substring, which would let a reworded
 * message through. Scenes and the docs quote these strings, so they are pinned
 * whole.
 */
function messageOf(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    return (err as Error).message;
  }
  return '(did not throw)';
}

/** Written out rather than joined from COLOR_NAMES, so a reordered or renamed
 *  table shows up here as a failure instead of quietly rewriting the message. */
const NAME_LIST = 'red, orange, amber, yellow, green, cyan, blue, purple, magenta, pink, white';

// ─── The value layer ──────────────────────────────────────────────────────────

describe('toColorValue', () => {
  it('hands back a colour untouched', () => {
    expect(toColorValue(COLORS.red)).toBe(COLORS.red);
  });

  it('reads three numbers as one mix', () => {
    const c = toColorValue([1, 0, 0.5]);
    expect(c).toMatchObject({ r: 1, g: 0, b: 0.5 });
    expect(isColor(c)).toBe(true);
  });

  it('clamps a mix as it reads it', () => {
    expect(toColorValue([2, -1, 0.5])).toMatchObject({ r: 1, g: 0, b: 0.5 });
  });

  it('reads the first three numbers and ignores the rest', () => {
    // .pixelGrid() callbacks have handed back a fourth value before now.
    expect(toColorValue([1, 0, 0.5, 0.25])).toMatchObject({ r: 1, g: 0, b: 0.5 });
  });

  it('is null for anything that is neither', () => {
    expect(toColorValue([1, 0])).toBe(null);
    expect(toColorValue([1, 0, 'x'])).toBe(null);
    expect(toColorValue({ r: 1, g: 0, b: 0 })).toBe(null);
    expect(toColorValue('red')).toBe(null);
    expect(toColorValue(1)).toBe(null);
    expect(toColorValue(null)).toBe(null);
    expect(toColorValue(undefined)).toBe(null);
  });
});

describe('isPalette', () => {
  it('is a non-empty array of colours', () => {
    expect(isPalette([COLORS.red, COLORS.blue])).toBe(true);
    expect(isPalette([COLORS.red])).toBe(true);
  });

  it('reads three numbers as one colour and never as a palette', () => {
    // The whole reason a palette needs no brand: the two array spellings cannot
    // collide, because a number is not a colour and a colour is not a number.
    expect(isPalette([1, 0, 0.5])).toBe(false);
    expect(isColor(toColorValue([1, 0, 0.5]))).toBe(true);
  });

  it('takes an array of mixes as a palette', () => {
    expect(isPalette([[1, 0, 0], [0, 1, 0]])).toBe(true);
  });

  it('takes a mix and a name together', () => {
    expect(isPalette([COLORS.red, [0, 1, 0]])).toBe(true);
  });

  it('is false for an empty array, a single colour and a bad member', () => {
    expect(isPalette([])).toBe(false);
    expect(isPalette(COLORS.red)).toBe(false);
    expect(isPalette([COLORS.red, 'blue'])).toBe(false);
    expect(isPalette([COLORS.red, [1, 0]])).toBe(false);
  });
});

describe('phaseFor', () => {
  it('is 0 when there is nowhere to spread', () => {
    expect(phaseFor(0, 0)).toBe(0);
    expect(phaseFor(0, 1)).toBe(0);
    expect(phaseFor(3, 1)).toBe(0);
  });

  it('puts the two ends on the ends', () => {
    expect(phaseFor(0, 2)).toBe(0);
    expect(phaseFor(1, 2)).toBe(1);
  });

  it('spreads five evenly and reaches exactly 1 at the last one', () => {
    // Counting both ends. A cyclic phase would stop at 0.8 and leave the last
    // pixel short of the end colour.
    expect([0, 1, 2, 3, 4].map((i) => phaseFor(i, 5))).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(phaseFor(4, 5)).toBe(1);
  });
});

describe('sampleStops', () => {
  it('returns a single stop as the same object', () => {
    // toBe, not toEqual: chaseImpl short-cuts on a component being the exact
    // literal 0 or 1, and a copy would look equal while losing the short cut.
    const one = [COLORS.red];
    expect(sampleStops(one, 0)).toBe(COLORS.red);
    expect(sampleStops(one, 0.5)).toBe(COLORS.red);
    expect(sampleStops(one, 1)).toBe(COLORS.red);
  });

  it('returns each end as the same object', () => {
    const stops = [COLORS.red, COLORS.blue];
    expect(sampleStops(stops, 0)).toBe(COLORS.red);
    expect(sampleStops(stops, 1)).toBe(COLORS.blue);
  });

  it('blends the middle', () => {
    expect(sampleStops([COLORS.red, COLORS.blue], 0.5)).toMatchObject({ r: 0.5, g: 0, b: 0.5 });
  });

  it('clamps a phase from outside the run onto the nearest end', () => {
    const stops = [COLORS.red, COLORS.blue];
    expect(sampleStops(stops, 2)).toBe(COLORS.blue);
    expect(sampleStops(stops, -1)).toBe(COLORS.red);
  });

  it('walks a three stop palette', () => {
    const stops = [COLORS.red, COLORS.green, COLORS.blue];
    expect(sampleStops(stops, 0.25)).toMatchObject({ r: 0.5, g: 0.5, b: 0 });
    expect(sampleStops(stops, 0.75)).toMatchObject({ r: 0, g: 0.5, b: 0.5 });
    // A phase that lands on an inner stop is that stop, not a blend of it
    // with itself.
    expect(sampleStops(stops, 0.5)).toBe(COLORS.green);
  });
});

describe('mix', () => {
  it('blends two colours', () => {
    expect(mix(COLORS.red, COLORS.blue, 0.5)).toMatchObject({ r: 0.5, g: 0, b: 0.5 });
  });

  it('gives plain numbers back, which is what keeps a static palette free per tick', () => {
    const m = mix(COLORS.red, COLORS.blue, 0.25);
    expect(typeof m.r).toBe('number');
    expect(typeof m.g).toBe('number');
    expect(typeof m.b).toBe('number');
    expect(m).toMatchObject({ r: 0.75, g: 0, b: 0.25 });
  });

  it('returns the first colour at 0 and the second at 1, by identity', () => {
    expect(mix(COLORS.red, COLORS.blue, 0)).toBe(COLORS.red);
    expect(mix(COLORS.red, COLORS.blue, 1)).toBe(COLORS.blue);
  });

  it('clamps the amount to the two ends', () => {
    expect(mix(COLORS.red, COLORS.blue, 1.5)).toBe(COLORS.blue);
    expect(mix(COLORS.red, COLORS.blue, -1)).toBe(COLORS.red);
  });

  it('refuses anything that is not a colour, and says how to write one', () => {
    expect(messageOf(() => mix([1, 0, 0] as unknown as Color, COLORS.blue, 0.5))).toBe(
      'mix(): needs two colours and an amount, as in mix(red, blue, 0.5). ' +
      `Write a colour as one of ${NAME_LIST} without quotes, or as three numbers from 0 to 1.`,
    );
    expect(() => mix(COLORS.red, undefined as unknown as Color, 0.5)).toThrow(/needs two colours/);
    expect(() => mix(COLORS.red, 'blue' as unknown as Color, 0.5)).toThrow(/needs two colours/);
  });

  it('waits for query time when a component is a pattern', () => {
    const live = livingColor(fakePattern(0.4), 0, 0);
    const m = mix(live, COLORS.blue, 0.5);
    expect(levelsOf(m.r)).toEqual([0.2]);
    // The other two components were numbers on both sides, so they blended now.
    expect(m.b).toBe(0.5);
  });

  it('waits for query time when the amount is a pattern', () => {
    const m = mix(COLORS.red, COLORS.blue, fakePattern(0.25));
    expect(levelsOf(m.r)).toEqual([0.75]);
    expect(levelsOf(m.b)).toEqual([0.25]);
  });

  it('clamps an amount that arrives as a pattern', () => {
    const m = mix(COLORS.red, COLORS.blue, fakePattern(2));
    expect(levelsOf(m.r)).toEqual([0]);
    expect(levelsOf(m.b)).toEqual([1]);
  });

  it('takes the highest of several haps in one arc', () => {
    // The same merge tick() applies to anything overlapping.
    const live = livingColor(fakePattern(0.25, 0.75), 0, 0);
    expect(levelsOf(mix(live, COLORS.blue, 0.5).r)).toEqual([0.375]);
  });

  it('reads a component with no haps as dark, so a rest is a gap', () => {
    const live = livingColor(fakePattern(), 0, 0);
    expect(levelsOf(mix(live, COLORS.white, 0.5).r)).toEqual([0.5]);
  });
});

// ─── Naming a colour ──────────────────────────────────────────────────────────

describe('colorFromToken', () => {
  it('takes a full name and hands back the table entry itself', () => {
    expect(colorFromToken('cyan', '.chase()')).toBe(COLORS.cyan);
  });

  it('takes any prefix that names only one colour', () => {
    expect(colorFromToken('r', '.chase()')).toBe(COLORS.red);
    expect(colorFromToken('cy', '.chase()')).toBe(COLORS.cyan);
    expect(colorFromToken('gre', '.chase()')).toBe(COLORS.green);
  });

  it('trims and lowercases before it looks', () => {
    expect(colorFromToken('  RED ', '.chase()')).toBe(COLORS.red);
    expect(colorFromToken('\tCy\n', '.chase()')).toBe(COLORS.cyan);
  });

  it('says which colours a shared prefix could mean, and the shortest way to say each', () => {
    expect(messageOf(() => colorFromToken('p', '.chase()'))).toBe(
      '.chase(): "p" could be purple or pink. Write pu or pi, or the whole name.',
    );
  });

  it('lists the colours when the token is not one of them', () => {
    expect(messageOf(() => colorFromToken('puce', '.chase()'))).toBe(
      `.chase(): "puce" is not a colour. Write one of ${NAME_LIST}, ` +
      'or a prefix that names only one of them.',
    );
  });

  it('refuses an empty token', () => {
    expect(messageOf(() => colorFromToken('', '.chase()'))).toBe(
      `.chase(): "" is not a colour. Write one of ${NAME_LIST}, ` +
      'or a prefix that names only one of them.',
    );
    // Whitespace is trimmed to nothing, and the message quotes what was written.
    expect(messageOf(() => colorFromToken('   ', '.chase()'))).toBe(
      `.chase(): "   " is not a colour. Write one of ${NAME_LIST}, ` +
      'or a prefix that names only one of them.',
    );
  });

  it('refuses a token that names a property of the table rather than a colour', () => {
    // A plain index walks the prototype chain, so these came back as functions
    // and counted as colours: truthy, not a colour, and handed on unchecked.
    for (const key of ['constructor', 'toString', 'valueOf', '__proto__']) {
      expect(messageOf(() => colorFromToken(key, '.chase()'))).toBe(
        `.chase(): "${key}" is not a colour. Write one of ${NAME_LIST}, ` +
        'or a prefix that names only one of them.',
      );
    }
  });
});

describe('colorPattern', () => {
  it('gives one colour whose three components read the pattern', () => {
    const c = colorPattern(fakePattern(COLORS.blue), '.color()');
    expect(isColor(c)).toBe(true);
    expect(levelsOf(c.r)).toEqual([0]);
    expect(levelsOf(c.g)).toEqual([0]);
    expect(levelsOf(c.b)).toEqual([1]);
  });

  it('reads a bare number as a grey, the same rule as every other position', () => {
    const c = colorPattern(fakePattern(0.4), '.color()');
    expect(levelsOf(c.r)).toEqual([0.4]);
    expect(levelsOf(c.g)).toEqual([0.4]);
    expect(levelsOf(c.b)).toEqual([0.4]);
  });

  it('clamps a number that is out of range', () => {
    const c = colorPattern(fakePattern(2), '.color()');
    expect(levelsOf(c.r)).toEqual([1]);
  });

  it('reads a colour name in a hap', () => {
    const c = colorPattern(fakePattern('green'), '.color()');
    expect([levelsOf(c.r)[0], levelsOf(c.g)[0], levelsOf(c.b)[0]]).toEqual([0, 1, 0]);
  });

  it('reads a mix in a hap', () => {
    const c = colorPattern(fakePattern([1, 0, 0.5]), '.color()');
    expect([levelsOf(c.r)[0], levelsOf(c.g)[0], levelsOf(c.b)[0]]).toEqual([1, 0, 0.5]);
  });

  it('keeps everything else the hap was carrying', () => {
    // The hap is rewritten as it comes past rather than rebuilt, so whatever
    // the source put on it reaches the channel writer intact.
    const withWhole = {
      queryArc: () => [{ value: COLORS.blue, whole: { begin: 0, end: 0.5 } }],
    };
    const c = colorPattern(withWhole, '.color()');
    const haps = (c.b as { queryArc(b: number, e: number): unknown[] }).queryArc(0, 1);
    expect(haps[0]).toMatchObject({ whole: { begin: 0, end: 0.5 }, value: 1 });
  });

  it('throws while the scene is being evaluated when a token is a typo', () => {
    expect(messageOf(() => colorPattern(fakePattern('puce'), '.color()'))).toBe(
      `.color(): "puce" is not a colour. Write one of ${NAME_LIST}, ` +
      'or a prefix that names only one of them.',
    );
  });

  it('reports a token it only sees later once, and reads it as dark', () => {
    // Hidden behind the first cycle, the way an alternation hides one. Sixty
    // reports a second into a console nobody has open is the thing being
    // avoided, so the count is the assertion.
    const late = arcPattern((begin) => [begin === 0 ? 'red' : 'puce']);
    const c = colorPattern(late, '.color()');
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(levelsOf(c.r, 1, 2)).toEqual([0]);
      expect(levelsOf(c.g, 1, 2)).toEqual([0]);
      expect(levelsOf(c.b, 1, 2)).toEqual([0]);
      expect(errors).toHaveBeenCalledTimes(1);
      expect(errors.mock.calls[0][0]).toBe(
        `[gobo] .color(): "puce" is not a colour. Write one of ${NAME_LIST}, ` +
        'or a prefix that names only one of them.',
      );
    } finally {
      errors.mockRestore();
    }
  });

  it('reports a hap that is not a colour at all once, naming the type', () => {
    const c = colorPattern(fakePattern({ nope: true }), '.color()');
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(levelsOf(c.r)).toEqual([0]);
      expect(levelsOf(c.g)).toEqual([0]);
      expect(errors).toHaveBeenCalledTimes(1);
      expect(errors.mock.calls[0][0]).toBe('[gobo] .color(): cannot read a colour from object.');
    } finally {
      errors.mockRestore();
    }
  });

  it('leaves a source that throws on its own to report itself', () => {
    const angry = {
      queryArc(): Array<{ value: unknown }> {
        throw new Error('the source broke');
      },
    };
    expect(() => colorPattern(angry, '.color()')).not.toThrow();
  });
});

// ─── The reading ladder ───────────────────────────────────────────────────────

describe('readColorStops', () => {
  it('refuses a quoted colour first, before any other rung', () => {
    const quoted = '.chase(): colours are written without quotes. Use red rather than \'red\'.';
    expect(messageOf(() => readColorStops(['red'], '.chase()'))).toBe(quoted);
    // Moved any later, these would be read as arguments that are not colours
    // and come back with a worse message.
    expect(messageOf(() => readColorStops(['red', COLORS.blue], '.chase()'))).toBe(quoted);
    expect(messageOf(() => readColorStops(['red', 1, 0, 0], '.chase()'))).toBe(quoted);
    expect(messageOf(() => readColorStops(['red', 'green', 'blue'], '.chase()'))).toBe(quoted);
  });

  it('names the identifier trimmed and lowercased', () => {
    expect(messageOf(() => readColorStops([' RED '], '.chase()'))).toBe(
      '.chase(): colours are written without quotes. Use red rather than \' RED \'.',
    );
  });

  it('refuses a quoted word that is not a colour, and lists the ones that are', () => {
    expect(messageOf(() => readColorStops(['puce'], '.chase()'))).toBe(
      `.chase(): "puce" is not a colour. Write one of ${NAME_LIST} without quotes, ` +
      'or give three numbers from 0 to 1.',
    );
    // This rung looks the token up in the same table, so it needs the same
    // guard: 'constructor' is a property of every object and not a colour, and
    // reading it through the prototype chain sent the wrong message of the two.
    expect(messageOf(() => readColorStops(['constructor'], '.chase()'))).toBe(
      `.chase(): "constructor" is not a colour. Write one of ${NAME_LIST} without quotes, ` +
      'or give three numbers from 0 to 1.',
    );
  });

  it('gives one stop per colour, so two colours are two stops', () => {
    // .fill(red, blue) used to come back as a single stop and the second colour
    // went nowhere. Two arguments are two stops now.
    const stops = readColorStops([COLORS.red, COLORS.blue], '.fill()');
    expect(stops).toHaveLength(2);
    expect(stops[0]).toBe(COLORS.red);
    expect(stops[1]).toBe(COLORS.blue);
  });

  it('takes a mix beside a name', () => {
    const stops = readColorStops([COLORS.red, [0, 1, 0]], '.fill()');
    expect(stops).toHaveLength(2);
    expect(stops[0]).toBe(COLORS.red);
    expect(stops[1]).toMatchObject({ r: 0, g: 1, b: 0 });
  });

  it('takes one array of colours as the run of stops', () => {
    const warm = [COLORS.red, COLORS.orange, COLORS.yellow];
    const stops = readColorStops([warm], '.fill()');
    expect(stops).toHaveLength(3);
    expect(stops[0]).toBe(COLORS.red);
    expect(stops[2]).toBe(COLORS.yellow);
  });

  it('takes one array of mixes as the run of stops', () => {
    const stops = readColorStops([[[1, 0, 0], [0, 1, 0]]], '.fill()');
    expect(stops).toHaveLength(2);
    expect(stops[0]).toMatchObject({ r: 1, g: 0, b: 0 });
    expect(stops[1]).toMatchObject({ r: 0, g: 1, b: 0 });
  });

  it('reads one array of three numbers as one stop, not three', () => {
    const stops = readColorStops([[1, 0, 0.5]], '.fill()');
    expect(stops).toHaveLength(1);
    expect(stops[0]).toMatchObject({ r: 1, g: 0, b: 0.5 });
  });

  it('takes three numbers as one mixed stop', () => {
    const stops = readColorStops([1, 0.4, 0], '.color()');
    expect(stops).toHaveLength(1);
    expect(stops[0]).toMatchObject({ r: 1, g: 0.4, b: 0 });
  });

  it('clamps a mix given as three numbers', () => {
    expect(readColorStops([2, -1, 0.5], '.color()')[0]).toMatchObject({ r: 1, g: 0, b: 0.5 });
  });

  it('takes one pattern as one stop that changes over time', () => {
    // One colour for every position, so the run moves together in time rather
    // than across space.
    const stops = readColorStops([fakePattern('red')], '.color()');
    expect(stops).toHaveLength(1);
    expect(levelsOf(stops[0].r)).toEqual([1]);
    expect(levelsOf(stops[0].b)).toEqual([0]);
  });

  it('says what it needs when nothing matches', () => {
    const needs =
      `.chase(): needs a colour. Write one of ${NAME_LIST} without quotes, ` +
      'three numbers from 0 to 1, as in .chase(1, 0.4, 0), or an array of colours for a gradient.';
    expect(messageOf(() => readColorStops([], '.chase()'))).toBe(needs);
    expect(messageOf(() => readColorStops([{}], '.chase()'))).toBe(needs);
    expect(messageOf(() => readColorStops([1, 2], '.chase()'))).toBe(needs);
    expect(messageOf(() => readColorStops([[]], '.chase()'))).toBe(needs);
    expect(messageOf(() => readColorStops([[COLORS.red, 'blue']], '.chase()'))).toBe(needs);
  });

  it('spells the example from the name of the call it was given', () => {
    expect(messageOf(() => readColorStops([], '.fill()'))).toContain('as in .fill(1, 0.4, 0)');
  });
});

describe('readColor', () => {
  it('refuses a palette rather than quietly taking its first stop', () => {
    const refusal =
      '.color(): takes one colour, not 2. Take one stop with warm[0], ' +
      'or put the palette in time with cat(...warm).slow(4).';
    expect(messageOf(() => readColor([[COLORS.red, COLORS.blue]], '.color()'))).toBe(refusal);
    expect(messageOf(() => readColor([COLORS.red, COLORS.blue], '.color()'))).toBe(refusal);
  });

  it('counts the stops it refused', () => {
    expect(messageOf(() => readColor([[COLORS.red, COLORS.green, COLORS.blue]], '.color()')))
      .toContain('takes one colour, not 3');
  });

  it('takes a palette of one, since there is nothing to lose', () => {
    expect(readColor([[COLORS.red]], '.color()')).toBe(COLORS.red);
  });
});

describe('readColorRun', () => {
  it('repeats one stop across every position, by identity', () => {
    // Identity again, so .chase(red) across a strip keeps the short cut that a
    // rebuilt copy of red would lose.
    const run = readColorRun([COLORS.red], 3, '.chase()');
    expect(run).toHaveLength(3);
    for (const c of run) expect(c).toBe(COLORS.red);
  });

  it('takes the first stop when there is one position', () => {
    const run = readColorRun([[COLORS.red, COLORS.blue]], 1, '.fill()');
    expect(run).toHaveLength(1);
    expect(run[0]).toBe(COLORS.red);
  });

  it('puts one colour at each end of two positions', () => {
    const run = readColorRun([[COLORS.red, COLORS.blue]], 2, '.fill()');
    expect(run[0]).toBe(COLORS.red);
    expect(run[1]).toBe(COLORS.blue);
  });

  it('spreads two colours across five positions, ends included', () => {
    const run = readColorRun([COLORS.red, COLORS.blue], 5, '.fill()');
    expect(run.map((c) => c.r)).toEqual([1, 0.75, 0.5, 0.25, 0]);
    expect(run.map((c) => c.b)).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(run[0]).toBe(COLORS.red);
    expect(run[4]).toBe(COLORS.blue);
  });

  it('spreads three colours across five positions', () => {
    const run = readColorRun([[COLORS.red, COLORS.green, COLORS.blue]], 5, '.fill()');
    expect(run[0]).toBe(COLORS.red);
    expect(run[2]).toBe(COLORS.green);
    expect(run[4]).toBe(COLORS.blue);
    expect(run[1]).toMatchObject({ r: 0.5, g: 0.5, b: 0 });
    expect(run[3]).toMatchObject({ r: 0, g: 0.5, b: 0.5 });
  });
});
