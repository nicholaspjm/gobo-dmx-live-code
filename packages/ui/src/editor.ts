/**
 * CodeMirror 6 editor setup.
 *
 * Keybindings:
 *   Ctrl+Enter        evaluate the whole document
 *   Ctrl+Shift+Enter  evaluate only the edits inside the selection (splice.ts)
 *   Ctrl+.      stop / clear all channels
 *   Ctrl+Space  stop / clear all channels (preempts autocompletion;
 *               callers can still trigger completion by typing a
 *               trigger character like `.`).
 *   Enter       accept the highlighted completion, while the popup is open
 *   Tab         the same, as a second accept key
 *
 * Enter and Tab are bound by goboAutocomplete rather than here, since both
 * commands only mean anything while that extension is installed. Neither is
 * bound when the popup is closed: Enter inserts a newline and Tab moves focus
 * out of the editor, which is how a keyboard user leaves it. See autocomplete.ts.
 */

import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view';
import { liveTokens } from './live-tokens.js';
import { pendingMarks } from './pending-marks.js';
import { EditorState, Prec } from '@codemirror/state';
import type { ChangeSet } from '@codemirror/state';
import { javascript } from '@codemirror/lang-javascript';
import { defaultKeymap, historyKeymap, history } from '@codemirror/commands';
import { search, searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { bracketMatching, indentOnInput, foldGutter, foldKeymap, codeFolding } from '@codemirror/language';
import { goboTheme, goboHighlight } from './theme.js';
import { vizDecorationsField } from './inline-viz.js';
import { goboCodeHighlight } from './code-highlight.js';
import { goboAutocomplete } from './autocomplete.js';
import { goboHoverHelp } from './hover-help.js';
import { EXAMPLES } from './examples.js';

/**
 * The document a brand-new editor starts on.
 *
 * This used to be a hardcoded INITIAL_CODE constant here, duplicated verbatim
 * by one of the bundled examples. Examples own that text now (examples.ts),
 * and EXAMPLES[0] is the two-line scene a new browser opens on.
 *
 * main.ts always passes the user's stored buffer, so this default is only
 * reached by a caller that has nothing to restore.
 */
const DEFAULT_DOC = EXAMPLES[0].code;

export type EvalHandler = (code: string) => void;
export type StopHandler = () => void;
export type ChangeHandler = (code: string, changes: ChangeSet) => void;
/** Run only the edits inside the current selection. See splice.ts. */
export type EvalBlockHandler = (view: EditorView) => void;

export function createEditor(
  parent: HTMLElement,
  onEval: EvalHandler,
  onStop: StopHandler,
  onChange?: ChangeHandler,
  initialDoc: string = DEFAULT_DOC,
  onEvalBlock?: EvalBlockHandler,
): EditorView {
  const evalKeybinding = Prec.highest(
    keymap.of([
      {
        // Commit only the edits inside the selection. Bound ahead of
        // Ctrl-Enter so the more specific chord is offered first.
        key: 'Ctrl-Shift-Enter',
        run(view) {
          if (!onEvalBlock) return false;
          onEvalBlock(view);
          return true;
        },
      },
      {
        key: 'Ctrl-Enter',
        run(view) {
          onEval(view.state.doc.toString());
          return true;
        },
      },
      {
        key: 'Ctrl-.',
        run() {
          onStop();
          return true;
        },
      },
      // Ctrl+Space is the conventional autocomplete trigger in CM. It is
      // overridden here at Prec.highest because performers asked for a
      // panic stop that doesn't require the easy-to-miss period key.
      // Autocomplete still opens automatically as you type, since the
      // autocompletion extension watches for trigger characters.
      {
        key: 'Ctrl-Space',
        run() {
          onStop();
          return true;
        },
      },
    ]),
  );

  // Fire the change callback on any doc edit (user typing, paste, undo…).
  // Consumers typically debounce this before hitting the network.
  const changeListener = EditorView.updateListener.of((update) => {
    if (update.docChanged && onChange) {
      onChange(update.state.doc.toString(), update.changes);
    }
  });

  const state = EditorState.create({
    doc: initialDoc,
    extensions: [
      history(),
      lineNumbers(),
      // Folding a look you are not working on. The gutter has been styled
      // since the theme was written; what was missing was the extension that
      // draws it, so a long document had no way to collapse anything.
      codeFolding(),
      foldGutter(),
      highlightActiveLine(),
      // Find, which the editor simply did not have. The browser's own find is
      // no substitute: CodeMirror only renders the lines near the viewport, so
      // Cmd+F in the browser searches the part of the document you can already
      // see. In a file holding a whole performance that is the wrong half.
      search({ top: true }),
      highlightSelectionMatches(),
      // Outlines the mini-notation token currently driving light. Inert until
      // the engine is asked to collect locations, which main.ts does once.
      liveTokens(),
      // Marks lines edited since the run that is currently live. See
      // pending-marks.ts; fed by main.ts after every edit and every run.
      pendingMarks(),
      bracketMatching(),
      indentOnInput(),
      javascript(),
      goboTheme,
      goboHighlight,
      goboCodeHighlight,
      // Ahead of goboAutocomplete, and that ordering is load-bearing.
      //
      // Both are at Prec.highest, so the array decides which is asked first,
      // and the answer decides what Ctrl+Space does. Autocomplete binds it to
      // startCompletion, which returns true whenever the completion field
      // exists, meaning always: it does not check whether there is anything to
      // complete. So while it was asked first, it always won, and the stop
      // below never ran. Ctrl+Space opened a popup instead of going dark,
      // which is the opposite of what this file's own comment and the README
      // both promise, and it is a panic key.
      evalKeybinding,
      goboAutocomplete,
      goboHoverHelp,
      vizDecorationsField,
      changeListener,
      keymap.of([...searchKeymap, ...foldKeymap, ...defaultKeymap, ...historyKeymap]),
    ],
  });

  return new EditorView({ state, parent });
}

