/**
 * Look selection from buttons, keys and MIDI.
 *
 * A performance file holds the whole show, and the looks in it are functions
 * the operator wrote: verse, chorus, breakdown. Switching between them by
 * editing the call line and pressing Ctrl+Enter is awkward with one hand on a
 * fader.
 *
 * A control cannot choose a look directly. slider() and midi() are read at
 * QUERY time, inside a pattern, sixty times a second; which function runs is
 * decided at EVAL time, once, and by then the channels are already registered.
 * A fader can ride a level inside the live look but cannot select the look.
 *
 * So selecting a look triggers a fresh evaluation. Evaluation is atomic (the
 * staged scene replaces the live one at a tick boundary, so nothing blinks),
 * which makes "run the file again with a different look selected" a clean
 * whole-rig swap with nothing new on the wire.
 *
 * The selection persists across runs the way a slider's position does, so
 * editing and re-running the file during a show keeps the same look up.
 */

/** The names the running scene offered, in the order it offered them. */
let _names: string[] = [];

/**
 * The name the operator picked, or null for "whatever comes first".
 *
 * Kept between runs. It is a position, like a fader's, and a scene that
 * re-registers the same names should come back up on the same look. A name
 * that is no longer offered is handled at read time instead of cleared here,
 * so renaming a look and then renaming it back keeps the selection.
 */
let _selected: string | null = null;

const _listeners = new Set<(name: string, previous: string | null) => void>();

/**
 * Tell the host that the selection changed and the scene should run again.
 *
 * The re-run belongs to whoever owns the document, which is the UI; the engine
 * does not have the source text. So this only notifies listeners.
 */
export function onCueChange(fn: (name: string, previous: string | null) => void): void {
  _listeners.add(fn);
}

/** The looks the running scene offered. */
export function getCues(): readonly string[] {
  return _names;
}

/**
 * The look that is up: the picked one if it is still offered, else the first.
 *
 * Rename the selected look, or run a different file, and the selection points
 * at something that is not there. Falling back to the first look keeps the rig
 * lit instead of going dark.
 */
export function getSelectedCue(): string | null {
  if (_selected !== null && _names.includes(_selected)) return _selected;
  return _names[0] ?? null;
}

/**
 * Record the looks this run offers.
 *
 * Called from cue() during evaluation, so it must not announce anything: the
 * run that is registering is the run that has just been asked for, and telling
 * the host to run again from inside a run is a loop.
 */
export function registerCues(names: readonly string[], drivenByPattern = false): void {
  _names = [...names];
  _driven = drivenByPattern;
}

/**
 * Whether the running scene is choosing its own look.
 *
 * With a selector the choice is written into the scene and read every frame,
 * so there is no single look that is "up" for the bar to highlight and
 * nothing for a chip or a key to decide. The bar must say so: highlighting one
 * look while a pattern moves between them would show something other than
 * what the rig is doing.
 */
export function isCueDrivenByPattern(): boolean {
  return _driven;
}

let _driven = false;

/**
 * Pick a look by name. Unknown names are ignored.
 *
 * No exception: the callers are a click, a key and a MIDI message, none of
 * which can show one to the operator, and a stale button pointing at a renamed
 * look should do nothing during a show.
 */
export function selectCue(name: string): void {
  // A scene choosing its own look ignores buttons. Re-running it would change
  // nothing, and moving the highlight would misreport what the rig is doing.
  if (_driven) return;
  if (!_names.includes(name)) return;
  // The EFFECTIVE selection: with nothing picked yet the first look is the one
  // that is lit, and pressing its button should do nothing instead of
  // re-running the file. It is also what the host restores if the look it is
  // about to ask for fails to run.
  const previous = getSelectedCue();
  if (previous === name) return;
  _selected = name;
  for (const fn of _listeners) fn(name, previous);
}

/**
 * Pick a look by position, 1-based.
 *
 * The 1-based count matches the buttons: cue 1 is the first look, as on a
 * desk and on the number row of a keyboard.
 */
export function selectCueIndex(oneBased: number): void {
  const name = _names[oneBased - 1];
  if (name !== undefined) selectCue(name);
}

/**
 * Put the selection back, without announcing it.
 *
 * For the host to call when the run a selection asked for did not succeed. A
 * look that failed is not on the rig, and leaving it selected would put the
 * bar, the rig and the selection into three different states: the bar showing
 * the look that is lit, the selection holding one that never ran, and the next
 * Ctrl+Enter jumping somewhere the operator did not ask to go.
 *
 * Silent because this is an undo: notifying would ask the host to run again,
 * which is what just failed.
 */
export function restoreCue(name: string | null): void {
  _selected = name;
}

/** Forget everything. Tests, and nothing else. */
export function resetCues(): void {
  _names = [];
  _selected = null;
  _driven = false;
  _listeners.clear();
}
