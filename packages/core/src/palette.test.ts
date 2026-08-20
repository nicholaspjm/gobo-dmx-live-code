/**
 * Tests for the pattern side of a colour.
 *
 * A colour whose components are patterns is what lets `wash.color(mini('r - g
 * - b'))` and `pick()` keep moving without a re-run, so what matters here is
 * what a component answers when it is queried arc by arc: which haps come
 * back, what is in them, and what is left silent.
 *
 * The sources are hand rolled. @strudel/core cannot load under vitest, because
 * its entry pulls in a browser-only module, so nothing here imports it. A fake
 * shaped `{ queryArc(begin, end) { return [{ value }] } }` is not an
 * approximation of one either: it is the exact shape pick() builds in
 * controls.ts, and the shape dmx.ts documents as all a channel asks for.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

import {
  COLORS,
  colorPattern,
  isColor,
  livingColor,
  makeColor,
  mix,
  readColor,
  type Color,
  type ColorComponent,
} from './colors.js';

afterEach(() => {
  vi.restoreAllMocks();
});

/** A hap as a source hands it over. Only `value` is read by name; everything
 *  else is carried through, which is the subject of one of the tests below. */
type Hap = { value: unknown; [key: string]: unknown };

/** A source that answers with the same haps for every arc. No arguments is a
 *  source that answers with no haps at all, which is a rest. */
function source(...values: unknown[]) {
  return { queryArc: (): Hap[] => values.map((value) => ({ value })) };
}

/** A source that answers one thing in cycle 0 and another after it, which is
 *  the shape an alternation has: `<red blue>`. */
function afterFirstCycle(early: unknown, late: unknown) {
  return { queryArc: (begin: number): Hap[] => [{ value: begin < 1 ? early : late }] };
}

/** The haps a live component answers with over one arc. */
function haps(c: ColorComponent, begin = 0, end = 1): Hap[] {
  if (typeof c === 'number') {
    throw new Error(`expected a live component, got the plain number ${c}`);
  }
  return (c as { queryArc(b: number, e: number): Hap[] }).queryArc(begin, end);
}

/** The one level a live component reads as over one arc. */
function level(c: ColorComponent, begin = 0, end = 1): unknown {
  const out = haps(c, begin, end);
  expect(out).toHaveLength(1);
  return out[0].value;
}

/** All three components over one arc, for the common case of one hap each. */
function rgb(c: Color, begin = 0, end = 1): unknown[] {
  return [level(c.r, begin, end), level(c.g, begin, end), level(c.b, begin, end)];
}

