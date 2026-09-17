/**
 * Outlining the mini-notation token that is lighting something right now.
 *
 * With sound you hear which step is playing. With light your eyes are on the
 * rig, and when something looks wrong you are left counting tokens in a long
 * string to work out which one is firing. This marks it: the code becomes its
 * own playhead.
 *
 * The data comes from the engine. dmx.ts collects the character ranges of
 * every hap that actually reached a channel on the last tick — see
 * setLocationCollection — and this paints them.
 *
 * Marks are rebuilt from those ranges on an animation frame rather than held
 * across ticks, because the set changes every tick by definition. What is NOT
 * rebuilt per frame is the DOM: CodeMirror is handed the same decoration set
 * when nothing has moved, and a set it considers equal costs nothing.
 */

import { EditorView, Decoration, ViewPlugin, type DecorationSet } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import { StateEffect, StateField, RangeSetBuilder } from '@codemirror/state';

import { getActiveLocations } from '@gobo/core';

/** The mark itself. Styled in index.html beside the other editor decorations. */
const liveMark = Decoration.mark({ class: 'gobo-live-token' });

/** Carries a new set of ranges into the editor state. */
const setLiveRanges = StateEffect.define<readonly number[]>();

/**
 * The live ranges, as a decoration set.
 *
 * A StateField rather than a plugin-local value so the ranges survive document
 * changes the way every other decoration here does: CodeMirror maps them
 * through the change, so a token stays outlined while you type in front of it
 * instead of jumping a column.
 */
const liveField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(deco, tr) {
    let next = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (!e.is(setLiveRanges)) continue;
      const flat = e.value;
      const len = tr.state.doc.length;
      const builder = new RangeSetBuilder<Decoration>();
      // Flat [start, end, …] pairs, in ascending order, which is what
      // RangeSetBuilder requires. The engine appends them in query order
      // across several channels, so they are sorted here rather than there:
      // the tick loop runs sixty times a second and this does not.
      const pairs: Array<[number, number]> = [];
      for (let i = 0; i + 1 < flat.length; i += 2) {
        const from = flat[i];
        const to = flat[i + 1];
        // A range from a scene that has since been edited can point past the
        // end of the document. Dropped rather than clamped: a mark on the
        // wrong characters is worse than no mark.
        if (from < 0 || to > len || to <= from) continue;
        pairs.push([from, to]);
      }
      pairs.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      let lastTo = -1;
      for (const [from, to] of pairs) {
        // Overlapping ranges would make the builder throw. Two channels
        // driven by one token produce the same range twice, which is the
        // common case, and nesting happens with a group inside a group.
        if (from < lastTo) continue;
        builder.add(from, to, liveMark);
        lastTo = to;
      }
      next = builder.finish();
    }
    return next;
  },
  provide: (f) => EditorView.decorations.from(f),
});

/** Whether the two flat range lists describe the same thing. */
function same(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * The frame loop that keeps the marks in step with the rig.
 *
 * One rAF for the whole editor, not one per mark. It compares the engine's
 * current ranges against what was last painted and dispatches only on a
 * change, so a held chord or a scene with no mini in it costs one array
 * comparison per frame and no DOM work at all.
 */
const livePlugin = ViewPlugin.fromClass(
  class {
    private painted: number[] = [];
    private frame = 0;

    constructor(private view: EditorView) {
      this.tick = this.tick.bind(this);
      this.frame = requestAnimationFrame(this.tick);
    }

    tick(): void {
      this.frame = requestAnimationFrame(this.tick);
      const now = getActiveLocations();
      if (same(now, this.painted)) return;
      this.painted = [...now];
      this.view.dispatch({ effects: setLiveRanges.of(this.painted) });
    }

    destroy(): void {
      cancelAnimationFrame(this.frame);
    }
  },
);

/** The extension to hand CodeMirror. */
export function liveTokens(): Extension {
  return [liveField, livePlugin];
}
