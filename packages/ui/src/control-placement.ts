/**
 * Putting a control's handle on the line that declared it.
 *
 * The inline widgets are placed by pairing what the run registered against
 * what the source says. For most of them that pairing is positional, which
 * holds only while source order equals execution order and every call site in
 * the buffer ran.
 *
 * A performance file breaks both. When every look is a function and only the
 * live one is called, a control inside an uncalled look is a call site the
 * scan sees and the run never made, so everything after it pairs up wrong; and
 * a look written above the one that runs inverts the two orders even when the
 * counts agree.
 *
 * slider() and pick() do not need the zip. They are declared with a name, that
 * name is unique within a run — declaring it twice throws — and it is written
 * at the call site. Matching on it is exact and order-independent.
 *
 * Pure text, no engine: this reads source and returns line numbers, which is
 * why it sits beside the other scanners rather than inside the widget code.
 */

import { findCalls } from './source-scan.js';

/**
 * Where each named control is declared, keyed by the name it was given.
 *
 * The call sites come from the STRIPPED source, so one written inside a
 * comment or inside another string is not a call site. The name itself has to
 * be read back out of the ORIGINAL at the same offset, because stripping blanks
 * string contents and the stripped copy has no name left in it. The two views
 * are the same length line for line, which is what makes that offset valid.
 *
 * A name written twice in the source is dropped rather than guessed at. Only
 * one of the two can have run — declaring a name twice in one run throws — and
 * nothing in the text says which, so placing the handle on the first is a coin
 * toss, and a handle on the wrong look is read as the truth about a light.
 */
export function declaredLines(
  doc: { line: (n: number) => { text: string } },
  code: readonly string[],
  pattern: RegExp,
): Map<string, number> {
  const found = new Map<string, number>();
  const ambiguous = new Set<string>();
  for (const hit of findCalls(code, pattern)) {
    const col = (hit.match.index ?? 0) + hit.match[0].length;
    const name = quotedArgAt(doc.line(hit.line).text, col);
    if (name === null) continue;        // not a plain literal; nothing to key on
    if (found.has(name)) { ambiguous.add(name); continue; }
    found.set(name, hit.line);
  }
  for (const name of ambiguous) {
    found.delete(name);
    console.warn(
      `[gobo] "${name}" is declared in more than one place, so its handle has nowhere `
      + 'certain to sit and has been left off. Give each control its own name.',
    );
  }
  return found;
}

/**
 * The contents of a quoted literal starting at or just after `col`.
 *
 * Returns null for anything that is not a plain single- or double-quoted
 * string on one line: a name built from a variable, or one carrying an escape.
 * Those are left without a widget rather than half-parsed.
 */
export function quotedArgAt(lineText: string, col: number): string | null {
  let i = col;
  while (i < lineText.length && (lineText[i] === ' ' || lineText[i] === '\t')) i++;
  const q = lineText[i];
  if (q !== "'" && q !== '"') return null;
  i++;
  let out = '';
  while (i < lineText.length) {
    const c = lineText[i];
    if (c === '\\') return null;       // an escape: not ours to interpret
    if (c === q) return out;
    out += c;
    i++;
  }
  return null;                         // unterminated on this line
}
