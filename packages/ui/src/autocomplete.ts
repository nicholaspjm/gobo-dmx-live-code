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
 *      methods (.viz, .flash, .glow, .wave).
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

// Merged method pool shown when we can't narrow by receiver.
const allMethods: Completion[] = [...patternMethods, ...fixtureMethods];

// ─── Light-name discovery (pre-scan user's doc) ──────────────────────────────
/** Mirrors the regex used in code-highlight.ts. Kept in sync manually. */
const LIGHT_DECL_RE =
  /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:fixture|rgbStrip|rgbwStrip|group)\s*\(/g;

function collectLightNames(doc: string): string[] {
  const names = new Set<string>();
  LIGHT_DECL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = LIGHT_DECL_RE.exec(doc)) !== null) {
    names.add(m[1]);
  }
  return [...names];
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
  const dotMatch = context.matchBefore(/([A-Za-z_$][\w$]*)\.(\w*)$/);
  if (dotMatch) {
    const methodStart = dotMatch.from + dotMatch.text.indexOf('.') + 1;
    return { from: methodStart, options: allMethods, validFor: /^\w*$/ };
  }

  // Case 2: bare identifier. Commands plus user-declared light names.
  const wordMatch = context.matchBefore(/[A-Za-z_$][\w$]*$/);
  if (!wordMatch) return null;
  if (wordMatch.from === wordMatch.to && !context.explicit) return null;

  const doc = context.state.doc.toString();
  const lightOptions: Completion[] = collectLightNames(doc).map((name) => ({
    label: name,
    type: 'variable',
    detail: 'fixture',
    info: 'A fixture you defined in this buffer.',
  }));

  return {
    from: wordMatch.from,
    options: [...commandCompletions, ...lightOptions],
    validFor: /^\w*$/,
  };
}

/** CodeMirror extension: our source over the default JavaScript completions. */
export const goboAutocomplete = autocompletion({
  override: [goboCompletions],
  activateOnTyping: true,
  closeOnBlur: true,
  maxRenderedOptions: 15,
});
