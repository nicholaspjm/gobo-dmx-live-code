/**
 * Editor autocomplete for the gobo API.
 *
 * Two contexts are recognised:
 *
 *   1. Bare identifier (`sin|`): top-level commands (fixture, sine,
 *      artnet, setBPM, …) plus any light names the user has declared via
 *      `const X = fixture(…)` / `rgbStrip(…)` / `rgbwStrip(…)`.
 *
 *   2. After a dot (`wash.|` or `sine().slow(4).|`): common method names,
 *      meaning channel setters (.red, .dim, …), pattern chains (.slow,
 *      .range, …), pixel/strip ops (.pixel, .fill, …), and the viz
 *      methods (.viz, .flash, .glow, .wave). When the receiver is a light
 *      the document declares, the verbs that light actually answers to are
 *      ranked above the rest of the pool. Nothing is dropped: `.slow()` on
 *      a light is still offered, further down.
 *
 * The completion set is curated rather than derived at eval time: eval
 * runs in a sandbox and its fixture metadata is not available to the
 * editor. The lists here use the same names as the code-highlight plugin,
 * so colouring and suggestions agree.
 */

import {
  autocompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete';
import { syntaxTree } from '@codemirror/language';
import { HELP_ENTRIES, type HelpEntry } from './help-data.js';
import { describeLight, findLight, findLights } from './declared-lights.js';

// ─── Completion pools ────────────────────────────────────────────────────────
// Derived from the shared help index so signatures/examples are authored once
// and surface in both the autocomplete popup and the hover tooltip.

/**
 * How a completed name should be written out.
 *
 * Read from the signature, which is authored once in the help index:
 *
 *   'sine() => Pattern'          call, no arguments   → sine()
 *   '.red(value | pattern)'      call, takes one      → .red(⎸)
 *   'silence'                    not a call           → silence
 *   '.pixelCount => number'      a property           → .pixelCount
 *
 * Accepting a completion used to insert the bare name, so `wash.red` sat
 * there looking finished and did nothing until the parentheses were typed by
 * hand. Worse, a bare method reference is legal JavaScript, so the scene ran
 * clean with a channel that never got set.
 */
function callShape(e: HelpEntry): { call: boolean; takesArgs: boolean } {
  if (e.kind === 'property' || e.kind === 'variable') return { call: false, takesArgs: false };
  const m = /\(([^)]*)\)/.exec(e.signature);
  if (!m) return { call: false, takesArgs: false };
  return { call: true, takesArgs: m[1].trim().length > 0 };
}

/** Build a CM Completion from a HelpEntry. The `info` field (the doc
 *  panel shown when an entry is selected) renders description plus
 *  example, so the example is visible before accepting the completion. */
function toCompletion(e: HelpEntry): Completion {
  const shape = callShape(e);
  return {
    label: e.label,
    type: e.kind,
    detail: e.signature,
    // Write the call, not just the name, and leave the cursor where the next
    // keystroke belongs: between the parentheses when there is an argument to
    // give, after them when there is not.
    apply: (view, _completion, from, to) => {
      const text = shape.call ? `${e.label}()` : e.label;
      const cursor = shape.call && shape.takesArgs
        ? from + e.label.length + 1
        : from + text.length;
      view.dispatch({
        changes: { from, to, insert: text },
        selection: { anchor: cursor },
      });
    },
    info: () => {
      const root = document.createElement('div');
      root.className = 'gobo-completion-info';
      const desc = document.createElement('div');
      desc.textContent = e.description;
      desc.className = 'gobo-completion-info-desc';
      root.appendChild(desc);
      if (e.example) {
        const lbl = document.createElement('div');
        lbl.textContent = 'example';
        lbl.className = 'gobo-completion-info-ex-label';
        root.appendChild(lbl);
        const ex = document.createElement('pre');
        ex.textContent = e.example;
        ex.className = 'gobo-completion-info-ex';
        root.appendChild(ex);
      }
      return root;
    },
  };
}

const commandCompletions: Completion[] = HELP_ENTRIES
  .filter((e) => e.context === 'command')
  .map(toCompletion);

const patternMethods: Completion[] = HELP_ENTRIES
  .filter((e) => e.context === 'pattern-method')
  .map(toCompletion);

const fixtureMethods: Completion[] = HELP_ENTRIES
  .filter((e) => e.context === 'fixture-method' || e.context === 'property')
  .map(toCompletion);

// Merged method pool. Everything in it is offered after any dot; what the
// receiver is changes the order, never the membership.
const allMethods: Completion[] = [...patternMethods, ...fixtureMethods];

/**
 * How well a label answers what has been typed, as a boost: an exact match
 * first, then prefix matches shortest-first, and nothing for a name only
 * CodeMirror's fuzzy matcher would let through. `q` is already lower-cased.
 */
function matchBoost(label: string, q: string): number {
  if (q === '') return 0;
  const l = label.toLowerCase();
  if (l === q) return 99;
  if (l.startsWith(q)) return Math.max(20, 80 - l.length * 2);
  return 0;
}

/**
 * Put the obvious answer at the top.
 *
 * CodeMirror scores a prefix hit on `channelCount` the same as one on `chase`
 * and then falls back to alphabetical, so typing `ch` offered channelCount,
 * channels, and only then the method actually named that. Its fuzzy matcher
 * also lets `punchcard` and `startChannel` through on the same two letters.
 *
 * A boost is added to CodeMirror's own score, so this reorders without hiding
 * anything.
 */
export function rankFor(options: Completion[], typed: string): Completion[] {
  if (typed === '') return options;
  const q = typed.toLowerCase();
  return options.map((o) => {
    const boost = matchBoost(o.label, q);
    return boost === 0 ? o : { ...o, boost };
  });
}

