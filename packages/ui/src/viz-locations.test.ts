/**
 * Giving a pattern-viz call the line it was written on.
 *
 * `.flash()` and `.glow()` have no name to be matched on the way slider() and
 * pick() do, and no argument either, so the UI paired them with call sites by
 * counting: the nth `.glow(` in the text got the nth registration.
 *
 * That holds only while every call site in the buffer ran, and in the file this
 * tool is for it never does. Write each look as a function, call one, and a
 * `.flash()` inside a look that did not run is a call site the scan sees and
 * the run never made — so the widget for the look that IS running is drawn on
 * the look that is not, which is read as the truth about a light.
 *
 * The fix is the one the token outlines already use: the offset is written into
 * the call on the way to eval, and the registration carries it back.
 */

import { describe, it, expect } from 'vitest';
import { tagLocations, tagMiniLocations } from './mini-locations.js';

/** Every offset a viz call was tagged with, in source order. */
function vizOffsets(source: string): number[] {
  const out: number[] = [];
  for (const m of tagLocations(source).code.matchAll(/\.(?:flash|glow|wave|roll|punchcard|spiral|spectrum)\((\d+)\)/g)) {
    out.push(Number(m[1]));
  }
  return out;
}

describe('tagging a pattern-viz call', () => {
  it('writes the offset of the dot into the call', () => {
    const source = 'wash.dim(sine().glow())';
    expect(vizOffsets(source)).toEqual([source.indexOf('.glow')]);
  });

  it('points at the line the call was written on', () => {
    const source = ['wash.red(sine().glow())', 'bar.blue(saw().flash())'].join('\n');
    const [first, second] = vizOffsets(source);
    expect(source.slice(0, first).split('\n').length).toBe(1);
    expect(source.slice(0, second).split('\n').length).toBe(2);
  });

  it('tags every kind', () => {
    const kinds = ['flash', 'glow', 'wave', 'roll', 'punchcard', 'spiral', 'spectrum'];
    for (const kind of kinds) {
      expect(vizOffsets(`wash.dim(sine().${kind}())`)).toHaveLength(1);
    }
  });

  it('tags two calls chained on one pattern', () => {
    expect(vizOffsets('wash.dim(sine().glow().flash())')).toHaveLength(2);
  });

  it('is the case that was broken: a call inside a look that never runs', () => {
    // Counting would give the chorus registration verse's line, because
    // verse's call site comes first in the text and never registered.
    const source = [
      'const verse = () => {',
      '  wash.red(sine().glow())',
      '}',
      'const chorus = () => {',
      '  wash.blue(saw().glow())',
      '}',
      'chorus()',
    ].join('\n');
    const offsets = vizOffsets(source);
    const lineOf = (at: number): number => source.slice(0, at).split('\n').length;
    // Each call carries its OWN line, whichever of them the run reaches.
    expect(offsets.map(lineOf)).toEqual([2, 5]);
  });
});

describe('what it leaves alone', () => {
  it('leaves a call that already has an argument', () => {
    // The methods take nothing today, so anything in the parens is something
    // this does not understand. It falls back to counting rather than guess.
    // Compared as source, because a call the user wrote an argument into is
    // indistinguishable from a tagged one by shape alone.
    const source = 'wash.dim(sine().glow(2))';
    expect(tagLocations(source).code).toBe(source);
  });

  it('leaves a call inside a comment', () => {
    expect(vizOffsets('// wash.dim(sine().glow())')).toEqual([]);
  });

  it('leaves a call inside a string', () => {
    expect(vizOffsets('const note = "sine().glow()"')).toEqual([]);
  });

  it('leaves a scene with no viz calls untouched', () => {
    const source = 'wash.red(1)';
    expect(tagLocations(source).code).toBe(source);
  });
});

describe('both kinds of tag in one pass', () => {
  it('measures every offset against the original document', () => {
    // The reason they are applied together. Tagging mini() first would move
    // everything after it, so a second pass would measure the viz offsets
    // against text that had already shifted.
    const source = "wash.red(mini('1 0 1 0'))\nbar.blue(sine().glow())";
    const at = vizOffsets(source)[0];
    expect(at).toBe(source.indexOf('.glow'));
    expect(source.slice(0, at).split('\n').length).toBe(2);
  });

  it('rewrites the mini call as well', () => {
    const code = tagLocations("wash.red(mini('1 0'))\nbar.blue(sine().glow())").code;
    // 14 is the offset of the opening quote, which is what @strudel/mini counts from.
    expect(code).toContain("m('1 0', 14)");
    expect(code).toMatch(/\.glow\(\d+\)/);
  });

  it('still produces runnable-looking code with several of each', () => {
    const source = [
      "wash.red(mini('1 0').glow())",
      "bar.blue(mini('0 1').flash())",
    ].join('\n');
    const code = tagLocations(source).code;
    expect(code.match(/m\('/g)).toHaveLength(2);
    expect(code.match(/\.(glow|flash)\(\d+\)/g)).toHaveLength(2);
  });

  it('leaves tagMiniLocations doing only its own half', () => {
    const code = tagMiniLocations("wash.red(mini('1 0').glow())").code;
    expect(code).toContain("m('1 0', 14)");
    expect(code).toContain('.glow()');
  });
});
