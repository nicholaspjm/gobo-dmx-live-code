/**
 * Committing only the edits you pointed at.
 *
 * The property every test here defends: what comes out is a COMPLETE document
 * — the last one that ran, with some edits applied — never a fragment. The
 * engine is never handed a partial picture, because a partial staging map
 * makes implied brightness infer from half a rig and turns hush() into a
 * no-op, and both of those are ways for a light to be wrong on stage with
 * nothing on screen to explain it.
 */

import { describe, it, expect } from 'vitest';
import { spliceEdits, paragraphAt, type Hunk } from './splice.js';

/** An edit, written the way CodeMirror reports one. */
function hunk(fromA: number, toA: number, fromB: number, insert: string): Hunk {
  return { fromA, toA, fromB, toB: fromB + insert.length, insert };
}

describe('spliceEdits', () => {
  it('applies an edit inside the region and leaves the rest of the document alone', () => {
    const lastGood = 'a\nb\nc';
    // 'b' -> 'B', at offset 2.
    const result = spliceEdits(lastGood, [hunk(2, 3, 2, 'B')], 2, 3);
    expect(result?.source).toBe('a\nB\nc');
  });

  it('leaves an edit outside the region out of the document that runs', () => {
    // The whole point: the half-written look stays out of the run.
    const lastGood = 'verse\nchorus';
    const edits = [hunk(0, 5, 0, 'VERSE'), hunk(6, 12, 6, 'HALF-WRITTEN')];
    const result = spliceEdits(lastGood, edits, 0, 5);
    expect(result?.source).toBe('VERSE\nchorus');
    expect(result?.applied).toHaveLength(1);
    expect(result?.remaining).toHaveLength(1);
  });

  it('returns null when nothing in the region was edited', () => {
    // Nothing to commit. Saying so beats re-running the last good source and
    // reporting success for a keypress that did nothing.
    const lastGood = 'a\nb';
    expect(spliceEdits(lastGood, [hunk(0, 1, 0, 'A')], 2, 3)).toBeNull();
  });

  it('returns null when there are no edits at all', () => {
    expect(spliceEdits('a\nb', [], 0, 3)).toBeNull();
  });

  it('applies several edits in one region', () => {
    const lastGood = 'a b c';
    const result = spliceEdits(lastGood, [hunk(0, 1, 0, 'A'), hunk(4, 5, 4, 'C')], 0, 5);
    expect(result?.source).toBe('A b C');
  });

  it('handles an insertion, which has an empty range in the old source', () => {
    const lastGood = 'a\nc';
    const result = spliceEdits(lastGood, [hunk(2, 2, 2, 'b\n')], 2, 4);
    expect(result?.source).toBe('a\nb\nc');
  });

  it('handles a deletion, which inserts nothing', () => {
    const lastGood = 'a\nb\nc';
    const result = spliceEdits(lastGood, [hunk(2, 4, 2, '')], 2, 2);
    expect(result?.source).toBe('a\nc');
  });

  it('always produces a complete document, never a fragment', () => {
    // The invariant the engine depends on. Everything outside the region is
    // present, unchanged, exactly as it last ran.
    const lastGood = 'const wash = rgbStrip(1, 8)\nwash.red(1)\nwash.blue(0)';
    const result = spliceEdits(lastGood, [hunk(37, 38, 37, '0.5')], 37, 40);
    expect(result?.source).toContain('const wash = rgbStrip(1, 8)');
    expect(result?.source).toContain('wash.blue(0)');
  });
});

describe('rebasing what was left behind', () => {
  it('shifts a later edit by the length change of an applied one', () => {
    // 'a' -> 'AAA' grows the document by two, so the untouched edit that
    // followed now sits two characters later in the source that just ran.
    const lastGood = 'a\nb';
    const edits = [hunk(0, 1, 0, 'AAA'), hunk(2, 3, 4, 'B')];
    const result = spliceEdits(lastGood, edits, 0, 3);
    expect(result?.source).toBe('AAA\nb');
    expect(result?.remaining[0].fromA).toBe(4);
    expect(result?.remaining[0].toA).toBe(5);
  });

  it('shifts backwards when the applied edit shrank the document', () => {
    const lastGood = 'aaa\nb';
    const edits = [hunk(0, 3, 0, 'a'), hunk(4, 5, 2, 'B')];
    const result = spliceEdits(lastGood, edits, 0, 1);
    expect(result?.source).toBe('a\nb');
    expect(result?.remaining[0].fromA).toBe(2);
  });

  it('does not shift an edit that sits before the applied one', () => {
    const lastGood = 'a\nb';
    const edits = [hunk(0, 1, 0, 'A'), hunk(2, 3, 2, 'BBB')];
    const result = spliceEdits(lastGood, edits, 2, 5);
    expect(result?.remaining[0].fromA).toBe(0);
  });

  it('leaves the buffer coordinates of a remaining edit untouched', () => {
    // B is where it sits in the buffer, and the buffer has not moved.
    const lastGood = 'a\nb';
    const edits = [hunk(0, 1, 0, 'AAA'), hunk(2, 3, 4, 'B')];
    const result = spliceEdits(lastGood, edits, 0, 3);
    expect(result?.remaining[0].fromB).toBe(4);
  });

  it('rebases so a second splice lands correctly', () => {
    // The sequence that matters in use: commit one look, then the other.
    const lastGood = 'one\ntwo';
    const edits = [hunk(0, 3, 0, 'ONE!'), hunk(4, 7, 5, 'TWO')];
    const first = spliceEdits(lastGood, edits, 0, 4);
    expect(first?.source).toBe('ONE!\ntwo');
    const second = spliceEdits(first!.source, first!.remaining, 5, 8);
    expect(second?.source).toBe('ONE!\nTWO');
  });
});

describe('paragraphAt', () => {
  const doc = [
    'const wash = rgbStrip(1, 8)',   // 0
    '',                              // 1
    'const verse = () => {',         // 2
    '  wash.red(1)',                 // 3
    '}',                             // 4
    '',                              // 5
    'const chorus = () => {',        // 6
    '  wash.blue(1)',                // 7
    '}',                             // 8
  ];

  /** The text paragraphAt picked out, for readability in the expectations. */
  function textAt(line: number): string {
    const { from, to } = paragraphAt(doc, line);
    return doc.join('\n').slice(from, to);
  }

  it('takes the run of non-blank lines around the cursor', () => {
    expect(textAt(3)).toBe('const verse = () => {\n  wash.red(1)\n}');
  });

  it('reaches the same block from its first and last line', () => {
    expect(textAt(2)).toBe(textAt(4));
    expect(textAt(6)).toBe(textAt(8));
  });

  it('does not cross a blank line into the next look', () => {
    expect(textAt(3)).not.toContain('chorus');
    expect(textAt(7)).not.toContain('verse');
  });

  it('handles a one-line paragraph at the top', () => {
    expect(textAt(0)).toBe('const wash = rgbStrip(1, 8)');
  });

  it('handles the cursor on a blank line, taking just that line', () => {
    // Nothing either side belongs to it, so the region is empty and the
    // caller reports that there is nothing to commit.
    expect(textAt(1)).toBe('');
  });

  it('handles a document with no blank lines at all', () => {
    const solid = ['a', 'b', 'c'];
    const { from, to } = paragraphAt(solid, 1);
    expect(solid.join('\n').slice(from, to)).toBe('a\nb\nc');
  });

  it('handles a single-line document', () => {
    expect(paragraphAt(['only'], 0)).toEqual({ from: 0, to: 4 });
  });
});
