/**
 * Teaching a scene where its mini-notation came from.
 *
 * `@strudel/mini` ships two ways to build a pattern from a string.
 * `mini('1 0 1 0')` throws away where the string was; `m('1 0 1 0', offset)`
 * tags every leaf with the character range it came from, which is what the
 * editor needs to outline the token that is lighting something right now.
 * Strudel gets the offsets from a full parse of the document. This does not
 * have a parser and does not need one: it only has to find the calls and
 * measure the strings.
 *
 * The rewrite is textual and length-preserving in the places it does not
 * touch — only the argument list of a matched call grows — and the offsets it
 * writes are into the ORIGINAL document, which is what the decorations are
 * placed against.
 *
 * It is deliberately timid. Anything it is not sure about it leaves alone: a
 * call whose argument is not a plain single-quoted or double-quoted literal, a
 * string carrying an escape, a call inside a comment or inside another string.
 * A missed call costs an outline. A wrong rewrite costs the scene, and this
 * runs on the path that currently guarantees a mistyped paren leaves the rig
 * exactly as it was.
 */

import { stripNonCode } from './source-scan.js';
// The module on its own: the package index reads `window` at import time.
import { PATTERN_VIZ_METHOD_NAMES } from '@gobo/core/pattern-viz';

/** What a rewrite produced, or the original when nothing was touched. */
export interface Rewritten {
  code: string;
  /** How many calls were given locations. Zero means nothing changed. */
  tagged: number;
}

/**
 * The offset of the first character of each line, for turning the stripped
 * line/column view back into a document offset.
 */
function lineStarts(source: string): number[] {
  const starts = [0];
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\n') starts.push(i + 1);
  }
  return starts;
}

/** A call we are willing to rewrite, and where its string argument sits. */
interface Call {
  /** Offset of the first character of the callee name. */
  nameStart: number;
  /** Offset of the `(` that opens the call. */
  open: number;
  /** Offset of the opening quote of the argument. */
  quote: number;
  /** Offset of the closing quote. */
  close: number;
  /** Offset just past the closing paren. */
  end: number;
}

/**
 * Find `mini('…')` calls that are really code.
 *
 * The search runs over stripped source, where comment bodies and string
 * contents are blanked character for character, so a `mini(` written inside a
 * comment or inside another string is not found and the offsets still line up
 * with the original. The string contents are then read back out of the
 * original at the same offsets, because the stripped copy has none.
 */
