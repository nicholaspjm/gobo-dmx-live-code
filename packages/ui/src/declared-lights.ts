/**
 * The lights a scene declares, read out of the buffer.
 *
 * `const wash = fixture(1, 'rgb')` binds a name to a thing with its own
 * channels and its own verbs, and the editor is told none of it: eval runs in
 * a sandbox and hands back no metadata. So the declaration is read directly,
 * which is enough to say what a name is and what it answers to.
 *
 * Three surfaces want this and each used to carry its own copy of the regex:
 * syntax colouring (which names to paint as fixtures), autocomplete (which
 * names to offer) and hover (what to say about one). Two of the three had
 * fallen behind and knew nothing about `monoStrip` or `screen`.
 *
 * Custom ids only resolve once the scene has run, because `defineFixture`
 * registers them at run time. Hovering one before then says so rather than
 * pretending the fixture does not exist.
 */

// Imported from the fixtures module rather than the package index: this file
// wants the fixture metadata and nothing else, and the index also carries the
// DMX engine and the bridge client, which read `window` at import time.
import {
  findFixtureDef,
  fixtureCommands,
  groupCommands,
  stripCommands,
  type FixtureDef,
} from '@gobo/core/fixtures';

export type LightKind =
  | 'fixture' | 'rgbStrip' | 'rgbwStrip' | 'monoStrip' | 'group' | 'screen';

/** One `const name = constructor(args)` binding found in the document. */
export interface LightDecl {
  name: string;
  kind: LightKind;
  /** Arguments as written, split at top-level commas and trimmed. */
  args: string[];
  /** Document offset of the bound name, so a declaration can be told from a
   *  reference to it. */
  nameFrom: number;
}

/** Constructors that produce something addressable. Order is irrelevant; the
 *  alternation is anchored by the `=` before it either way. */
const CONSTRUCTORS = ['fixture', 'rgbwStrip', 'rgbStrip', 'monoStrip', 'group', 'screen'] as const;

/**
 * Group 1 is the keyword and its spacing, present only so the bound name's
 * offset comes out as `m.index + m[1].length` without a lookbehind. `let` and
 * `var` are allowed in case the user switches style.
 *
 * `rgbwStrip` precedes `rgbStrip` in the alternation because JavaScript
 * alternation is first-match, not longest-match, and the shorter name is a
 * prefix of the longer one only in the other order.
 */
const DECL_RE = new RegExp(
  String.raw`\b((?:const|let|var)\s+)([A-Za-z_$][\w$]*)\s*=\s*(${CONSTRUCTORS.join('|')})\s*\(`,
  'g',
);

/**
 * Read the argument list starting just inside an open paren.
 *
 * Returns null when the parens never balance, which is the normal state of a
 * call that is still being typed. Quotes and nesting are tracked so a comma
 * inside `{ columns: 12 }` or `'a,b'` does not split an argument.
 */
function readArgs(doc: string, open: number): string[] | null {
  const out: string[] = [];
  let depth = 0;
  let quote = '';
  let start = open;
  for (let i = open; i < doc.length; i++) {
    const c = doc[i];
    if (quote !== '') {
      if (c === '\\') i++;
      else if (c === quote) quote = '';
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '(' || c === '[' || c === '{') { depth++; continue; }
    if (c === ')' && depth === 0) {
      out.push(doc.slice(start, i).trim());
      // `screen()` reads as one empty argument; it has none.
      return out.length === 1 && out[0] === '' ? [] : out;
    }
    if (c === ')' || c === ']' || c === '}') { depth--; continue; }
    if (c === ',' && depth === 0) { out.push(doc.slice(start, i).trim()); start = i + 1; }
  }
  return null;
}

/** Every light declared in the document, in source order. */
export function findLights(doc: string): LightDecl[] {
  const out: LightDecl[] = [];
  DECL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = DECL_RE.exec(doc)) !== null) {
    const args = readArgs(doc, m.index + m[0].length);
    if (args === null) continue;
    out.push({
      name: m[2],
      kind: m[3] as LightKind,
      args,
      nameFrom: m.index + m[1].length,
    });
  }
  return out;
}

/** Just the bound names, for callers that only need to know which identifiers
 *  in the document are lights. */
export function lightNames(doc: string): Set<string> {
  return new Set(findLights(doc).map((d) => d.name));
}

/** Find the declaration that bound a name, or undefined. A name bound twice
 *  resolves to the last one, matching what the running scene would hold. */
export function findLight(doc: string, name: string): LightDecl | undefined {
  let found: LightDecl | undefined;
  for (const d of findLights(doc)) if (d.name === name) found = d;
  return found;
}

/** What to show for a declared light. */
export interface LightInfo {
  /** The call that made it, normalised. */
  signature: string;
  /** One line: what it is and how many channels it holds. */
  summary: string;
  /** What it answers to. Empty when the fixture id is not loaded. */
  commands: string[];
  /** Set when something could not be resolved, explaining what to do. */
  note?: string;
}

