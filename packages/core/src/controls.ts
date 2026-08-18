/**
 * Live controls: values a scene declares and a person moves while it runs.
 *
 *   const level = slider('level', 0, 1)
 *   wash.dim(level)
 *
 * The editor draws a control at the call site and dragging it changes the
 * light immediately. Nothing is re-evaluated: `slider()` returns a pattern
 * whose value is read fresh on every tick, so moving it is a read of a
 * number, not a rebuild of the scene. That matters during a show, where a
 * re-evaluation is a visible seam and this has to be a smooth fade.
 *
 * Values live here, keyed by name, and survive re-evaluation. Someone who
 * sets a level by hand and then edits a line further down the scene keeps
 * the level they set; it would be useless if every run snapped every control
 * back to where the source says. The source value is the STARTING position,
 * used the first time a name is seen and ignored afterwards.
 */

import type { PatternLike } from './dmx.js';

/** One control declared by the running scene. */
export interface ControlEntry {
  name: string;
  min: number;
  max: number;
  /** Where it started, for the reset affordance. */
  initial: number;
  /** Rounding step, or 0 for continuous. */
  step: number;
}

/** Declared by the current scene, in source order. */
let _entries: ControlEntry[] = [];

/**
 * Current positions, by name. Deliberately NOT cleared between runs: a
 * control someone has moved keeps its position across an edit.
 */
const _values = new Map<string, number>();

/** Forget the declarations. Values are kept. Called before each run. */
export function clearControls(): void {
  _entries = [];
}

/** The controls the current scene declared, in the order it declared them. */
export function getControls(): readonly ControlEntry[] {
  return _entries;
}

/** Current position of a named control, or null if it has none. */
export function getControlValue(name: string): number | null {
  const v = _values.get(name);
  return v === undefined ? null : v;
}

/**
 * Move a control. Called by the editor widget as it is dragged, so it runs
 * often and does nothing but clamp and store.
 */
export function setControlValue(name: string, value: number): void {
  if (!Number.isFinite(value)) return;
  const entry = _entries.find((e) => e.name === name);
  const min = entry?.min ?? 0;
  const max = entry?.max ?? 1;
  _values.set(name, Math.max(min, Math.min(max, value)));
}

/** Forget every stored position. For a deliberate reset, not for a re-run. */
export function resetControls(): void {
  _values.clear();
}

/**
 * A value with a handle on it.
 *
 * @param name     what to label it, and the key its position is stored under
 * @param min      lowest value (default 0)
 * @param max      highest value (default 1)
 * @param opts     `start` for the opening position, `step` to quantise
 *
 * @example
 *   const level = slider('level')
 *   const rate  = slider('rate', 1, 16, { step: 1 })
 *   wash.dim(level)
 *   strb.strobe(mini('1*16').fast(rate))
 */
export function slider(
  name: string,
  min = 0,
  max = 1,
  opts: { start?: number; step?: number } = {},
): PatternLike {
  if (typeof name !== 'string' || name.trim() === '') {
    throw new Error('slider: needs a name, which labels it and stores its position');
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    throw new Error(`slider("${name}"): min and max must be finite numbers`);
  }
  if (min >= max) {
    throw new Error(`slider("${name}"): min (${min}) must be below max (${max})`);
  }
  const step = opts.step ?? 0;
  if (!Number.isFinite(step) || step < 0) {
    throw new Error(`slider("${name}"): step must be a non-negative number`);
  }

  // Two sliders sharing a name would share a position and fight over it,
  // each redrawing the other's handle. Better to say so than to let one
  // silently win.
  if (_entries.some((e) => e.name === name)) {
    throw new Error(`slider("${name}"): already declared in this scene. Give each control its own name.`);
  }

  const initial = Math.max(min, Math.min(max, opts.start ?? min));
  _entries.push({ name, min, max, initial, step });
  // First sighting sets the position; later runs leave a moved control alone.
  if (!_values.has(name)) _values.set(name, initial);

  return {
    // Read at query time, which is what makes dragging immediate: the tick
    // asks for the value 60 times a second and gets whatever the handle is
    // at right now.
    queryArc() {
      return [{ value: _values.get(name) ?? initial }];
    },
  };
}