describe('a colour read from a pattern', () => {
  it('reads a hap that carries a colour as that colour', () => {
    const c = colorPattern(source(COLORS.blue), '.color()');
    expect(isColor(c)).toBe(true);
    expect(rgb(c)).toEqual([0, 0, 1]);
  });

  it('reads a hap that carries a number as a grey', () => {
    // The same rule as a level position, so `mini('1 - 0.5 -')` means the same
    // shape in a colour call as it already does in a channel call.
    expect(rgb(colorPattern(source(0.4), '.color()'))).toEqual([0.4, 0.4, 0.4]);
    expect(rgb(colorPattern(source(2), '.color()'))).toEqual([1, 1, 1]);
  });

  it('reads a hap that carries a colour name, whole or as a prefix', () => {
    expect(rgb(colorPattern(source('green'), '.color()'))).toEqual([0, 1, 0]);
    // pi is the shortest prefix that names only pink, because p is also purple.
    expect(rgb(colorPattern(source('pi'), '.color()'))).toEqual([1, 0.35, 0.6]);
  });

  it('leaves a rest silent instead of turning it into black', () => {
    const rest = colorPattern(source(), '.color()');
    const black = colorPattern(source(makeColor(0, 0, 0)), '.color()');
    // Both look dark on the lamp, and they are still not the same thing. The
    // wrapper maps the source's haps, so a span the source said nothing about
    // stays a span nothing is said about. Black is one hap that reads zero.
    expect(haps(rest.r)).toEqual([]);
    expect(haps(rest.g)).toEqual([]);
    expect(haps(rest.b)).toEqual([]);
    expect(haps(black.r)).toEqual([{ value: 0 }]);
  });

  it('takes the highest level when a component is a pattern with several haps', () => {
    // A pick()-shaped colour: its components are patterns rather than numbers.
    // Several haps in one arc merge brightest-wins, the merge tick() already
    // applies to anything overlapping.
    const layered = { queryArc: (): Hap[] => [{ value: 0.2 }, { value: 0.9 }, { value: 0.5 }] };
    const c = colorPattern(source(livingColor(layered, 0.25, 0)), '.color()');
    expect(rgb(c)).toEqual([0.9, 0.25, 0]);
  });

  it('keeps everything else a hap carries', () => {
    const whole = { begin: 0, end: 1 };
    const part = { begin: 0, end: 0.5 };
    const src = {
      queryArc: (): Hap[] => [{ whole, part, value: COLORS.green, context: { locations: [] } }],
    };
    const [hap] = haps(colorPattern(src, '.color()').g);
    expect(hap.value).toBe(1);
    // The same span objects, not rebuilt ones. Only the value is rewritten.
    expect(hap.whole).toBe(whole);
    expect(hap.part).toBe(part);
    expect(hap.context).toEqual({ locations: [] });
  });

  it('reaches readColor as one colour that moves, not as a run of stops', () => {
    const c = readColor([afterFirstCycle(COLORS.red, COLORS.blue)], '.color()');
    expect(rgb(c, 0, 1)).toEqual([1, 0, 0]);
    expect(rgb(c, 1, 2)).toEqual([0, 0, 1]);
  });
});

describe('a colour pattern with a token it cannot read', () => {
  it('throws while the scene is evaluating when the typo shows in the first cycle', () => {
    expect(() => colorPattern(source('puce'), '.color()')).toThrow(/"puce" is not a colour/);
    // Named after the call, so the editor's banner says where to look.
    expect(() => colorPattern(source('puce'), '.color()')).toThrow(/^\.color\(\)/);
    // An ambiguous prefix fails the same way: p is both purple and pink.
    expect(() => colorPattern(source('p'), '.color()')).toThrow(/could be purple or pink/);
    expect(() => colorPattern(source('p'), '.color()')).toThrow(/Write pu or pi/);
    // The throw reaches the caller through the whole ladder, so the eval rolls
    // back and the rig holds the scene that was working.
    expect(() => readColor([source('puce')], '.color()')).toThrow(/"puce" is not a colour/);
  });

  it('does not catch a token that only turns up after the first cycle', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    // The probe reads one cycle, so this is the limit of checking without
    // running: `<red puce>` is clean at eval time and only reports later.
    const c = colorPattern(afterFirstCycle('red', 'puce'), '.color()');
    expect(errors).not.toHaveBeenCalled();
    expect(level(c.r, 0, 1)).toBe(1);
    expect(level(c.r, 1, 2)).toBe(0);
    expect(errors).toHaveBeenCalledTimes(1);
  });

  it('reports an unknown token once however many times it is queried', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const c = colorPattern(afterFirstCycle('red', 'puce'), '.color()');
    // Fifteen reads, which at 60 frames a second is a quarter of a second of a
    // show. One line in the console is the whole point of the reported set.
    for (let cycle = 1; cycle < 6; cycle++) {
      expect(level(c.r, cycle, cycle + 1)).toBe(0);
      expect(level(c.g, cycle, cycle + 1)).toBe(0);
      expect(level(c.b, cycle, cycle + 1)).toBe(0);
    }
    expect(errors).toHaveBeenCalledTimes(1);
    expect(String(errors.mock.calls[0][0])).toMatch(/^\[gobo\] \.color\(\): "puce" is not a colour/);
  });

  it('reports each unknown token, so two typos do not hide behind one line', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const c = colorPattern(afterFirstCycle('red', 'ochre'), '.color()');
    expect(level(c.r, 1, 2)).toBe(0);
    const d = colorPattern(afterFirstCycle('red', 'taupe'), '.color()');
    expect(level(d.r, 1, 2)).toBe(0);
    expect(errors).toHaveBeenCalledTimes(2);
  });

  it('reports a hap that is not a colour in any spelling, and reads it as 0', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const c = colorPattern(afterFirstCycle(COLORS.red, { r: 1, g: 0, b: 0 }), '.color()');
    // An unbranded object with r, g and b on it is the near miss worth naming:
    // it looks like a colour and is not one.
    expect(rgb(c, 1, 2)).toEqual([0, 0, 0]);
    expect(errors).toHaveBeenCalledTimes(1);
    expect(String(errors.mock.calls[0][0])).toMatch(/cannot read a colour from object/);
  });
});

