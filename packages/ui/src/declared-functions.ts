/**
 * Functions the scene declares, for the completion list.
 *
 * A performance file is one document holding a whole show, and the looks in it
 * are functions the operator wrote: verse, chorus, breakdown, blackoutAll. The
 * completion list knew every name gobo ships and every light the scene
 * declared, and nothing at all about those — so the one set of names that is
 * different in every file, and the one you actually type to change what the
 * rig is doing, was the set you had to remember unaided.
 *
 * Text, not types. This is the same kind of scan as declared-lights.ts: it
 * reads the shapes a function is written in rather than parsing the document,
 * because the document is usually half-typed and a parser would have nothing
 * to say about it. A shape it does not recognise costs a completion, which is
 * why it errs towards recognising too few rather than offering a name that is
 * not there.
 */

import { stripNonCode } from './source-scan.js';

export interface FunctionDecl {
  name: string;
  /** The parameter list as written, without the parens. '' when there is none. */
  params: string;
  /** Document offset of the bound name, so a declaration can be told apart. */
  nameFrom: number;
}

/**
 * `function verse(…)`, in a document that mostly does not use it.
 *
 * Kept because a look named after one of gobo's own — strobe, flash, red — can
 * only be declared this way: const and let collide with the sandbox parameter
 * of the same name and a function declaration does not. So a scene that hit
 * that clash and took the advice ends up here.
 */
const FUNCTION_RE = /\bfunction\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/g;

/**
 * `const verse = () => …` and its variations.
 *
 * Covers an arrow with a parenthesised list, an arrow with one bare parameter,
 * and a function expression, each optionally async. Group 1 is the keyword and
 * its spacing, present only so the bound name's offset comes out without a
 * lookbehind — the same trick, for the same reason, as declared-lights.ts.
 */
const ARROW_RE = new RegExp(
  String.raw`\b((?:const|let|var)\s+)([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?(?:` +
  String.raw`\(([^)]*)\)\s*=>` +          // = (a, b) => …
  String.raw`|([A-Za-z_$][\w$]*)\s*=>` +  // = x => …
  String.raw`|function\s*\(([^)]*)\)` +   // = function (a) …
  String.raw`)`,
  'g',
);

/**
 * Every function this document declares, in source order.
 *
 * Runs over stripped source, so one written inside a comment or a string is
 * not a declaration. A name bound more than once appears once, as its last
 * binding, which is the one a run would end up holding.
 */
export function findFunctions(doc: string): FunctionDecl[] {
  const code = stripNonCode(doc).join('\n');
  const byName = new Map<string, FunctionDecl>();

  for (const m of code.matchAll(FUNCTION_RE)) {
    const at = (m.index ?? 0) + m[0].indexOf(m[1]);
    byName.set(m[1], { name: m[1], params: m[2].trim(), nameFrom: at });
  }
  for (const m of code.matchAll(ARROW_RE)) {
    const name = m[2];
    const params = (m[3] ?? m[4] ?? m[5] ?? '').trim();
    byName.set(name, { name, params, nameFrom: (m.index ?? 0) + m[1].length });
  }

  // Source order, so the list reads the way the document does rather than the
  // way the two passes above happen to run.
  return [...byName.values()].sort((a, b) => a.nameFrom - b.nameFrom);
}

/** How a declaration should read in the completion list. */
export function functionSignature(decl: FunctionDecl): string {
  return `${decl.name}(${decl.params})`;
}
