/**
 * Tagging a scene's mini-notation with where it is written.
 *
 * `@strudel/mini` ships two ways to build a pattern from a string.
 * `mini('1 0 1 0')` throws away where the string was; `m('1 0 1 0', offset)`
 * tags every leaf with the character range it came from, which is what the
 * editor needs to outline the live token. Strudel gets the offsets from a
 * full parse of the document. This has no parser: it only has to find the
 * calls and measure the strings.
 *
 * The rewrite is textual and length-preserving in the places it does not
 * touch (only the argument list of a matched call grows), and the offsets it
 * writes are into the ORIGINAL document, which is what the decorations are
 * placed against.
 *
 * Anything it is not sure about is left alone: a call whose argument is not a
 * plain single-quoted or double-quoted literal, a string carrying an escape, a
 * call inside a comment or inside another string. A missed call costs an
 * outline. A wrong rewrite costs the scene, and this runs on the path that
 * guarantees a mistyped paren leaves the rig as it was.
 */

import { stripNonCode } from './source-scan.js';
// The module on its own: the package index reads `window` at import time.
import { PATTERN_VIZ_METHOD_NAMES } from '@gobo/core/pattern-viz';
import { quotedReceivers } from '@gobo/core/looks';

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
 * Find `mini('…')` calls in code.
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
 * `mini('1 0')` becomes `m('1 0', N)`. The rename matters: mini() has no
 * offset parameter (m() takes one), so a second argument to mini() would be
 * silently ignored and nothing would ever light up.
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
    // The stripper walks user text. If it ever throws, the scene runs without
    // outlines.
    return [];
  }
  return calls.map((c) => ({
    from: c.nameStart,
    to: c.end,
    text: `m(${source.slice(c.quote, c.close + 1)}, ${c.quote})`,
  }));
}

/**
 * Setters whose one argument is a level or a colour, where a quoted string is
 * mini-notation (string-patterns.ts in core). Only these: a method that takes
 * a plain name, .viz('strip') or .slots('color'), must be handed its string
 * untouched, so this is a list of what is known to take a pattern rather than
 * a guess at what does not.
 */
const PATTERN_SETTERS = [
  'dim', 'red', 'green', 'blue', 'white', 'amber', 'uv', 'lime', 'cyan', 'color', 'mono', 'strobe',
  'pan', 'tilt', 'zoom', 'focus', 'speed', 'direction', 'struct', 'mask', 'velocity', 'gain',
  'across', 'each',
];
const SETTER_WITH_STRING = new RegExp(`\\.(${PATTERN_SETTERS.join('|')})\\s*\\(`, 'g');

/**
 * `wash.dim('1 - 1 -')` becomes `wash.dim(m('1 - 1 -', offsetOfTheQuote))`, so
 * a bare string gets the same live outline as mini('…'). Same rules as a mini
 * call: one argument, a plain literal, no escapes.
 */
function setterStringEdits(source: string): Edit[] {
  let stripped: string;
  try {
    stripped = stripNonCode(source).join('\n');
  } catch {
    return [];
  }
  const edits: Edit[] = [];
  for (const match of stripped.matchAll(SETTER_WITH_STRING)) {
    const open = (match.index ?? 0) + match[0].length - 1;
    let i = open + 1;
    while (i < source.length && (source[i] === ' ' || source[i] === '\t')) i++;
    const q = source[i];
    if (q !== "'" && q !== '"') continue;
    const quote = i;
    i++;
    let closed = -1;
    while (i < source.length) {
      const c = source[i];
      if (c === '\\' || c === '\n') break;
      if (c === q) { closed = i; break; }
      i++;
    }
    if (closed === -1) continue;
    let j = closed + 1;
    while (j < source.length && (source[j] === ' ' || source[j] === '\t')) j++;
    if (source[j] !== ')') continue;
    const body = source.slice(quote + 1, closed);
    // A quoted number is that raw value ('128' is 128 of 255), not a step of
    // a pattern, and a slash that is not a speed ('red/blue', a wheel slot)
    // would not parse: both are left for the engine to read as written.
    if (/^\s*-?(\d+\.?\d*|\.\d+)\s*$/.test(body) || /\/(?!\s*[\d.<[])/.test(body) || /^\s*#/.test(body)) continue;
    edits.push({ from: quote, to: closed + 1, text: `m(${source.slice(quote, closed + 1)}, ${quote})` });
  }
  return edits;
}

/**
 * `slider(0.5, …)` becomes `slider.at(offsetOfTheName)(0.5, …)`: Strudel's
 * unnamed slider, stamped with where it is written, so its handle lands on
 * this call and no other. A named slider, slider('level'), is left alone.
 */
function sliderEdits(source: string): Edit[] {
  let stripped: string;
  try {
    stripped = stripNonCode(source).join('\n');
  } catch {
    return [];
  }
  const edits: Edit[] = [];
  for (const match of stripped.matchAll(/(^|[^.\w$])slider\s*\(\s*(?=[-\d.])/g)) {
    const nameStart = (match.index ?? 0) + match[1].length;
    const open = stripped.indexOf('(', nameStart);
    edits.push({ from: nameStart, to: open + 1, text: `slider.at(${nameStart}, ${edits.length})(` });
  }
  return edits;
}

/**
 * `'1 0'.fast(2)` becomes `m('1 0', offsetOfTheQuote).fast(2)`: Strudel's chain
 * on a quoted pattern, outlined live like any other. The editor does not know
 * the engine's method list, so anything a string itself lacks counts; the
 * engine makes the same rewrite with its own list for code run without it.
 */
function receiverEdits(source: string): Edit[] {
  try {
    return quotedReceivers(source, () => true).map(({ from, to }) => ({
      from,
      to,
      text: `m(${source.slice(from, to)}, ${from})`,
    }));
  } catch {
    return [];
  }
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
 * Only an EMPTY argument list is rewritten. The methods take no arguments, so
 * anything inside the parens is something this does not understand, and a call
 * left alone falls back to counting.
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
  return applyEdits(source, [...miniEdits(source), ...setterStringEdits(source), ...sliderEdits(source), ...receiverEdits(source), ...vizEdits(source)]);
}
