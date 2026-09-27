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
 *
 * Nine of these behaviours are switchable, because everything in gobo is
 * driven from the editor and editor habits are personal. Each one lives in its own
 * Compartment so a setting can be changed with a scene running: replacing the
 * whole extension set would rebuild the state and take the undo history, the
 * fold state and the live decorations with it.
 */

import { EditorView, keymap, lineNumbers, highlightActiveLine, drawSelection } from '@codemirror/view';
import { liveTokens } from './live-tokens.js';
import { pendingMarks } from './pending-marks.js';
import { errorMark } from './error-mark.js';
import { lookMarks } from './look-marks.js';
import { EditorState, Prec, Compartment } from '@codemirror/state';
import type { ChangeSet, Extension } from '@codemirror/state';
import { javascript } from '@codemirror/lang-javascript';
import { defaultKeymap, historyKeymap, history } from '@codemirror/commands';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
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
 * The text lives in examples.ts: EXAMPLES[0] is the two-line scene a new
 * browser opens on.
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

/**
 * The editor behaviours a user can turn off.
 *
 * The same list Strudel offers, minus the ones that mean
 * something different here. Tab indentation is not offered because Tab is
 * already the second key that accepts a completion, and with the popup closed
 * it is how a keyboard user leaves the editor: taking it would cost an
 * accessibility control to save a keystroke. Syncing across browser tabs is
 * not offered either: two tabs holding the same scene means two schedulers
 * writing the same DMX channels.
 */
export interface EditorPrefs {
  lineNumbers: boolean;
  activeLine: boolean;
  bracketMatching: boolean;
  closeBrackets: boolean;
  lineWrapping: boolean;
  autocomplete: boolean;
  hoverHelp: boolean;
  eventHighlight: boolean;
  multiCursor: boolean;
  /** Ctrl+Enter runs the block around the cursor rather than the document. */
  blockEval: boolean;
}

/** What createEditor() hands back: the view, and the way to change a pref. */
export interface GoboEditor {
  view: EditorView;
  setPrefs(prefs: EditorPrefs): void;
}

export function createEditor(
  parent: HTMLElement,
  onEval: EvalHandler,
  onStop: StopHandler,
  prefs: EditorPrefs,
  onChange?: ChangeHandler,
  initialDoc: string = DEFAULT_DOC,
  onEvalBlock?: EvalBlockHandler,
): GoboEditor {
  // Read by the Ctrl+Enter binding below, which is built once and has to see
  // the current value rather than the one that was set when it was built.
  let current = prefs;

  // One compartment per switchable behaviour. `of(…)` at build time and
  // `reconfigure(…)` later, both going through the same table, so a setting
  // cannot mean one thing on load and another after it is toggled.
  const parts = {
    lineNumbers: new Compartment(),
    activeLine: new Compartment(),
    bracketMatching: new Compartment(),
    closeBrackets: new Compartment(),
    lineWrapping: new Compartment(),
    autocomplete: new Compartment(),
    hoverHelp: new Compartment(),
    eventHighlight: new Compartment(),
    multiCursor: new Compartment(),
  };

  /** What each compartment holds when its pref is on. Off is the empty set. */
  function extensionFor(key: keyof typeof parts, p: EditorPrefs): Extension {
    if (!p[key]) return [];
    switch (key) {
      case 'lineNumbers': return lineNumbers();
      case 'activeLine': return highlightActiveLine();
      case 'bracketMatching': return bracketMatching();
      case 'closeBrackets': return [closeBrackets(), keymap.of(closeBracketsKeymap)];
      case 'lineWrapping': return EditorView.lineWrapping;
      case 'autocomplete': return goboAutocomplete;
      case 'hoverHelp': return goboHoverHelp;
      case 'eventHighlight': return liveTokens();
      // drawSelection goes with it: without it the browser draws one native
      // selection and the extra cursors are invisible, which is worse than
      // not having them.
      case 'multiCursor': return [EditorState.allowMultipleSelections.of(true), drawSelection()];
    }
  }

  const compartmentKeys = Object.keys(parts) as (keyof typeof parts)[];
  const evalKeybinding = Prec.highest(
    keymap.of([
      {
        // Commit only the edits inside the selection. Bound ahead of
        // Ctrl-Enter so the more specific chord is offered first.
        key: 'Ctrl-Shift-Enter',
        run(view) {
          if (current.blockEval) {
            onEval(view.state.doc.toString());
            return true;
          }
          if (!onEvalBlock) return false;
          onEvalBlock(view);
          return true;
        },
      },
      {
        key: 'Ctrl-Enter',
        run(view) {
          // With block evaluation on, the main chord takes the block around
          // the cursor and Ctrl+Shift+Enter still takes the whole document,
          // so the two chords swap and both stay available.
          if (current.blockEval && onEvalBlock) {
            onEvalBlock(view);
            return true;
          }
          onEval(view.state.doc.toString());
          return true;
        },
      },
      // Strudel's own pair, alongside gobo's: Alt+Enter runs and Alt+. stops,
      // so a hand that learned them there does not have to relearn them here.
      {
        key: 'Alt-Enter',
        run(view) {
          if (current.blockEval && onEvalBlock) {
            onEvalBlock(view);
            return true;
          }
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
      {
        key: 'Alt-.',
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
      // Folding a look you are not working on. The theme styles the gutter;
      // foldGutter() draws it.
      codeFolding(),
      foldGutter(),
      // Find. The browser's own find cannot stand in for it: CodeMirror only
      // renders the lines near the viewport, so Cmd+F in the browser searches
      // only the part of the document you can already see, which in a file
      // holding a whole performance misses most of it.
      search({ top: true }),
      highlightSelectionMatches(),
      // Marks lines edited since the run that is currently live. See
      // pending-marks.ts; fed by main.ts after every edit and every run.
      pendingMarks(),
      // Tints the line a failed run names. See error-mark.ts.
      errorMark(),
      // Look names marked and muted blocks dimmed. See look-marks.ts.
      lookMarks,
      indentOnInput(),
      // Everything switchable. The compartments hold this place in the array,
      // so turning one on puts it here in the precedence chain; appending it
      // would put it at the end.
      ...compartmentKeys.map((key) => parts[key].of(extensionFor(key, prefs))),
      javascript(),
      goboTheme,
      goboHighlight,
      goboCodeHighlight,
      // Must stay ahead of goboAutocomplete.
      //
      // Both are at Prec.highest, so the array decides which is asked first,
      // and the answer decides what Ctrl+Space does. Autocomplete binds it to
      // startCompletion, which returns true whenever the completion field
      // exists, meaning always: it does not check whether there is anything to
      // complete. If autocomplete is asked first it always wins, the stop never
      // runs, and Ctrl+Space opens a popup instead of going dark. Ctrl+Space is
      // a panic key, and this file's header and the README both say it stops.
      evalKeybinding,
      vizDecorationsField,
      changeListener,
      keymap.of([...searchKeymap, ...foldKeymap, ...defaultKeymap, ...historyKeymap]),
    ],
  });

  const view = new EditorView({ state, parent });

  return {
    view,
    setPrefs(next: EditorPrefs): void {
      current = next;
      view.dispatch({
        effects: compartmentKeys.map((key) => parts[key].reconfigure(extensionFor(key, next))),
      });
    },
  };
}

