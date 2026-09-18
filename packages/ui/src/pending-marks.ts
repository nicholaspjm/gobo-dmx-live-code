/**
 * Marking the lines that are not on the rig.
 *
 * Ctrl+Shift+Enter commits only the edits you pointed at, which means the
 * buffer and the rig can legitimately differ — and an operator debugging a
 * light against source that is not running is worse off than one with no
 * feature at all. So the lines that have been edited since the run that is
 * currently live are marked, and the mark clears when they go live.
 *
 * True of an ordinary edit too, and worth saying there as well: between typing
 * a line and pressing Ctrl+Enter, that line is not what the rig is doing. The
 * mark is deliberately quiet — a rule down the inside edge of the line, no
 * background, no colour of its own — because it is on screen most of the time
 * while somebody is working and it must not compete with the syntax underneath
 * or with the live-token outline.
 */

import { EditorView, Decoration, type DecorationSet } from '@codemirror/view';
import { StateEffect, StateField, RangeSetBuilder, type Extension } from '@codemirror/state';

/** Carries the buffer ranges that are not in the running source. */
export const setPendingRanges = StateEffect.define<ReadonlyArray<[number, number]>>();

const pendingLine = Decoration.line({ class: 'gobo-pending' });

const pendingField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(deco, tr) {
    let next = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (!e.is(setPendingRanges)) continue;
      const doc = tr.state.doc;
      // One decoration per LINE, not per range: a line decoration must be
      // added at the line start, and two ranges on one line would otherwise
      // try to add the same position twice and throw.
      const lines = new Set<number>();
      for (const [from, to] of e.value) {
        if (from < 0 || to > doc.length || to < from) continue;
        const first = doc.lineAt(from).number;
        const last = doc.lineAt(to).number;
        for (let n = first; n <= last; n++) lines.add(n);
      }
      const builder = new RangeSetBuilder<Decoration>();
      for (const n of [...lines].sort((a, b) => a - b)) {
        builder.add(doc.line(n).from, doc.line(n).from, pendingLine);
      }
      next = builder.finish();
    }
    return next;
  },
  provide: (f) => EditorView.decorations.from(f),
});

/** The extension to hand CodeMirror. */
export function pendingMarks(): Extension {
  return [pendingField];
}

/** Say which buffer ranges are not in the source that is running. */
export function showPending(view: EditorView, ranges: ReadonlyArray<[number, number]>): void {
  view.dispatch({ effects: setPendingRanges.of(ranges) });
}
