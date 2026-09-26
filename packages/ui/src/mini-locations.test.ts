/**
 * Rewriting mini() so its leaves know where they came from.
 *
 * This runs on the path that guarantees a mistyped paren leaves the rig
 * exactly as it was, so the bar is not "does it tag things" but "does it ever
 * change the meaning of a scene". Everything it is unsure of it must leave
 * alone: a missed call costs an outline, a wrong rewrite costs the show.
 */

import { describe, it, expect } from 'vitest';

import { tagLocations, tagMiniLocations } from './mini-locations.js';

describe('tagMiniLocations', () => {
  it('renames the call, because mini() has no offset parameter', () => {
    // Adding a second argument to mini() would be silently ignored and nothing
    // would ever light up. It has to become m().
    const out = tagMiniLocations("bar.dim(mini('1 0'))");
    expect(out.tagged).toBe(1);
    expect(out.code).toContain("m('1 0', ");
    expect(out.code).not.toContain('mini(');
  });

  it('passes the offset of the opening quote', () => {
    // @strudel/mini re-adds the quote before parsing and counts from there,
    // so the offset of the first character inside would be one column left.
    const src = "x(mini('1 0'))";
    const quote = src.indexOf("'");
    expect(tagMiniLocations(src).code).toContain(`, ${quote})`);
  });

  it('leaves a call inside a comment alone', () => {
    const src = "// bar.dim(mini('1 0'))\nbar.full()";
    expect(tagMiniLocations(src)).toEqual({ code: src, tagged: 0 });
  });

  it('leaves a call inside a string alone', () => {
    const src = `const s = "bar.dim(mini('1 0'))"`;
    expect(tagMiniLocations(src)).toEqual({ code: src, tagged: 0 });
  });

  it('leaves a method call of the same name alone', () => {
    // someone.mini(…) is not ours to rewrite.
    const src = "thing.mini('1 0')";
    expect(tagMiniLocations(src)).toEqual({ code: src, tagged: 0 });
  });

  it('leaves a call that is already passing an offset alone', () => {
    const src = "x(m('1 0', 4))";
    expect(tagMiniLocations(src)).toEqual({ code: src, tagged: 0 });
  });

  it('leaves a non-literal argument alone', () => {
    const src = 'x(mini(pattern))';
    expect(tagMiniLocations(src)).toEqual({ code: src, tagged: 0 });
  });

  it('leaves a string with an escape alone', () => {
    const src = "x(mini('a\\'b'))";
    expect(tagMiniLocations(src)).toEqual({ code: src, tagged: 0 });
  });

  it('leaves a multi-argument mini alone', () => {
    // mini('a', 'b') sequences two strings; m() takes one.
    const src = "x(mini('1 0', '0 1'))";
    expect(tagMiniLocations(src)).toEqual({ code: src, tagged: 0 });
  });

  it('handles several calls on one line without shifting the later offsets', () => {
    const src = "a(mini('1 0')); b(mini('0 1'))";
    const firstQuote = src.indexOf("'");
    const secondQuote = src.indexOf("'", src.indexOf('b('));
    const out = tagMiniLocations(src);
    expect(out.tagged).toBe(2);
    expect(out.code).toContain(`, ${firstQuote})`);
    expect(out.code).toContain(`, ${secondQuote})`);
  });

  it('takes double quotes as readily as single', () => {
    expect(tagMiniLocations('x(mini("1 0"))').tagged).toBe(1);
  });

  it('changes nothing in a scene with no mini at all', () => {
    const src = "const wash = fixture(1, 'rgb')\nwash.color(red)";
    expect(tagMiniLocations(src)).toEqual({ code: src, tagged: 0 });
  });
});

describe("strudel's names for the inline visuals", () => {
  it('tags them with their offset the same way', () => {
    const src = "wash.dim(sine._scope())";
    const out = tagLocations(src).code;
    expect(out).toContain(`._scope(${src.indexOf('._scope')})`);
  });
});
