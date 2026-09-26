/**
 * A syntax error gets a line, pointing at the line that holds the mistake
 * rather than the line where the parser noticed it.
 */

import { describe, it, expect } from 'vitest';

import { locateSyntaxError, syntaxErrorLine } from './syntax-line.js';

describe('the line a syntax error is on', () => {
  it('blames the line that left a bracket open, not the next one', () => {
    expect(syntaxErrorLine("artnet('2.0.0.100'\nconst pars = 1\nwash.color(1, 0, 0)")).toBe(1);
    expect(syntaxErrorLine('const a = 1\nwash.color(sine().slow(2), 0\nwash.dim(1)')).toBe(2);
  });

  it('skips blank lines on the way back', () => {
    expect(syntaxErrorLine("wash.dim(1\n\n\nwash.red(1)")).toBe(1);
  });

  it('finds a mistake in the middle of a line', () => {
    expect(syntaxErrorLine('wash.dim(1)\nwash.color(1 0 0)')).toBe(2);
    expect(syntaxErrorLine('wash.dim(1))\nwash.red(1)')).toBe(1);
  });

  it('finds an unclosed quote', () => {
    expect(syntaxErrorLine("wash.dim(1)\nmini('1 - 1 -)\nwash.dim(1)")).toBe(2);
  });

  it('says nothing about code that parses', () => {
    expect(syntaxErrorLine("const wash = fixture(1, 'rgb')\nwash.dim(1)")).toBeNull();
  });
});

describe('the message', () => {
  it('puts the line in front', () => {
    expect(locateSyntaxError('missing ) after argument list', "artnet('x'\nwash.dim(1)"))
      .toBe('line 1: missing ) after argument list');
  });

  it('leaves a message that already has a line alone', () => {
    expect(locateSyntaxError('line 4: wash.colr is not a function', 'x')).toBe('line 4: wash.colr is not a function');
  });

  it('explains an unexpected end instead of naming the last line', () => {
    expect(locateSyntaxError('Unexpected end of input', 'strip.each(p => {\n  return p\n'))
      .toContain('opened and never closed');
  });

  it('leaves a runtime error alone', () => {
    expect(locateSyntaxError('wash is not defined', 'wash.dim(1')).toBe('wash is not defined');
  });
});
