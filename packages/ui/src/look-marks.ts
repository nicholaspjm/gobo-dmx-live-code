/**
 * Looks and mutes, marked in the editor.
 *
 * A look's name is highlighted where it is declared, `verse:`, so a
 * performance file reads as its cues. A muted block or line (`_verse:`,
 * `_$:`) is dimmed, the way strudel greys a muted pattern: it is still there
 * to read and unmute, and plainly not playing. Both come from the same
 * reading of the source that runs it (core looks.ts), so what is dimmed is
 * exactly what is skipped.
 */

import { EditorView, Decoration, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';
// The module on its own: the package index reads `window` at import time.
import { rewriteLooks } from '@gobo/core/looks';

const lookMark = Decoration.mark({ class: 'gobo-look' });
const mutedLine = Decoration.line({ class: 'gobo-muted' });

function build(view: EditorView): DecorationSet {
  const doc = view.state.doc;
  let found: ReturnType<typeof rewriteLooks>;
  try {
    found = rewriteLooks(doc.toString());
  } catch {
    return Decoration.none;
  }
  const marks: Array<{ from: number; to: number; deco: Decoration }> = [];
  for (const l of found.labels) marks.push({ from: l.from, to: l.to, deco: lookMark });
  const lines = new Set<number>();
  for (const m of found.muted) {
    const first = doc.lineAt(m.from).number;
    const last = doc.lineAt(Math.max(m.from, m.to - 1)).number;
    for (let n = first; n <= last; n++) lines.add(n);
  }
  for (const n of lines) marks.push({ from: doc.line(n).from, to: doc.line(n).from, deco: mutedLine });
  // A line decoration sorts before a mark at the same position.
  marks.sort((a, b) => a.from - b.from || (a.deco === mutedLine ? -1 : 1));
  const builder = new RangeSetBuilder<Decoration>();
  for (const m of marks) builder.add(m.from, m.to, m.deco);
  return builder.finish();
}

export const lookMarks = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = build(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged) this.decorations = build(u.view);
    }
  },
  { decorations: (v) => v.decorations },
);