function findMiniCalls(source: string): Call[] {
  const stripped = stripNonCode(source).join('\n');
  const starts = lineStarts(source);
  const calls: Call[] = [];

  // A bare `mini(` or `m(`, not a property access: `x.mini(` is somebody
  // else's method and not ours to rewrite.
  const re = /(^|[^.\w$])(mini|m)\s*\(/g;
  for (const match of stripped.matchAll(re)) {
    const nameStart = (match.index ?? 0) + match[1].length;
    const open = (match.index ?? 0) + match[0].length - 1;
    // Read the argument out of the ORIGINAL, where the string still has its
    // contents. Whitespace between the paren and the quote is allowed.
    let i = open + 1;
    while (i < source.length && (source[i] === ' ' || source[i] === '\t')) i++;
    const q = source[i];
    if (q !== "'" && q !== '"') continue;          // not a plain literal
    const quote = i;
    i++;
    let closed = -1;
    while (i < source.length) {
      const c = source[i];
      if (c === '\\') break;                        // an escape: leave it alone
      if (c === '\n') break;                        // unterminated
      if (c === q) { closed = i; break; }
      i++;
    }
    if (closed === -1) continue;
    // Only a single-argument call. A second argument means someone is already
    // passing an offset, or doing something this does not understand.
    let j = closed + 1;
    while (j < source.length && (source[j] === ' ' || source[j] === '\t')) j++;
    if (source[j] !== ')') continue;
    calls.push({ nameStart, open, quote, close: closed, end: j + 1 });
  }
  // `starts` is only needed to prove the two views share offsets; the stripped
  // copy is the same length by construction, so the offsets are already right.
  void starts;
  return calls;
}

/**
 * Rewrite every mini call so its leaves carry document offsets.
 *
 * `mini('1 0')` becomes `m('1 0', N)`. The rename is not cosmetic: mini() has
 * no offset parameter at all — it is m() that takes one — so adding a second
 * argument to mini() would be silently ignored and nothing would ever light up.
 *
 * N is the offset of the OPENING QUOTE, because @strudel/mini re-adds the
 * quote itself before parsing and counts from there. Passing the offset of the
 * first character inside the string would put every outline one column left.
 *
 * Applied back to front so each splice leaves the offsets of the ones before
 * it untouched.
 */
export function tagMiniLocations(source: string): Rewritten {
  return applyEdits(source, miniEdits(source));
}

/** One rewrite: replace [from, to) with `text`. Offsets are into the ORIGINAL. */
interface Edit {
  from: number;
  to: number;
  text: string;
}

/**
 * Apply rewrites back to front.
 *
 * Back to front so each splice leaves the offsets of the ones before it
 * untouched, which is what lets every offset written into the code refer to
 * the original document. Both kinds of tag depend on that, and it is why they
 * are applied together in one pass rather than one after the other: a second
 * pass over already-rewritten text would measure the wrong positions.
 */
function applyEdits(source: string, edits: Edit[]): Rewritten {
  if (edits.length === 0) return { code: source, tagged: 0 };
  const ordered = [...edits].sort((a, b) => a.from - b.from);
  let out = source;
  for (let i = ordered.length - 1; i >= 0; i--) {
    const e = ordered[i];
    out = out.slice(0, e.from) + e.text + out.slice(e.to);
  }
  return { code: out, tagged: ordered.length };
}

/** `mini('…')` becomes `m('…', offsetOfTheQuote)`. */
function miniEdits(source: string): Edit[] {
  let calls: Call[];
  try {
    calls = findMiniCalls(source);
  } catch {
    // The stripper walks user text. If it ever throws, the scene is worth more
    // than the outlines.
    return [];
  }
  return calls.map((c) => ({
    from: c.nameStart,
    to: c.end,
    text: `m(${source.slice(c.quote, c.close + 1)}, ${c.quote})`,
  }));
}

/** The pattern-level viz methods, which take no arguments of their own. */
const VIZ_METHODS = new RegExp(`\\.(${PATTERN_VIZ_METHOD_NAMES.join('|')})\\s*\\(\\s*\\)`, 'g');

/**
 * `.glow()` becomes `.glow(offsetOfTheDot)`.
 *
 * These have no name to be matched on the way slider() and pick() do, and no
 * argument either, so the offset is the only thing that can tie a registration
 * to the line it was written on. Without it the UI pairs them by counting, and
 * a `.flash()` inside a look that did not run shifts every later widget onto
 * the wrong line.
 *
 * Only an EMPTY argument list is rewritten. The methods take nothing today, so
 * anything inside the parens is something this does not understand, and a call
 * left alone simply falls back to counting.
 */
function vizEdits(source: string): Edit[] {
  let stripped: string;
  try {
    stripped = stripNonCode(source).join('\n');
  } catch {
    return [];
  }
  const edits: Edit[] = [];
  for (const match of stripped.matchAll(VIZ_METHODS)) {
    const dot = match.index ?? 0;
    edits.push({
      from: dot,
      to: dot + match[0].length,
      text: `.${match[1]}(${dot})`,
    });
  }
  return edits;
}

/**
 * Give a scene every location tag the editor can use, in one pass.
 *
 * One pass because both kinds of offset are into the original document, and a
 * rewrite moves everything after it: tagging mini calls and then scanning the
 * result for viz calls would measure the viz offsets against text that has
 * already shifted.
 */
export function tagLocations(source: string): Rewritten {
  return applyEdits(source, [...miniEdits(source), ...vizEdits(source)]);
}
