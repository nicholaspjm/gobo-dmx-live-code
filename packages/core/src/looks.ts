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
/** Characters that, ending a line, say the statement carries on below. */
const CONTINUES = '?:=,+-*/%&|^!<>~(.[';

function topLevelStarts(code: string): number[] {
  const starts: number[] = [];
  let depth = 0;
  let atStart = true;
  /** The last character of code seen, for telling a new line from a carried one. */
  let last = '';
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
    if (c === ';') {
      if (depth === 0) atStart = true;
      last = c;
      i++;
      continue;
    }
    if (c === '\n') {
      // A line that ends on an operator carries on: `big ?\n  small : {…}` is
      // one ternary, not a label on the second line. x++ and x-- still end.
      const carried = CONTINUES.includes(last) && !(code.slice(0, i).trimEnd().endsWith('++') || code.slice(0, i).trimEnd().endsWith('--'));
      if (depth === 0 && !carried) atStart = true;
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
      last = c;
      continue;
    }
    if (c === '/' && opensRegex(code, i)) {
      i = skipRegex(code, i);
      last = 'x';
      continue;
    }
    last = c;
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

const REGEX_AFTER_WORD = new Set(['return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'new', 'delete', 'void', 'throw', 'yield', 'await']);

/**
 * Whether a `/` at `i` opens a regular expression rather than dividing: it
 * does where a value is expected, after an operator, an opening bracket, a
 * comma, the start of the scene or a word like return.
 */
function opensRegex(code: string, i: number): boolean {
  let j = i - 1;
  while (j >= 0 && /\s/.test(code[j])) j--;
  if (j < 0) return true;
  const c = code[j];
  if ('(,=:[!&|?{};+-*%<>~^'.includes(c)) return true;
  if (!IDENT.test(c)) return false;
  let k = j;
  while (k >= 0 && IDENT.test(code[k])) k--;
  return REGEX_AFTER_WORD.has(code.slice(k + 1, j + 1));
}

/** The index just past the regular expression that opens at `i`. */
function skipRegex(code: string, i: number): number {
  let j = i + 1;
  let inClass = false;
  while (j < code.length) {
    const c = code[j];
    if (c === '\\') {
      j += 2;
      continue;
    }
    if (c === '\n') return j;
    if (inClass) {
      if (c === ']') inClass = false;
    } else if (c === '[') inClass = true;
    else if (c === '/') {
      j++;
      while (j < code.length && IDENT.test(code[j])) j++;
      return j;
    }
    j++;
  }
  return j;
}

/** `code` with strings and comments blanked to spaces, the same length. */
function codeOnly(code: string): string {
  let out = '';
  let i = 0;
  while (i < code.length) {
    const c = code[i];
    const next = code[i + 1];
    let end = i;
    if (c === '/' && next === '/') {
      end = code.indexOf('\n', i);
      if (end === -1) end = code.length;
    } else if (c === '/' && next === '*') {
      const close = code.indexOf('*/', i + 2);
      end = close === -1 ? code.length : close + 2;
    } else if (c === '"' || c === "'" || c === '`') {
      end = skipString(code, i);
    } else {
      out += c;
      i++;
      continue;
    }
    out += code.slice(i, end).replace(/[^\n]/g, ' ');
    i = end;
  }
  return out;
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
    if (c === '/' && opensRegex(code, i)) {
      i = skipRegex(code, i);
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
  /** Where each look's name is written, for the editor to mark. */
  labels: Array<{ name: string; from: number; to: number }>;
  /** What each mute covers, label to end of block or line, for the editor to dim. */
  muted: Array<{ from: number; to: number }>;
  /** The looks that are muted (_chorus: { … }), by the name cue() knows them by. */
  mutedLooks: string[];
}

/** Rewrite top-level labelled blocks into looks, and muted labels into if (0). */
export function rewriteLooks(code: string): LookRewrite {
  type Edit = { from: number; to: number; text: string };
  const edits: Edit[] = [];
  const looks: string[] = [];
  const labels: LookRewrite['labels'] = [];
  const muted: LookRewrite['muted'] = [];
  const mutedLooks: string[] = [];

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
      // A muted look still has a name, so cue(verse, chorus) goes on working
      // with _chorus: muted: the name is declared, as nothing, and cue()
      // leaves it out. A muted line ($:, or a label on one statement) has no
      // look to declare.
      const bare = name.replace(/^_+|_+$/g, '');
      const declare = code[body] === '{' && /^[A-Za-z][\w]*$/.test(bare) ? `const ${bare} = null; ` : '';
      if (declare) mutedLooks.push(bare);
      edits.push({ from: start, to: colon + 1, text: `${declare}if (0)` });
      // `if (0) const x = 1` is not JavaScript, but `if (0) var x = 1` is: the
      // muted line still names x, as nothing, and a later use of it goes on
      // parsing.
      const decl = /^(const|let)\b/.exec(code.slice(body, body + 6));
      if (decl) edits.push({ from: body, to: body + decl[1].length, text: 'var' });
      const blockEnd = code[body] === '{' ? matchingBrace(code, body) : -1;
      const lineEnd = code.indexOf('\n', body);
      muted.push({ from: start, to: blockEnd !== -1 ? blockEnd + 1 : lineEnd === -1 ? code.length : lineEnd });
      continue;
    }
    // A look needs a block, and a name a person would give one. `$:` and a
    // label on a single statement run as they always did.
    if (code[body] !== '{' || name === '$' || name.startsWith('$')) continue;
    const close = matchingBrace(code, body);
    if (close === -1) continue;
    edits.push({ from: start, to: colon + 1, text: `const ${name} = function ${name}()` });
    edits.push({ from: close + 1, to: close + 1, text: ';' });
    // `break verse` leaves the block early, which in a function is return.
    const breakOut = new RegExp(`\\bbreak\\s+${name.replace(/\$/g, '\\$')}\\b`, 'g');
    for (const m of codeOnly(code.slice(body, close)).matchAll(breakOut)) {
      const at = body + (m.index ?? 0);
      edits.push({ from: at, to: at + m[0].length, text: 'return' });
    }
    looks.push(name);
    labels.push({ name, from: start, to: end });
  }

  if (edits.length === 0) return { code, looks, labels, muted, mutedLooks };
  edits.sort((a, b) => b.from - a.from);
  let out = code;
  for (const e of edits) out = out.slice(0, e.from) + e.text + out.slice(e.to);
  return { code: out, looks, labels, muted, mutedLooks };
}

/**
 * String methods from the early web ('x'.sub() wraps it in <sub> tags) that
 * nobody calls today and strudel uses for its own: '1'.sub(0.3) is subtraction.
 */
const HTML_STRING_METHODS = new Set([
  'sub', 'sup', 'anchor', 'big', 'blink', 'bold', 'fixed', 'fontcolor', 'fontsize', 'italics', 'link', 'small', 'strike',
]);

/**
 * Quoted strings that are the start of a chain: `'1 0'.fast(2)`.
 *
 * In strudel a quoted string is mini-notation, so a chain can start on one.
 * JavaScript sees a string there, which has no .fast(), so these are found and
 * wrapped in mini() before a run. `isMethod` says which names count: a pattern
 * method, and never one a string already has (`'a b'.split(' ')` is left
 * alone). Returns where each string literal sits, quotes included.
 */
export function quotedReceivers(code: string, isMethod: (name: string) => boolean): Array<{ from: number; to: number }> {
  const found: Array<{ from: number; to: number }> = [];
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
    if (c === '/' && opensRegex(code, i)) {
      i = skipRegex(code, i);
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const end = skipString(code, i);
      const literal = code.slice(i, end);
      // A template with an interpolation is code, not a pattern.
      const plain = c !== '`' || !literal.includes('${');
      if (plain && code[end - 1] === c && end - i >= 2) {
        const chained = /^\s*\.\s*([A-Za-z_$][\w$]*)\s*\(/.exec(code.slice(end, end + 80));
        if (chained && (!(chained[1] in String.prototype) || HTML_STRING_METHODS.has(chained[1])) && isMethod(chained[1])) {
          found.push({ from: i, to: end });
        }
      }
      i = end;
      continue;
    }
    i++;
  }
  return found;
}

/** Names that start a pattern and nothing else, as the head of a statement. */
// m( is how the editor hands over a quoted pattern it has tagged for its
// outlines, so it counts only as a call, never as a name a scene chose.
const PATTERN_HEADS = /^((sine|cosine|saw|isaw|square|tri|rand|perlin|irand|cat|seq|stack|sequence|fastcat|slowcat|mini)\b|m\s*\()/;

/**
 * Lines that make a pattern and hand it to nothing: `'1 0'.fast(2)` or
 * `sine.slow(4)` as a statement of its own. In strudel a line like that
 * plays; here a pattern only reaches light through a light, so the line does
 * nothing, and a scene pasted from strudel is dark with no error. Returned as
 * 1-based line numbers, for a warning. `skip` names method calls that do
 * something with a bare pattern (the inline pictures), which are left alone.
 */
export function danglingPatternLines(code: string, skip: readonly string[] = []): number[] {
  const lines: number[] = [];
  for (const start of topLevelStarts(code)) {
    const rest = code.slice(start);
    const quoted = /^['"`]/.test(rest);
    if (!quoted && !PATTERN_HEADS.test(rest)) continue;
    // The statement, as far as the end of its line and any chained lines
    // after it (a line that starts with a dot carries on).
    const end = rest.search(/\n(?!\s*\.)/);
    const statement = end === -1 ? rest : rest.slice(0, end);
    // `sine = …` would be an assignment (and an error of its own), and a
    // statement that is not a chain or a call is not a pattern being made.
    if (/^\w+\s*=[^=]/.test(statement)) continue;
    if (skip.some((name) => statement.includes(`.${name}(`))) continue;
    lines.push(code.slice(0, start).split('\n').length);
  }
  return lines;
}
