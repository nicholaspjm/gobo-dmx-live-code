/**
 * Marking the line a failed run points at.
 *
 * The status bar says "line 12: …" at the bottom of the window, and the eyes
 * are on the code, so the line itself is tinted as well. The mark goes as soon
 * as that line is edited or a run succeeds: it describes the run that failed,
 * and once the text under it has changed it no longer does.
 */

import { EditorView, Decoration, type DecorationSet } from '@codemirror/view';
import { StateEffect, StateField, type Extension } from '@codemirror/state';

/** The 1-based line to mark, or null to clear it. */
const setErrorLine = StateEffect.define<number | null>();

const errorLine = Decoration.line({ class: 'gobo-error-line' });

const errorField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(deco, tr) {
    let next = deco;
    if (tr.docChanged && deco.size > 0) {
      // Cleared by an edit on the marked line, kept (and moved) otherwise.
      let touched = false;
      deco.between(0, tr.startState.doc.length, (from) => {
        const line = tr.startState.doc.lineAt(from);
        tr.changes.iterChangedRanges((a, b) => {
          if (b >= line.from && a <= line.to) touched = true;
        });
      });
      next = touched ? Decoration.none : deco.map(tr.changes);
    }
    for (const e of tr.effects) {
      if (!e.is(setErrorLine)) continue;
      const n = e.value;
      next = n === null || n < 1 || n > tr.state.doc.lines
        ? Decoration.none
        : Decoration.set([errorLine.range(tr.state.doc.line(n).from)]);
    }
    return next;
  },
  provide: (f) => EditorView.decorations.from(f),
});

/** The extension to hand CodeMirror. */
export function errorMark(): Extension {
  return [errorField];
}

/** Mark the line an error message names, or clear the mark when it names none. */
export function showErrorLine(view: EditorView, message: string | null): void {
  const m = message === null ? null : /^line (\d+):/.exec(message);
  view.dispatch({ effects: setErrorLine.of(m ? Number(m[1]) : null) });
}
