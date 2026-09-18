/**
 * Running only the edits you pointed at.
 *
 * Ctrl+Enter commits the whole buffer. That is usually what you want and once
 * in a while it is the worst thing the tool can do: you nudge a level in the
 * look that is lit, and the half-written look you were building for the next
 * song goes live with it — silently, as long as it happens to parse. The same
 * single compile means a half-typed line anywhere refuses the whole run, so
 * you cannot touch the look that IS up until the one you are drafting parses.
 *
 * Note what this is NOT for. In TidalCycles d1..d9 exist because evaluating
 * the file would restart everything; in gobo a re-run is already invisible on
 * the wire — the clock is never reset by an evaluation, the def swap is one
 * assignment inside one synchronous turn, and every control position survives.
 * "Everything else keeps running" is already true of Ctrl+Enter. So this is
 * not a seamlessness feature. It is about what a keypress COMMITS.
 *
 * That framing decides the design. The engine is not taught a partial picture:
 * no partial staging map, no merged commit, no layers. What gets compiled is
 * always a complete document — the last one that ran, with only the edits
 * inside your selection applied — so the def map is still replaced whole,
 * patch claims are still made once, implied brightness is still computed over
 * the whole rig, and hush() still means blackout. Every one of those breaks if
 * the engine is handed a fragment, and each break is a way for a light to be
 * wrong on stage with nothing on screen to explain it.
 *
 * The unit is the EDIT, not the syntactic block. Nothing here matches braces
 * or parses anything, which matters because the document this exists for is
 * the one with an unbalanced brace in it — exactly where a block finder would
 * fail.
 */

/**
 * One contiguous edit, as CodeMirror reports it.
 *
 * `A` coordinates are into the source that last ran; `B` into the buffer as it
 * is now. Both are needed: the selection is in B, and the splice is applied
 * in A.
 */
export interface Hunk {
  fromA: number;
  toA: number;
  fromB: number;
  toB: number;
  insert: string;
}

export interface Spliced {
  /** A complete document: what last ran, plus the edits you pointed at. */
  source: string;
  /** The edits that went in. */
  applied: Hunk[];
  /**
   * The edits left behind, rebased onto `source`.
   *
   * Rebased rather than recomputed because there is nothing to recompute
   * from: a text diff of two strings is not something CodeMirror offers, and
   * guessing one would put edits in the wrong place. Their A coordinates
   * shift by the length change of every applied edit that sits before them;
   * their B coordinates do not move at all, because the buffer has not.
   */
  remaining: Hunk[];
}

/** Whether an edit lies inside the region the operator pointed at. */
function touches(hunk: Hunk, from: number, to: number): boolean {
  // Inclusive at both ends, so an edit that only abuts the selection still
  // counts. Pointing at a line and having the change on its last character
  // left behind would be a very annoying way to lose a level.
  return hunk.fromB <= to && hunk.toB >= from;
}

/**
 * Build the document to run: what last ran, plus the edits inside [from, to).
 *
 * Returns null when no edit lies in that region — there is nothing to commit,
 * which the caller should say rather than running the last-good source again
 * and reporting success for a keypress that did nothing.
 *
 * Hunks must be in ascending, non-overlapping A order, which is the order
 * CodeMirror's iterChanges produces.
 */
export function spliceEdits(
  lastGood: string,
  hunks: readonly Hunk[],
  from: number,
  to: number,
): Spliced | null {
  const applied: Hunk[] = [];
  const left: Hunk[] = [];
  for (const hunk of hunks) (touches(hunk, from, to) ? applied : left).push(hunk);
  if (applied.length === 0) return null;

  let source = '';
  let cursor = 0;
  for (const hunk of applied) {
    source += lastGood.slice(cursor, hunk.fromA) + hunk.insert;
    cursor = hunk.toA;
  }
  source += lastGood.slice(cursor);

  // Rebase what was left behind. Walking both lists in ascending A order, the
  // shift for an untouched edit is the total length change of every applied
  // edit that ends before it starts.
  const remaining: Hunk[] = [];
  for (const hunk of left) {
    let shift = 0;
    for (const done of applied) {
      if (done.toA > hunk.fromA) break;
      shift += done.insert.length - (done.toA - done.fromA);
    }
    remaining.push({ ...hunk, fromA: hunk.fromA + shift, toA: hunk.toA + shift });
  }

  return { source, applied, remaining };
}

/**
 * The region to commit when the cursor is sitting in the document with nothing
 * selected.
 *
 * The contiguous run of non-blank lines around the cursor, which is how a
 * performance file is already laid out: a blank line between one look and the
 * next. It reads as "this look" without anyone having to be told, and it costs
 * no parser — a blank line is a blank line even when the braces are wrong.
 */
export function paragraphAt(lines: readonly string[], line: number): { from: number; to: number } {
  const blank = (i: number): boolean => (lines[i] ?? '').trim() === '';
  let first = line;
  let last = line;
  // A cursor parked in the gap between two looks belongs to neither. Without
  // this the run outwards starts from a blank line, finds both neighbours
  // non-blank, and swallows the look above AND the look below — committing
  // twice what was pointed at, which is the one thing this is here to stop.
  if (blank(line)) {
    let at = 0;
    for (let i = 0; i < line; i++) at += lines[i].length + 1;
    return { from: at, to: at };
  }
  while (first > 0 && !blank(first - 1)) first--;
  while (last < lines.length - 1 && !blank(last + 1)) last++;

  let from = 0;
  for (let i = 0; i < first; i++) from += lines[i].length + 1;
  let to = from;
  for (let i = first; i <= last; i++) to += lines[i].length + (i === last ? 0 : 1);
  return { from, to };
}
