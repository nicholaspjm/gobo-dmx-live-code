/**
 * Which line a syntax error is on.
 *
 * A scene that throws while it runs gets its line from the stack (see
 * locatedError in core), but one that does not parse never runs, and the
 * engine's "missing ) after argument list" names no line at all. That is the
 * commonest mistake in live coding, made at speed in a long file, so the
 * editor's own parser is asked instead: it already reads the document to
 * colour it, and it marks where it stopped making sense.
 */

import { javascriptLanguage } from '@codemirror/lang-javascript';

/** The 1-based line the first parse error is on, or null if there is none. */
export function syntaxErrorLine(code: string): number | null {
  const tree = javascriptLanguage.parser.parse(code);
  let at: number | null = null;
  tree.iterate({
    enter: (node) => {
      if (at !== null) return false;
      if (node.type.isError) {
        at = node.from;
        return false;
      }
      return undefined;
    },
  });
  if (at === null) return null;

  const lines = code.split('\n');
  let line = code.slice(0, at).split('\n').length;
  // A bracket left open at the end of a line is only noticed where the next
  // statement starts, so an error at the very start of a line belongs to the
  // last line with anything on it.
  const before = lines[line - 1].slice(0, at - lineStart(lines, line));
  if (before.trim() === '') {
    let prev = line - 1;
    while (prev >= 1 && lines[prev - 1].trim() === '') prev--;
    if (prev >= 1) line = prev;
  }
  return line;
}

function lineStart(lines: string[], line: number): number {
  let offset = 0;
  for (let i = 0; i < line - 1; i++) offset += lines[i].length + 1;
  return offset;
}

/**
 * The run's error with a line on it, when it is a syntax error that had none.
 *
 * "Unexpected end of input" is left without one: something opened is never
 * closed, which the parser can only notice at the end, so the line it would
 * name is the last one and the mistake is somewhere above.
 */
export function locateSyntaxError(message: string, code: string): string {
  if (/^line \d+:/.test(message)) return message;
  if (/Unexpected end of input/.test(message)) {
    return `${message}: a bracket, brace or quote is opened and never closed.`;
  }
  if (!/missing|Unexpected|Invalid|Unterminated|expected/i.test(message)) return message;
  const line = syntaxErrorLine(code);
  return line === null ? message : `line ${line}: ${message}`;
}
