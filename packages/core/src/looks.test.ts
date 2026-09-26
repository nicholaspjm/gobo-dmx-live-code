/**
 * Looks written as named blocks, and mutes written with an underscore: the
 * rewrite that turns them into JavaScript before the scene compiles.
 */

import { describe, it, expect } from 'vitest';

import { isMuteLabel, rewriteLooks } from './looks.js';

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
});