// ─── Ranking a method pool for the thing it is called on ─────────────────────

const NO_VERBS: ReadonlySet<string> = new Set();
const ALL_FIXTURE_VERBS: ReadonlySet<string> = new Set(fixtureMethods.map((o) => o.label));

/**
 * The verbs a light answers to, empty for a receiver that is not one.
 *
 * `describeLight` writes each command the way it is called: `red(v)`,
 * `color(r,g,b)`, `pixels.fill(r,g,b)`, `size`. The name is what precedes the
 * arguments; one carrying a dot belongs to a member rather than to the light
 * itself. So `wash.` is ranked on the names with no dot and `wash.pixels.` on
 * the ones written under `pixels`, which is why the receiver passed in is the
 * whole chain before the last dot rather than the last name in it.
 */
function verbsOn(doc: string, receiver: string): ReadonlySet<string> {
  const dot = receiver.indexOf('.');
  const decl = findLight(doc, dot === -1 ? receiver : receiver.slice(0, dot));
  if (decl === undefined) return NO_VERBS;

  const { commands } = describeLight(decl);
  // A fixture whose id is not loaded, or is not written as a literal, lists no
  // commands at all. It is still a light, so the whole fixture pool goes above
  // the pattern methods: which channels it has is unknown, that it has some is
  // not.
  if (commands.length === 0) return ALL_FIXTURE_VERBS;

  const path = dot === -1 ? '' : `${receiver.slice(dot + 1)}.`;
  const out = new Set<string>();
  for (const command of commands) {
    const paren = command.indexOf('(');
    const name = paren === -1 ? command : command.slice(0, paren);
    if (!name.startsWith(path)) continue;
    const verb = name.slice(path.length);
    if (!verb.includes('.')) out.add(verb);
  }
  return out;
}

/**
 * Half of what CodeMirror documents for a boost (-99 to 99), so a band and a
 * match tier can be added together without leaving that range.
 */
const BAND = 50;

/**
 * The method pool as it would be offered after `receiver.` in this document.
 *
 * A light's own verbs were lost in the merge. The pool after a dot is every
 * pattern method and every fixture method at once, while any one light answers
 * to a dozen of them at most, so `.chase` on a strip ranked below chain methods
 * that strip has no use for. The pool is ranked in two bands instead, the
 * light's own verbs above everything else, with the match tier deciding the
 * order inside each band.
 *
 * Two bands rather than a filter, because the reading can be wrong: the
 * receiver is recognised from the text, `register()` adds chain methods at run
 * time, and a custom fixture's channels are not known until the scene has run.
 * A wrong guess that reorders costs a keystroke. A wrong guess that filtered
 * would hide a method that is really there.
 */
export function methodsAfter(doc: string, receiver: string, typed: string): Completion[] {
  const own = verbsOn(doc, receiver);
  if (own.size === 0) return rankFor(allMethods, typed);
  const q = typed.toLowerCase();
  return allMethods.map((o) => {
    const tier = Math.floor(matchBoost(o.label, q) / 2);
    return { ...o, boost: own.has(o.label) ? BAND + tier : tier - BAND };
  });
}

// ─── Completion source ───────────────────────────────────────────────────────

function goboCompletions(context: CompletionContext): CompletionResult | null {
  // Skip inside strings and comments. Typing "re" in a comment shouldn't
  // pop the whole API up.
  const tree = syntaxTree(context.state);
  const nodeBefore = tree.resolveInner(context.pos, -1);
  const kind = nodeBefore.name;
  if (kind === 'String' || kind === 'TemplateString' || kind === 'LineComment' || kind === 'BlockComment') {
    return null;
  }

  // Case 1: method context, where the text before the cursor ends in
  // `.word` (the word may be empty). Show the merged pattern + fixture
  // method pool; the autocomplete UI handles prefix filtering.
  const dotMatch = context.matchBefore(/([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\.(\w*)$/);
  if (dotMatch) {
    // Split at the LAST dot: the match runs back over a whole chain so that
    // `bar.pixels.` can be recognised as a strip, and everything before that
    // dot is the receiver.
    const cut = dotMatch.text.lastIndexOf('.');
    const methodStart = dotMatch.from + cut + 1;
    const typed = context.state.sliceDoc(methodStart, context.pos);
    // No validFor: the ranking depends on what has been typed so far, so the
    // list has to be rebuilt as it grows rather than filtered in place.
    const doc = context.state.doc.toString();
    return { from: methodStart, options: methodsAfter(doc, dotMatch.text.slice(0, cut), typed) };
  }

  // Case 2: bare identifier. Commands plus user-declared light names.
  const wordMatch = context.matchBefore(/[A-Za-z_$][\w$]*$/);
  if (!wordMatch) return null;
  if (wordMatch.from === wordMatch.to && !context.explicit) return null;

  // Lights the user declared, described from their own declaration: the
  // completion list is where you look to remember what you called something,
  // and "a fixture you defined" was true of every entry in it.
  const doc = context.state.doc.toString();
  // Keyed by name so a name bound twice offers one entry, the later binding,
  // which is the one the running scene holds.
  const byName = new Map(findLights(doc).map((d) => [d.name, d]));
  const lightOptions: Completion[] = [...byName.values()].map((decl) => {
    const info = describeLight(decl);
    return {
      label: decl.name,
      type: 'variable',
      detail: info.signature,
      info: info.note ?? info.summary,
    };
  });

  return {
    from: wordMatch.from,
    options: rankFor([...commandCompletions, ...lightOptions], wordMatch.text),
  };
}

/** CodeMirror extension: our source over the default JavaScript completions. */
export const goboAutocomplete = autocompletion({
  override: [goboCompletions],
  activateOnTyping: true,
  closeOnBlur: true,
  maxRenderedOptions: 15,
});
