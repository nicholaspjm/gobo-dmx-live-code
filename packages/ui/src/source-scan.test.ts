/**
 * Which call sites the inline widgets are allowed to see.
 *
 * The rule these tests exist to hold is one line long: a call that is
 * commented out is not a call. Everything else here is the ways a buffer
 * being edited can look while that stays true, including the block comment
 * that was getting through and leaving a widget running on a dead line.
 *
 * No editor and no core here on purpose. The scan is a pure function over
 * text, which is what makes it testable at all.
 */

import { describe, it, expect } from 'vitest';
import { stripNonCode, findCalls } from './source-scan.js';

/** The line numbers a pattern matches, which is all the placement needs. */
function lines(source: string, pattern: RegExp): number[] {
  return findCalls(stripNonCode(source), pattern).map((h) => h.line);
}

const VIZ = /\.viz\s*\(/g;
const PICK = /\bpick\s*\(/g;

describe('stripNonCode', () => {
  it('keeps one output line per source line', () => {
    expect(stripNonCode('a\nb\nc')).toHaveLength(3);
    // A trailing newline opens a last, empty line, the same way the editor
    // counts one.
    expect(stripNonCode('a\n')).toHaveLength(2);
    expect(stripNonCode('')).toHaveLength(1);
  });

  it('blanks character for character, so columns do not move', () => {
    const [line] = stripNonCode("const a = 1 // '.viz('");
    expect(line).toHaveLength("const a = 1 // '.viz('".length);
    expect(line.trimEnd()).toBe('const a = 1');
  });

  it('leaves code alone, and empties the strings it holds', () => {
    const src = "const wash = fixture(1, 'rgbw').viz('color')";
    // Quotes stay so a reader can still see where a string was. What was
    // inside them is gone, because a call site written in a string is text.
    expect(stripNonCode(src)[0]).toBe("const wash = fixture(1, '    ').viz('     ')");
  });
});

describe('a commented-out call is not a call', () => {
  it('drops a line comment', () => {
    expect(lines("// const a = fixture(1, 'rgbw').viz('color')", VIZ)).toEqual([]);
  });

  it('drops a line comment behind indentation', () => {
    expect(lines("    // spot.viz('wave')", VIZ)).toEqual([]);
  });

  it('drops a call commented out halfway along the line', () => {
    expect(lines("const a = fixture(1, 'rgbw') // .viz('color')", VIZ)).toEqual([]);
  });

  it('drops a one-line block comment', () => {
    expect(lines("/* const a = fixture(1, 'rgbw').viz('color') */", VIZ)).toEqual([]);
  });

  it('drops a block comment spanning several lines', () => {
    const src = [
      "const wash = fixture(1, 'rgbw').viz('color')",
      '/*',
      "const strb = fixture(5, 'strobe').viz('meter')",
      "const beam = fixture(7, 'dim').viz('wave')",
      '*/',
      "const strip = rgbStrip(9, 10).viz('strip')",
    ].join('\n');
    // The point of the whole exercise: the two silenced lines take no place
    // in the list, so the strip's widget lands on line 6 and not on line 3.
    expect(lines(src, VIZ)).toEqual([1, 6]);
  });

  it('reopens code after the block comment closes on the same line', () => {
    expect(lines("/* off */ spot.viz('meter')", VIZ)).toEqual([1]);
  });
});

describe('what is not a comment stays code', () => {
  it('keeps a call whose line has a trailing comment', () => {
    expect(lines("const wash = fixture(1, 'rgbw').viz('color')   // uni 0", VIZ)).toEqual([1]);
  });

  it('is not fooled by two slashes inside a string', () => {
    // Cutting the line at the first pair of slashes used to lose this one.
    expect(lines("osc('udp://127.0.0.1:57120')\nwash.viz('color')", VIZ)).toEqual([2]);
  });

  it('is not fooled by a call site written inside a string', () => {
    expect(lines('const help = "call .viz(\'color\') to see it"', VIZ)).toEqual([]);
  });

  it('does not treat a template literal as code', () => {
    const src = ['strb.strobe(mini(`', "  - - - - .viz('meter')", '`))'].join('\n');
    expect(lines(src, VIZ)).toEqual([]);
  });

  it('reads an interpolation inside a template as code again', () => {
    expect(lines('const s = `${pick(\'warm\')}`', PICK)).toEqual([1]);
  });

  it('lets an object literal inside an interpolation close its own braces', () => {
    const src = ['const s = `${ f({ a: 1 }) } .viz(', '`', "wash.viz('color')"].join('\n');
    // The `.viz(` after the interpolation closes is template text, not code,
    // so only the real call on line 3 counts.
    expect(lines(src, VIZ)).toEqual([3]);
  });

  it('carries an unterminated quote no further than its line', () => {
    expect(lines(["const a = 'oops", "wash.viz('color')"].join('\n'), VIZ)).toEqual([2]);
  });

  it('keeps an escaped quote from ending the string', () => {
    expect(lines(["const a = 'it\\'s .viz( fine'", "wash.viz('color')"].join('\n'), VIZ)).toEqual([2]);
  });
});

describe('findCalls', () => {
  it('reports one hit per call, not per line', () => {
    // The registries push one entry per call, so two on a line have to come
    // back as two hits or every pairing after them is off by one.
    expect(lines("a.viz('color'); b.viz('meter')", VIZ)).toEqual([1, 1]);
  });

  it('reports hits in reading order', () => {
    const src = ["c.viz('meter')", "a.viz('color'); b.viz('wave')"].join('\n');
    expect(lines(src, VIZ)).toEqual([1, 2, 2]);
  });

  it('hands back the captured group', () => {
    const src = 'p.flash()\nq.spiral()';
    const hits = findCalls(stripNonCode(src), /\.(flash|glow|spiral)\s*\(/g);
    expect(hits.map((h) => [h.line, h.match[1]])).toEqual([[1, 'flash'], [2, 'spiral']]);
  });

  it('works with a pattern that was not written global', () => {
    expect(findCalls(stripNonCode("a.viz('color')"), /\.viz\s*\(/)).toHaveLength(1);
  });

  it('does not carry a lastIndex from one line to the next', () => {
    const src = ["                                        a.viz('color')", "b.viz('meter')"].join('\n');
    expect(lines(src, VIZ)).toEqual([1, 2]);
  });
});
