/**
 * Choosing which look is live, without typing.
 *
 * A performance file holds the whole show, and the looks in it are functions
 * the operator wrote: verse, chorus, breakdown. Calling a different one meant
 * editing the call line and pressing Ctrl+Enter — which works, and is not
 * something you want to be doing with one hand while the other is on a fader.
 *
 * The obstacle was never storage. It is that a control cannot choose a look.
 * slider() and midi() are read at QUERY time, inside a pattern, sixty times a
 * second; which function runs is decided at EVAL time, once, and by then the
 * channels are already registered. A fader can ride a level inside the live
 * look and can never select the look itself.
 *
 * So this does not try to make selection a query-time value. It makes it a
 * reason to evaluate again. Evaluating is already atomic and seamless — the
 * staged scene replaces the live one at a tick boundary, so nothing blinks —
 * which means "run the file again with a different look selected" is a clean
 * whole-rig swap and needs no new machinery on the wire at all.
 *
 * The selection outlives a run the way a slider's position does. Re-running
 * the file does not reset which look is up, which is what makes it safe to
 * edit the document during a show.
 */

/** The names the running scene offered, in the order it offered them. */
let _names: string[] = [];

/**
 * The name the operator picked, or null for "whatever comes first".
 *
 * Deliberately not cleared between runs. It is a position, like a fader's, and
 * a scene that re-registers the same names should come back up on the same
 * look. A name that is no longer offered is handled at read time rather than
 * by clearing here, so renaming a look and then renaming it back does not lose
 * the selection in between.
 */
let _selected: string | null = null;

const _listeners = new Set<(name: string, previous: string | null) => void>();

/**
 * Tell the host that the selection changed and the scene should run again.
 *
 * The re-run belongs to whoever owns the document, which is the UI; the engine
 * has no idea what the source text is. So this is an announcement, not a call.
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
 * Falling back rather than going dark matters. Rename the selected look, or
 * run a different file, and the selection points at something that is not
 * there; coming up on the first look is the behaviour that keeps a rig lit.
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
export function registerCues(names: readonly string[]): void {
  _names = [...names];
}

/**
 * Pick a look by name. Unknown names are ignored.
 *
 * Ignored rather than thrown: the callers are a click, a key and a MIDI
 * message, none of which is a place an operator can see an exception, and a
 * stale button pointing at a look that has been renamed should do nothing
 * rather than interrupt a show.
 */
export function selectCue(name: string): void {
  if (!_names.includes(name)) return;
  // The EFFECTIVE selection, not the stored one: with nothing picked yet the
  // first look is the one that is lit, and pressing its button should do
  // nothing rather than re-run the file. It is also what the host needs to put
  // back if the look it is about to ask for fails to run.
  const previous = getSelectedCue();
  if (previous === name) return;
  _selected = name;
  for (const fn of _listeners) fn(name, previous);
}

/**
 * Pick a look by position, 1-based.
 *
 * The 1-based count is the one on the buttons: cue 1 is the first look, the
 * way it is on every desk and on the number row of a keyboard.
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
 * bar, the rig and the selection into three different states — the bar showing
 * the look that is actually lit, the selection holding one that never ran, and
 * the next Ctrl+Enter jumping somewhere the operator did not ask to go.
 *
 * Silent because this is an undo, not a choice: announcing would ask the host
 * to run again, which is what just failed.
 */
export function restoreCue(name: string | null): void {
  _selected = name;
}

/** Forget everything. Tests, and nothing else. */
export function resetCues(): void {
  _names = [];
  _selected = null;
  _listeners.clear();
}
