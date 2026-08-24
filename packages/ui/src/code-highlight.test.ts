/**
 * What the semantic highlighter is allowed to paint.
 *
 * The rule these exist to hold is that only code gets painted. A colour name
 * inside quotes is a colour wheel slot, a label on a mechanical position, and
 * painting it the colour it spells says something untrue about the rig. A
 * command name inside a comment is not a command at all.
 *
 * classifyTokens is the whole painting decision as a pure function, so all of
 * this runs without an editor or a DOM. Importing the module also exercises
 * the buildTable() collision check, which runs at load and throws if two
 * categories ever claim the same name.
 */

import { describe, it, expect } from 'vitest';
import { stripNonCode } from './source-scan.js';
import { classifyTokens } from './code-highlight.js';

/** Each painted token as `[text, class]`, in document order. */
function paint(source: string): Array<[string, string]> {
  return classifyTokens(source).map((s) => [
    source.slice(s.from, s.to),
    s.deco.spec.class as string,
  ]);
}

/** The classes painted onto one piece of text, ignoring where they landed. */
function classes(source: string): string[] {
  return paint(source).map(([, cls]) => cls);
}

describe('the offsets the decorations rely on', () => {
  it('is the same length stripped as it was in the source', () => {
    // The decorations are positional. If the strip is even one character
    // shorter, every token after the first string is painted in the wrong
    // place, and a range past the end of the document throws inside
    // CodeMirror. Every construct that consumes two characters at once is
    // here: the comment openers and closers, an escape pair, and `${`.
    const samples = [
      "head.color('red')",
      'head.color("red")',
      'const s = `${ pick(\'warm\') } red`',
      "wash.red(1) // red\nwash.blue(1)",
      '/* red\n   blue */\nwash.green(1)',
      "const a = 'it\\'s red'",
      'const a = 1 /* mid */ + 2',
      "const url = 'udp://127.0.0.1:57120'",
      '',
      '\n\n',
      "const a = 'unterminated\nwash.red(1)",
    ];
    for (const source of samples) {
      expect(stripNonCode(source).join('\n')).toHaveLength(source.length);
    }
  });

  it('paints the token it says it paints', () => {
    // Guards the same thing from the other side: the range handed to the
    // builder has to cover the identifier itself, not text near it.
    const source = "head.color('red')\nwash.blue(1)";
    for (const span of classifyTokens(source)) {
      expect(source.slice(span.from, span.to)).toMatch(/^[A-Za-z_$][\w$]*$/);
    }
  });
});

describe('a colour name that is not a colour', () => {
  it('leaves a wheel slot in single quotes alone', () => {
    // The reason the whole strip is here: 'red' is a slot on a colour wheel,
    // a mechanical position with a label on it. `.color` is still a call.
    expect(paint("head.color('red')")).toEqual([['color', 'gobo-color']]);
  });

  it('leaves a wheel slot in double quotes alone', () => {
    expect(paint('head.color("red")')).toEqual([['color', 'gobo-color']]);
  });

  it('leaves a colour name inside a template literal alone', () => {
    expect(classes('const s = `red and blue`')).toEqual([]);
  });

  it('leaves a fixture id inside a string alone', () => {
    // `rgb` is the bare low-level DMX write, and was painted as one here.
    expect(paint("const wash = fixture(1, 'rgb')")).toEqual([
      ['wash', 'gobo-fixture-decl'],
      ['fixture', 'gobo-factory'],
    ]);
  });

  it('leaves a command name in a line comment alone', () => {
    expect(classes('// wash.red(1) needs sine and setBPM')).toEqual([]);
  });

  it('leaves a command name behind a trailing comment alone', () => {
    expect(paint('wash.blue(1) // was red')).toEqual([['blue', 'gobo-color-blue']]);
  });

  it('leaves a command name in a block comment alone', () => {
    const source = ['/*', 'wash.red(1)', 'osc(9000)', '*/'].join('\n');
    expect(classes(source)).toEqual([]);
  });

  it('picks code back up after a block comment closes', () => {
    expect(paint('/* red */ wash.green(1)')).toEqual([['green', 'gobo-color-green']]);
  });

  it('does not let a commented-out declaration bind a name', () => {
    // A declaration that has been commented out binds nothing when the scene
    // runs, so the uses below it are ordinary variables, not fixtures.
    const source = ["// const wash = fixture(1, 'rgb')", 'wash.red(1)'].join('\n');
    expect(paint(source)).toEqual([['red', 'gobo-color-red']]);
  });
});

describe('what is still code, and still painted', () => {
  it('paints a bare colour name', () => {
    expect(paint('head.color(red)')).toEqual([
      ['color', 'gobo-color'],
      ['red', 'gobo-color-red'],
    ]);
  });

  it('paints inside a template interpolation', () => {
    // The literal text of a template is not code, but a `${…}` hole is, and
    // source-scan hands the hole back as code. Inheriting that rather than
    // treating the whole template as text is the point.
    expect(paint('const s = `slot ${pick(red)} on`')).toEqual([
      ['pick', 'gobo-color'],
      ['red', 'gobo-color-red'],
    ]);
  });

  it('paints an ordinary scene the same way it always did', () => {
    const source = [
      "const wash = fixture(1, 'rgbw')",
      'setBPM(120)',
      'wash.dim(sine.slow(4))',
      'wash.red(1)',
    ].join('\n');
    expect(paint(source)).toEqual([
      ['wash', 'gobo-fixture-decl'],
      ['fixture', 'gobo-factory'],
      ['setBPM', 'gobo-clock'],
      ['wash', 'gobo-fixture-ref'],
      ['dim', 'gobo-intensity'],
      ['sine', 'gobo-pattern'],
      ['slow', 'gobo-pattern-chain'],
      ['wash', 'gobo-fixture-ref'],
      ['red', 'gobo-color-red'],
    ]);
  });

  it('keeps bare dim apart from .dim', () => {
    // Bare `dim` is the low-level DMX write; `.dim` is intensity. The dot
    // decides which table is consulted, and stripping must not disturb that.
    expect(paint('dim(1, 128)\nwash.dim(0.5)')).toEqual([
      ['dim', 'gobo-dmx'],
      ['dim', 'gobo-intensity'],
    ]);
  });

  it('is not fooled by two slashes inside a string', () => {
    expect(paint("osc('udp://127.0.0.1:57120')\nwash.red(1)")).toEqual([
      ['osc', 'gobo-output'],
      ['red', 'gobo-color-red'],
    ]);
  });

  it('carries an unterminated quote no further than its line', () => {
    // A half-typed string is the normal state of a buffer being edited. The
    // rest of the scene has to keep its colours while one is open.
    expect(paint("const label = 'red\nwash.blue(1)")).toEqual([['blue', 'gobo-color-blue']]);
  });

  it('does not paint the e5 inside a numeric literal', () => {
    // `m` is a pattern constructor, so `1m` would be painted if the scan did
    // not reject a match that starts mid-token.
    expect(classes('const n = 1e5\nconst p = 1m')).toEqual([]);
  });
});
