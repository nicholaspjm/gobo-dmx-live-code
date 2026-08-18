/**
 * CodeMirror 6 editor setup.
 *
 * Keybindings:
 *   Ctrl+Enter  evaluate code
 *   Ctrl+.      stop / clear all channels
 *   Ctrl+Space  stop / clear all channels (preempts autocompletion;
 *               callers can still trigger completion by typing a
 *               trigger character like `.`).
 */

import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view';
import { EditorState, Prec } from '@codemirror/state';
import { javascript } from '@codemirror/lang-javascript';
import { defaultKeymap, historyKeymap, history } from '@codemirror/commands';
import { bracketMatching, indentOnInput } from '@codemirror/language';
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
export type ChangeHandler = (code: string) => void;

export function createEditor(
  parent: HTMLElement,
  onEval: EvalHandler,
  onStop: StopHandler,
  onChange?: ChangeHandler,
  initialDoc: string = DEFAULT_DOC,
): EditorView {
  const evalKeybinding = Prec.highest(
    keymap.of([
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
      onChange(update.state.doc.toString());
    }
  });

  const state = EditorState.create({
    doc: initialDoc,
    extensions: [
      history(),
      lineNumbers(),
      highlightActiveLine(),
      bracketMatching(),
      indentOnInput(),
      javascript(),
      goboTheme,
      goboHighlight,
      goboCodeHighlight,
      goboAutocomplete,
      goboHoverHelp,
      vizDecorationsField,
      evalKeybinding,
      changeListener,
      keymap.of([...defaultKeymap, ...historyKeymap]),
    ],
  });

  return new EditorView({ state, parent });
}

