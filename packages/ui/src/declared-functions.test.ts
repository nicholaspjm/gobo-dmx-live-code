/**
 * Finding the functions a scene declares.
 *
 * In a performance file these are the looks — verse, chorus, breakdown — and
 * they are the names you type to change what the rig is doing. They are also
 * different in every document, so they are exactly the names worth offering
 * and the ones the completion list used to know nothing about.
 *
 * The scan errs towards finding too few. A shape it does not recognise costs a
 * completion; a name it invents is offered for something that is not there.
 */

import { describe, it, expect } from 'vitest';
import { findFunctions, functionSignature } from './declared-functions.js';

/** Just the names, in the order they were found. */
function names(doc: string): string[] {
  return findFunctions(doc).map((d) => d.name);
}

describe('findFunctions', () => {
  it('finds an arrow look with no parameters', () => {
    expect(names('const verse = () => { wash.red(1) }')).toEqual(['verse']);
  });

  it('finds several looks in source order', () => {
    const doc = [
      'const verse = () => {}',
      'const chorus = () => {}',
      'const breakdown = () => {}',
    ].join('\n');
    expect(names(doc)).toEqual(['verse', 'chorus', 'breakdown']);
  });

  it('finds a look that takes parameters, and keeps them', () => {
    const [decl] = findFunctions('const chorus = (level, colour) => {}');
    expect(decl.params).toBe('level, colour');
    expect(functionSignature(decl)).toBe('chorus(level, colour)');
  });

  it('finds a one-parameter arrow written without parens', () => {
    const [decl] = findFunctions('const scale = k => k * 2');
    expect(decl.name).toBe('scale');
    expect(decl.params).toBe('k');
  });

  it('finds a function expression', () => {
    expect(names('const verse = function (a) { return a }')).toEqual(['verse']);
  });

  it('finds an async look', () => {
    expect(names('const verse = async () => {}')).toEqual(['verse']);
  });

  it('finds a function declaration', () => {
    // The only way to name a look after one of gobo's own: const and let
    // collide with the sandbox parameter and a declaration does not.
    const [decl] = findFunctions('function strobe(rate) { wash.dim(1) }');
    expect(decl.name).toBe('strobe');
    expect(decl.params).toBe('rate');
  });

  it('works with let and var as well as const', () => {
    expect(names('let verse = () => {}\nvar chorus = () => {}')).toEqual(['verse', 'chorus']);
  });

  it('ignores a declaration inside a comment', () => {
    expect(names('// const old = () => {}\nconst verse = () => {}')).toEqual(['verse']);
  });

  it('ignores a declaration inside a string', () => {
    expect(names('const note = "const fake = () => {}"\nconst verse = () => {}')).toEqual(['verse']);
  });

  it('offers a name bound twice only once', () => {
    expect(names('const verse = () => {}\nconst verse = () => {}')).toEqual(['verse']);
  });

  it('does not mistake a plain value for a function', () => {
    const doc = [
      'const level = 0.5',
      "const wash = fixture(1, 'rgbw')",
      'const verse = () => {}',
    ].join('\n');
    expect(names(doc)).toEqual(['verse']);
  });

  it('does not mistake a call for a declaration', () => {
    expect(names('verse()\nchorus()')).toEqual([]);
  });

  it('finds nothing in a scene that declares nothing', () => {
    expect(names("const wash = fixture(1, 'rgbw')\nwash.red(1)")).toEqual([]);
  });
});