/** Strip surrounding quotes from a literal, or return null for anything that
 *  is not a plain string literal (a variable, a template with a hole). */
function unquote(arg: string | undefined): string | null {
  if (arg === undefined) return null;
  const m = /^(['"`])(.*)\1$/.exec(arg.trim());
  return m ? m[2] : null;
}

/** Read an integer literal argument, or null if it is an expression. */
function intArg(arg: string | undefined): number | null {
  if (arg === undefined) return null;
  const n = Number(arg.trim());
  return Number.isInteger(n) ? n : null;
}

/** Pull `columns: 12` out of an options object written inline. */
function columnsOf(args: string[]): number | null {
  for (const a of args) {
    const m = /\bcolumns\s*:\s*(\d+)/.exec(a);
    if (m) return Number(m[1]);
  }
  return null;
}

/** `12 channels from 1 to 12`, or the vaguer form when the address is an
 *  expression rather than a literal. */
function channelSpan(start: number | null, count: number): string {
  if (start === null) return `${count} channels`;
  return `${count} channels · ${start} to ${start + count - 1}`;
}

/** Grid suffix for a strip that declared its columns. */
function gridNote(cols: number | null, pixels: number | null): string {
  if (cols === null || pixels === null) return '';
  return ` · ${cols} across, ${Math.ceil(pixels / cols)} down`;
}

function describeFixture(decl: LightDecl): LightInfo {
  const start = intArg(decl.args[0]);
  const id = unquote(decl.args[1]);
  const universe = intArg(decl.args[2]);
  const shown = decl.args.slice(0, 3).join(', ');
  const signature = `fixture(${shown})`;

  if (id === null) {
    return {
      signature,
      summary: 'A patched fixture.',
      commands: [],
      note: 'The fixture id is not a plain string here, so its channels cannot be read from the text.',
    };
  }
  const def: FixtureDef | undefined = findFixtureDef(id);
  if (!def) {
    return {
      signature,
      summary: `Fixture "${id}".`,
      commands: [],
      note: `No fixture is loaded under that id. If it comes from defineFixture, run the scene once; otherwise check the library panel for the id.`,
    };
  }
  const uni = universe !== null && universe !== 0 ? ` · universe ${universe}` : '';
  return {
    signature,
    summary: `${def.name} · ${channelSpan(start, def.channelCount)}${uni}`,
    commands: fixtureCommands(def),
  };
}

function describeStrip(decl: LightDecl, layout: 'rgb' | 'rgbw' | 'mono'): LightInfo {
  const start = intArg(decl.args[0]);
  const pixels = intArg(decl.args[1]);
  const stride = layout === 'rgbw' ? 4 : layout === 'mono' ? 1 : 3;
  const cols = columnsOf(decl.args.slice(2));
  const per = layout === 'mono' ? '1 channel each' : `${stride} channels each`;
  const cells = layout === 'mono' ? 'cells' : 'pixels';
  const kind = layout === 'mono' ? 'A single-channel' : `An ${layout.toUpperCase()}`;
  const summary = pixels === null
    ? `${kind} strip.`
    : `${pixels} ${cells} · ${per} · ${channelSpan(start, pixels * stride)}${gridNote(cols, pixels)}`;
  return {
    signature: `${decl.kind}(${decl.args.join(', ')})`,
    summary,
    commands: stripCommands(layout),
  };
}

function describeScreen(decl: LightDecl): LightInfo {
  const pixels = intArg(decl.args[0]) ?? (decl.args.length === 0 ? 1 : null);
  const cols = columnsOf(decl.args);
  const summary = pixels === null
    ? 'A light made of screen.'
    : pixels === 1
      ? 'One colour wash, drawn rather than patched. No DMX address.'
      : `${pixels} cells drawn on screen${gridNote(cols, pixels)}. No DMX address.`;
  return {
    signature: `screen(${decl.args.join(', ')})`,
    summary,
    commands: stripCommands('rgb'),
  };
}

function describeGroup(decl: LightDecl): LightInfo {
  const n = decl.args.length;
  return {
    signature: `group(${decl.args.join(', ')})`,
    summary: n === 0
      ? 'A group.'
      : `${n} member${n === 1 ? '' : 's'} under one name. Roles a member does not have are skipped.`,
    commands: groupCommands(),
  };
}

/** Describe a declared light: the call that made it, what it holds, and what
 *  it responds to. */
export function describeLight(decl: LightDecl): LightInfo {
  switch (decl.kind) {
    case 'fixture':   return describeFixture(decl);
    case 'rgbStrip':  return describeStrip(decl, 'rgb');
    case 'rgbwStrip': return describeStrip(decl, 'rgbw');
    case 'monoStrip': return describeStrip(decl, 'mono');
    case 'screen':    return describeScreen(decl);
    case 'group':     return describeGroup(decl);
  }
}
