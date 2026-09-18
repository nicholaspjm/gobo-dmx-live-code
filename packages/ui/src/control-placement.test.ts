/**
 * Placing a control's handle on the line that declared it.
 *
 * The rule under test exists because of one shape of scene: a performance
 * file, where every look is a function and only the live one is called. Every
 * control inside a look that did not run is a call site in the source with no
 * registration behind it, so pairing the two lists by position puts handles on
 * the wrong lines — and a slider handle on the wrong line is read as the truth
 * about a light. Matching on the declared name is exact instead.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { declaredLines, quotedArgAt } from './control-placement.js';
import { stripNonCode } from './source-scan.js';

/** The shape refreshViz passes in: just enough of CodeMirror's Text. */
function docOf(source: string): { line: (n: number) => { text: string } } {
  const lines = source.split('\n');
  return { line: (n: number) => ({ text: lines[n - 1] }) };
}

/** Run the real pipeline: strip the source, then match names to lines. */
function place(source: string, pattern = /\bslider\s*\(/g): Map<string, number> {
  return declaredLines(docOf(source), stripNonCode(source), pattern);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('quotedArgAt', () => {
  it('reads a single-quoted name', () => {
    expect(quotedArgAt("slider('level')", 7)).toBe('level');
  });

  it('reads a double-quoted name', () => {
    expect(quotedArgAt('slider("level")', 7)).toBe('level');
  });

  it('allows whitespace before the quote', () => {
    expect(quotedArgAt("slider(  'level')", 7)).toBe('level');
  });

  it('refuses a name that is not a literal', () => {
    expect(quotedArgAt('slider(name)', 7)).toBeNull();
  });

  it('refuses a name carrying an escape, rather than half-reading it', () => {
    expect(quotedArgAt("slider('it\\'s')", 7)).toBeNull();
  });

  it('refuses an unterminated literal', () => {
    expect(quotedArgAt("slider('level", 7)).toBeNull();
  });
});

describe('declaredLines', () => {
  it('finds a control on its own line', () => {
    const map = place("const level = slider('level')\nwash.dim(level)");
    expect(map.get('level')).toBe(1);
  });

  it('is order-independent, which is the whole point', () => {
    // chorus is written first and verse is the one that runs. A positional
    // zip would hand verse's registration chorus's line.
    const source = [
      'const chorus = () => {',
      "  const amber = slider('amber')",
      '  wash.white(amber)',
      '}',
      'const verse = () => {',
      "  const level = slider('level')",
      '  wash.dim(level)',
      '}',
      'verse()',
    ].join('\n');
    const map = place(source);
    expect(map.get('level')).toBe(6);
    expect(map.get('amber')).toBe(2);
  });

  it('ignores a call site inside a comment', () => {
    const map = place("// const old = slider('old')\nconst level = slider('level')");
    expect(map.has('old')).toBe(false);
    expect(map.get('level')).toBe(2);
  });

  it('ignores a call site inside a string', () => {
    const map = place("const doc = \"slider('fake')\"\nconst level = slider('level')");
    expect(map.has('fake')).toBe(false);
    expect(map.get('level')).toBe(2);
  });

  it('finds two controls written on one line', () => {
    const map = place("const a = slider('a'), b = slider('b')");
    expect(map.get('a')).toBe(1);
    expect(map.get('b')).toBe(1);
  });

  it('drops a name declared twice rather than guessing which one ran', () => {
    // Both looks want a level. Only one of them can have run — declaring a
    // name twice in one run throws — and nothing in the text says which.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const source = [
      'const verse = () => {',
      "  const level = slider('level')",
      '  wash.dim(level)',
      '}',
      'const chorus = () => {',
      "  const level = slider('level')",
      '  bar.dim(level)',
      '}',
      'verse()',
    ].join('\n');
    const map = place(source);
    expect(map.has('level')).toBe(false);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toContain('own name');
  });

  it('keeps the unambiguous names when another one is ambiguous', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const source = [
      "const level = slider('level')",
      "const other = slider('level')",
      "const solo = slider('solo')",
    ].join('\n');
    const map = place(source);
    expect(map.has('level')).toBe(false);
    expect(map.get('solo')).toBe(3);
  });

  it('skips a control whose name is not a literal, leaving the rest placed', () => {
    const source = [
      'const made = slider(nameFromSomewhere)',
      "const level = slider('level')",
    ].join('\n');
    const map = place(source);
    expect(map.size).toBe(1);
    expect(map.get('level')).toBe(2);
  });

  it('matches pickers with the same rule', () => {
    const source = [
      'const chorus = () => {',
      "  const warm = pick('warm')",
      '  wash.color(warm)',
      '}',
    ].join('\n');
    const map = place(source, /\bpick\s*\(/g);
    expect(map.get('warm')).toBe(2);
  });
});
