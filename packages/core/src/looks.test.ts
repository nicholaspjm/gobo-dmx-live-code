/**
 * Looks written as named blocks, and mutes written with an underscore: the
 * rewrite that turns them into JavaScript before the scene compiles.
 */

import { describe, it, expect } from 'vitest';

import { danglingPatternLines, isMuteLabel, quotedReceivers, rewriteLooks } from './looks.js';

describe('a named block is a look', () => {
  it('becomes a function with that name, on the same lines', () => {
    const src = 'verse: {\n  wash.color(blue)\n}\ncue(verse)';
    const out = rewriteLooks(src);
    expect(out.looks).toEqual(['verse']);
    expect(out.code).toBe('const verse = function verse() {\n  wash.color(blue)\n};\ncue(verse)');
    expect(out.code.split('\n')).toHaveLength(src.split('\n').length);
  });

  it('finds several, and the brace that closes each', () => {
    const src = "verse: { wash.color(blue); strb.dim(mini('1 - 1 -')) }\nchorus: {\n  if (x) { y() }\n}";
    const out = rewriteLooks(src);
    expect(out.looks).toEqual(['verse', 'chorus']);
    expect(out.code).toContain('const chorus = function chorus() {\n  if (x) { y() }\n};');
  });

  it('is not fooled by braces in strings and comments', () => {
    const src = "verse: {\n  wash.color(mini('{1 0}')) // a } here\n}";
    expect(rewriteLooks(src).code.endsWith('};')).toBe(true);
  });
});

describe('an underscore mutes', () => {
  it("mutes a block, strudel's _name", () => {
    // Still declared, as nothing, so cue(verse, …) goes on working.
    expect(rewriteLooks('_verse: {\n  wash.red(1)\n}').code).toBe('const verse = null; if (0) {\n  wash.red(1)\n}');
  });

  it("mutes one line, strudel's _$", () => {
    expect(rewriteLooks('_$: wash.red(sine)').code).toBe('if (0) wash.red(sine)');
  });

  it('mutes with a trailing underscore too', () => {
    expect(rewriteLooks('verse_: { a() }').code).toBe('const verse = null; if (0) { a() }');
  });

  it('knows which labels mute', () => {
    expect(isMuteLabel('_verse')).toBe(true);
    expect(isMuteLabel('verse_')).toBe(true);
    expect(isMuteLabel('_$')).toBe(true);
    expect(isMuteLabel('_')).toBe(false);
    expect(isMuteLabel('verse')).toBe(false);
  });
});

describe('what the editor marks', () => {
  it('reports where each look is named and what each mute covers', () => {
    const src = 'verse: {\n  a()\n}\n_chorus: {\n  b()\n}\n_$: c()';
    const out = rewriteLooks(src);
    expect(out.labels).toEqual([{ name: 'verse', from: 0, to: 5 }]);
    expect(out.muted).toEqual([
      { from: src.indexOf('_chorus'), to: src.indexOf('}\n_$') + 1 },
      { from: src.indexOf('_$'), to: src.length },
    ]);
  });
});

describe('what is left alone', () => {
  it('object keys, and labels inside a block', () => {
    const src = "defineFixture('bar', {\n  name: 'Bar',\n})\nconst o = { verse: { a: 1 } }";
    expect(rewriteLooks(src).code).toBe(src);
  });

  it("strudel's $: on a single line, which runs as it always did", () => {
    expect(rewriteLooks('$: wash.red(sine)').code).toBe('$: wash.red(sine)');
  });

  it('a label inside a string or a comment', () => {
    const src = "// verse: {\nconst s = 'chorus: {'";
    expect(rewriteLooks(src).code).toBe(src);
  });

  it('a ternary carried onto the next line', () => {
    const src = 'const x = a\n  ? b\n  : c';
    expect(rewriteLooks(src).code).toBe(src);
  });

  it('a brace inside a regular expression', () => {
    const src = "verse: {\n  const re = /[{]/\n  wash.red(1)\n}\ncue(verse)";
    const out = rewriteLooks(src);
    expect(out.looks).toEqual(['verse']);
    expect(out.code).toContain('wash.red(1)\n};\ncue(verse)');
  });

  it('a slash that divides, which is not a regular expression', () => {
    const src = 'verse: {\n  wash.dim(a / 2)\n}';
    expect(rewriteLooks(src).code).toBe('const verse = function verse() {\n  wash.dim(a / 2)\n};');
  });
});

describe('what still parses', () => {
  it('a muted declaration', () => {
    const out = rewriteLooks('_$: const x = 1\nx');
    expect(out.code).toBe('if (0) var x = 1\nx');
    expect(() => new Function(out.code)).not.toThrow();
  });

  it('break out of a look, which becomes return', () => {
    const out = rewriteLooks('verse: {\n  if (a) break verse\n  b()\n}');
    expect(out.code).toBe('const verse = function verse() {\n  if (a) return\n  b()\n};');
    expect(() => new Function('a', 'b', out.code)).not.toThrow();
  });
});

describe('a chain that starts on a quoted pattern', () => {
  const pattern = (name: string): boolean => ['fast', 'slow', 'fadeOut'].includes(name);
  const spots = (src: string) => quotedReceivers(src, pattern).map(({ from, to }) => src.slice(from, to));

  it("finds strudel's \"1 0\".fast(2), in either quote", () => {
    expect(spots(`wash.dim("1 0".fast(2))`)).toEqual(['"1 0"']);
    expect(spots("wash.dim('1 - - -'.fadeOut(2))")).toEqual(["'1 - - -'"]);
  });

  it('finds one carried onto the next line', () => {
    expect(spots("wash.dim('1 0'\n  .slow(2))")).toEqual(["'1 0'"]);
  });

  it("leaves a string's own methods, other names, and strings in comments alone", () => {
    expect(spots("'a b'.split(' ')")).toEqual([]);
    expect(spots("'a b'.nope(1)")).toEqual([]);
    expect(spots("// '1 0'.fast(2)")).toEqual([]);
    expect(spots("wash.dim('1 0')")).toEqual([]);
  });
});

describe('what the review found', () => {
  it('a ternary carried across lines is not a label', () => {
    const src = 'const cfg = big ?\n  small : { v: 0.5 }';
    expect(rewriteLooks(src).code).toBe(src);
    const muted = 'const x = night ?\n  _dark :\n  1';
    expect(rewriteLooks(muted).code).toBe(muted);
  });

  it('break verse written in a string or comment is left alone', () => {
    const out = rewriteLooks('verse: {\n  log("break verse") // break verse\n}');
    expect(out.code).toContain('"break verse"');
    expect(out.code).toContain('// break verse');
  });

  it('names the looks that are muted', () => {
    expect(rewriteLooks('_bridge: { a() }\n_$: b()').mutedLooks).toEqual(['bridge']);
  });
});

describe('a pattern handed to no light', () => {
  it('is found on a line of its own, quoted or from a signal', () => {
    expect(danglingPatternLines("const w = fixture(1, 'dim')\n'1 0'.fast(2)\nsine.slow(4)\nw.dim(saw)")).toEqual([2, 3]);
  });

  it('finds the editor-tagged form too', () => {
    expect(danglingPatternLines("m('1 0', 3).fast(2)")).toEqual([1]);
  });

  it('leaves lights, looks, mutes, assignments and inline pictures alone', () => {
    const src = "const p = sine.slow(4)\nverse: {\n  sine.slow(2)\n}\n_$: '1 0'\nsine._scope()\nmaster.dim(1)";
    expect(danglingPatternLines(src, ['_scope'])).toEqual([]);
  });
});
