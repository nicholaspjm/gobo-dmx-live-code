/**
 * Finding call sites in the buffer, with everything that is not code taken
 * out first.
 *
 * The inline widgets are placed by scanning the doc for call sites and
 * zipping those, in order, against what the run registered. A regex over raw
 * text cannot tell a live `.viz(` from one sitting in a comment, so the
 * source is stripped before it is searched: comment bodies and string
 * contents become spaces, and only what is left counts as a call.
 *
 * The whole point of the strip is that commenting a line out takes its widget
 * away. Line comments were already handled where the scans used to live, by
 * cutting each line at its first pair of slashes. Block comments were not,
 * and Shift+Alt+A is bound to toggleBlockComment in the editor's default
 * keymap, so a whole section can be silenced without typing a slash. Those
 * lines kept their widgets, and worse, kept their place in the zip, which
 * slid every widget after them onto the wrong line.
 *
 * Blanking is character for character rather than by deletion, so line
 * lengths and the order matches come out in are both unchanged. The zips
 * downstream depend on that order.
 *
 * Regex literals are not tracked. In gobo source a slash is division, and the
 * one thing that could go wrong, a literal holding two adjacent slashes,
 * reads as a comment and drops a widget rather than keeping a dead one alive.
 * That is the safer way round.
 */

/** What the scanner is currently inside. */
type Mode = 'code' | 'line' | 'block' | 'single' | 'double' | 'template';

/**
 * Blank out comments and string contents, and return the result split into
 * lines.
 *
 * The array is 0-indexed and its length matches CodeMirror's `doc.lines`, so
 * `code[n - 1]` is the code on `doc.line(n)`.
 */
export function stripNonCode(source: string): string[] {
  const lines: string[] = [];
  let out = '';
  let mode: Mode = 'code';
  /** Whether the previous character was a backslash inside a string. */
  let escaped = false;
  /**
   * Open `${` interpolations, innermost last, each holding the number of
   * plain braces open inside it. An interpolation is code again, and that
   * code can open another template, so this has to be a stack.
   */
  const interpolations: number[] = [];

  let i = 0;
  while (i < source.length) {
    const c = source[i];
    const next = i + 1 < source.length ? source[i + 1] : '';

    if (c === '\n') {
      lines.push(out);
      out = '';
      // A line comment ends here. So does a quoted string, unless the line
      // was continued with a trailing backslash. Templates and block
      // comments carry on.
      if (mode === 'line') mode = 'code';
      else if ((mode === 'single' || mode === 'double') && !escaped) mode = 'code';
      escaped = false;
      i++;
      continue;
    }

    if (escaped) {
      escaped = false;
      out += ' ';
      i++;
      continue;
    }

    switch (mode) {
      case 'code':
        if (c === '/' && next === '/') { mode = 'line'; out += '  '; i += 2; continue; }
        if (c === '/' && next === '*') { mode = 'block'; out += '  '; i += 2; continue; }
        if (c === "'") { mode = 'single'; out += c; i++; continue; }
        if (c === '"') { mode = 'double'; out += c; i++; continue; }
        if (c === '`') { mode = 'template'; out += c; i++; continue; }
        if (interpolations.length > 0) {
          // Count braces so the one that closes the interpolation, and not
          // an object literal inside it, hands the template back.
          const depth = interpolations.length - 1;
          if (c === '{') {
            interpolations[depth]++;
          } else if (c === '}') {
            if (interpolations[depth] === 0) {
              interpolations.pop();
              mode = 'template';
            } else {
              interpolations[depth]--;
            }
          }
        }
        out += c;
        i++;
        continue;

      case 'line':
        out += ' ';
        i++;
        continue;

      case 'block':
        if (c === '*' && next === '/') { mode = 'code'; out += '  '; i += 2; continue; }
        out += ' ';
        i++;
        continue;

      case 'single':
      case 'double':
        if (c === '\\') { escaped = true; out += ' '; i++; continue; }
        if (c === (mode === 'single' ? "'" : '"')) { mode = 'code'; out += c; i++; continue; }
        out += ' ';
        i++;
        continue;

      case 'template':
        if (c === '\\') { escaped = true; out += ' '; i++; continue; }
        if (c === '`') { mode = 'code'; out += c; i++; continue; }
        if (c === '$' && next === '{') {
          interpolations.push(0);
          mode = 'code';
          // Kept rather than blanked: they are structure, not text, and the
          // brace counting above reads them back.
          out += '${';
          i += 2;
          continue;
        }
        out += ' ';
        i++;
        continue;
    }
  }
  lines.push(out);
  return lines;
}

/** One call site found in the stripped source. */
export interface CallHit {
  /** 1-based, to hand straight to CodeMirror's `doc.line(n)`. */
  line: number;
  /** The match, for callers that need a captured group out of it. */
  match: RegExpMatchArray;
}

/**
 * Every match of `pattern` in stripped source, in reading order.
 *
 * One hit per match rather than per line, because the registries these are
 * zipped against push one entry per call: two calls written on one line have
 * to come back as two hits or everything after them pairs up wrong.
 */
export function findCalls(code: readonly string[], pattern: RegExp): CallHit[] {
  // A fresh global regex. matchAll insists on /g, and a caller's own object
  // would carry its lastIndex from one line into the next.
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  const re = new RegExp(pattern.source, flags);
  const hits: CallHit[] = [];
  for (let i = 0; i < code.length; i++) {
    for (const match of code[i].matchAll(re)) hits.push({ line: i + 1, match });
  }
  return hits;
}