describe('a colour pattern whose source throws', () => {
  const angry = {
    queryArc(): Hap[] {
      throw new Error('slider("tilt"): not declared in this scene');
    },
  };

  it('lets the source keep its own failure rather than reporting it as a typo', () => {
    // The probe is colorPattern looking for tokens it can refuse. A source that
    // fails on its own terms is somebody else's error, and swallowing it here
    // is what stops a colour call putting its name on an unrelated fault.
    const c = colorPattern(angry, '.color()');
    expect(isColor(c)).toBe(true);
  });

  it('is read as dark once something reduces it to a level', () => {
    const c = colorPattern(angry, '.color()');
    // The wrapper passes the throw on, because a rewrite has nothing to say
    // about it. It is contained where a level is taken: here in mix(), and in
    // tick(), which guards every def and puts that one channel in the banner.
    expect(() => haps(c.r)).toThrow(/not declared in this scene/);
    expect(level(mix(c, COLORS.white, source(0.5)).r)).toBe(0.5);
  });
});

describe('mix with an amount that is a pattern', () => {
  it('blends when it is queried, so the amount can keep moving', () => {
    expect(rgb(mix(COLORS.red, COLORS.blue, source(0.25)))).toEqual([0.75, 0, 0.25]);
    // One colour object, two arcs, two answers. The blend is not worked out at
    // the call and kept, which is what lets a fader run a crossfade.
    const moving = mix(COLORS.red, COLORS.blue, afterFirstCycle(0, 1));
    expect(rgb(moving, 0, 1)).toEqual([1, 0, 0]);
    expect(rgb(moving, 1, 2)).toEqual([0, 0, 1]);
  });

  it('blends endpoints whose own components are patterns', () => {
    const live = livingColor(source(0.5), source(0.5), source(0.5));
    expect(rgb(mix(live, COLORS.white, source(0.5)))).toEqual([0.75, 0.75, 0.75]);
  });

  it('holds an amount that reads outside 0 to 1 at the near end', () => {
    const over = mix(COLORS.red, COLORS.blue, source(2));
    expect(rgb(over)).toEqual([0, 0, 1]);
    // It reads as blue and it is not blue. The identity short cut is only for
    // an amount that is already a number when mix() is called.
    expect(over).not.toBe(COLORS.blue);
    // A negative never reaches the clamp: brightest-wins floors at 0 first.
    expect(rgb(mix(COLORS.red, COLORS.blue, source(-1)))).toEqual([1, 0, 0]);
  });

  it('reads an amount with no haps as none of the way, so a rest holds the first colour', () => {
    expect(rgb(mix(COLORS.red, COLORS.blue, source()))).toEqual([1, 0, 0]);
  });

  it('still hands back an endpoint by identity when the amount is a plain 0 or 1', () => {
    // Identity, not a copy that matches: chaseImpl short-cuts on a component
    // being the exact literal 0 or 1, so a rebuilt red would take a slower path.
    expect(mix(COLORS.red, COLORS.blue, 0)).toBe(COLORS.red);
    expect(mix(COLORS.red, COLORS.blue, 1)).toBe(COLORS.blue);
  });
});
