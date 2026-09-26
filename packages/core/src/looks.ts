/**
 * Looks and mutes, written the way strudel writes its blocks.
 *
 * A look is a state of the rig with a name: the verse is blue, the chorus is
 * red. gobo's cue() switches between them, and until now each one had to be
 * written as a JavaScript function, `const verse = () => { … }`, which is the
 * one piece of programming syntax in a scene that says nothing about light.
 * Strudel names a block with a label instead (`name:`), and mutes one with an
 * underscore (`_name:` or `name_:`). The same here:
 *
 *   verse: {                 a look called verse, run when cue() picks it
 *     wash.color(blue)
 *   }
 *   _chorus: { … }           muted: kept in view, not run
 *   _$: wash.red(sine)       one line muted, strudel's own spelling
 *   cue(verse, chorus)
 *
 * This is a rewrite of the source just before it is compiled. A top-level
 * labelled block becomes a named function, and a muted label becomes
 * `if (0)`, so everything after it is ordinary JavaScript and the engine is
 * untouched. Nothing is added across lines, so the line numbers an error
 * names are the lines on screen.
 *
 * Only labels at the top level of the scene count. Inside a block, a call or
 * a literal, `name:` is someone else's syntax (an object key, a nested label)
 * and is left alone, as is anything inside a string or a comment.
 */

const IDENT_START = /[A-Za-z_$]/;
const IDENT = /[\w$]/;

/** A label that mutes: strudel's _name and name_. */
export function isMuteLabel(name: string): boolean {
  return name.length > 1 && (name.startsWith('_') || name.endsWith('_'));
}

/**
 * Positions in `code` that begin a top-level statement, found by walking it
 * once with enough knowledge of strings, comments and brackets not to be
 * fooled by them.
 */
function topLevelStarts(code: string): number[] {
  const starts: number[] = [];
  let depth = 0;
  let atStart = true;
  let i = 0;
  const n = code.length;
  while (i < n) {
    const c = code[i];
    const next = code[i + 1];
    if (c === '/' && next === '/') {
      while (i < n && code[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && next === '*') {
      const end = code.indexOf('*/', i + 2);
      i = end === -1 ? n : end + 2;
      continue;
    }
    if (c === '\n' || c === ';') {
      if (depth === 0) atStart = true;
      i++;
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\r') {
      i++;
      continue;
    }
    if (atStart && depth === 0) starts.push(i);
    atStart = false;
    if (c === '"' || c === "'" || c === '`') {
      i = skipString(code, i);
      continue;
    }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') {
      depth = Math.max(0, depth - 1);
      if (depth === 0 && c === '}') atStart = true;
    }
    i++;
  }
  return starts;
}

/** The index just past the string literal that opens at `i`. */
function skipString(code: string, i: number): number {
  const quote = code[i];
  let j = i + 1;
  let nest = 0;
  while (j < code.length) {
    const c = code[j];
    if (c === '\\') {
      j += 2;
      continue;
    }
    if (quote === '`') {
      if (c === '$' && code[j + 1] === '{') {
        nest++;
        j += 2;
        continue;
      }
      if (c === '}' && nest > 0) {
        nest--;
        j++;
        continue;
      }
    }
    if (c === quote && nest === 0) return j + 1;
    if (c === '\n' && quote !== '`') return j;
    j++;
  }
  return j;
}

/** The index of the `}` that closes the `{` at `open`, or -1. */
function matchingBrace(code: string, open: number): number {
  let depth = 0;
  let i = open;
  while (i < code.length) {
    const c = code[i];
    const next = code[i + 1];
    if (c === '/' && next === '/') {
      while (i < code.length && code[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && next === '*') {
      const end = code.indexOf('*/', i + 2);
      i = end === -1 ? code.length : end + 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      i = skipString(code, i);
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return -1;
}

/** Skip spaces and comments on the same statement, returning the next index. */
function skipGap(code: string, i: number): number {
  for (;;) {
    while (i < code.length && /\s/.test(code[i])) i++;
    if (code.startsWith('//', i)) {
      while (i < code.length && code[i] !== '\n') i++;
      continue;
    }
    if (code.startsWith('/*', i)) {
      const end = code.indexOf('*/', i + 2);
      i = end === -1 ? code.length : end + 2;
      continue;
    }
    return i;
  }
}

export interface LookRewrite {
  code: string;
  /** The looks the scene declared, in order. */
  looks: string[];
}

/** Rewrite top-level labelled blocks into looks, and muted labels into if (0). */
export function rewriteLooks(code: string): LookRewrite {
  type Edit = { from: number; to: number; text: string };
  const edits: Edit[] = [];
  const looks: string[] = [];

  for (const start of topLevelStarts(code)) {
    if (!IDENT_START.test(code[start])) continue;
    let end = start + 1;
    while (end < code.length && IDENT.test(code[end])) end++;
    const name = code.slice(start, end);
    const colon = skipGap(code, end);
    // A label is `name:` and not `name::` or `name :=`; the colon is all.
    if (code[colon] !== ':' || code[colon + 1] === ':') continue;
    const body = skipGap(code, colon + 1);

    if (isMuteLabel(name)) {
      edits.push({ from: start, to: colon + 1, text: 'if (0)' });
      continue;
    }
    // A look needs a block, and a name a person would give one. `$:` and a
    // label on a single statement run as they always did.
    if (code[body] !== '{' || name === '$' || name.startsWith('$')) continue;
    const close = matchingBrace(code, body);
    if (close === -1) continue;
    edits.push({ from: start, to: colon + 1, text: `const ${name} = function ${name}()` });
    edits.push({ from: close + 1, to: close + 1, text: ';' });
    looks.push(name);
  }

  if (edits.length === 0) return { code, looks };
  edits.sort((a, b) => b.from - a.from);
  let out = code;
  for (const e of edits) out = out.slice(0, e.from) + e.text + out.slice(e.to);
  return { code: out, looks };
}
