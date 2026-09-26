/**
 * DMX state manager.
 *
 * Holds per-universe channel buffers (512 channels, 0-indexed internally).
 * DMX functions accept a plain number OR any strudel-like Pattern object
 * (anything with queryArc(begin, end) → Array<{value: unknown}>).
 *
 * Number values:
 *   - 0 ≤ v ≤ 1   → treated as float, multiplied to 0-255
 *   - 1 < v ≤ 255 → treated as raw DMX integer
 *
 * Pattern values are queried at each tick; their value is expected to be 0-1.
 *
 * Channel definitions are swapped in transactionally (see the staged scene swap
 * section below), so a scene that fails to evaluate is not applied at all.
 *
 * That transaction covers evaluation only. Patterns run user code again on every
 * tick, so a scene that evaluated without throwing can still throw at query
 * time. tick()
 * contains those throws per channel rather than extending the transaction over
 * them; see the query-failure section below.
 */

import { stringPattern } from './string-patterns.js';

export interface PatternLike {
  queryArc(begin: number, end: number): Array<{ value: unknown }>;
}

export type PatternOrValue = number | PatternLike;

function isPattern(v: unknown): v is PatternLike {
  return typeof (v as PatternLike)?.queryArc === 'function';
}

// ─── Value arguments ─────────────────────────────────────────────────────────
//
// Every channel write in the whole API funnels through channelValue(), so the
// rules about what a value may be are written once.
//
// Two things used to reach the buffer as a silent 0:
//
//   wash.red()      an omitted value. Naming a channel and no level reads as
//                   "red, on", so it now means full.
//   wash.red('1')   a value of the wrong type. A quoted number, a bare `sine`
//                   that was never called, null, NaN: all stored fine and read
//                   as 0 on every tick, so the scene ran with a green status
//                   bar and the light off. These now throw, which puts the
//                   channel in the editor's error banner instead.
//
// Numbers are left alone beyond the finite check. Out-of-range constants still
// clamp at the buffer, because patterns routinely swing outside 0-1 (range(),
// add()) and clamping is the useful behaviour there.

/** Describe a rejected value in the terms the operator wrote it in. */
function describeValue(v: unknown): string {
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  if (Array.isArray(v)) return `an array (length ${v.length})`;
  const t = typeof v;
  if (t === 'string') return `a string (${JSON.stringify(v)})`;
  if (t === 'function') return 'a function';
  if (t === 'object') return 'an object';
  // NaN and ±Infinity are the only numbers that get here, and naming them is
  // the whole message: they usually come out of a division that had no
  // business dividing.
  if (t === 'number') return String(v);
  return `a ${t}`;
}

/** Suggest the fix for the mistakes that actually get made. */
function valueHint(v: unknown): string {
  if (typeof v === 'string') {
    return Number.isFinite(Number(v))
      ? ` Drop the quotes: ${Number(v)}, or wrap it in a pattern: mini(${JSON.stringify(v)}).`
      : ` Mini-notation goes inside mini(${JSON.stringify(v)}).`;
  }
  if (typeof v === 'function') return ' That is a function, not a pattern: call it, as in flash(), to get the pattern it makes.';
  if (typeof v === 'number') return ' Check the arithmetic that produced it.';
  if (v === undefined) return ' Omit the argument entirely for full.';
  return '';
}

/**
 * Resolve the value argument of a channel-setting call.
 *
 * Takes the argument list rather than the value, because an omitted argument
 * and an explicit `undefined` mean different things: `red()` is full, and
 * `red(undefined)` is a mistake somewhere upstream worth reporting.
 *
 * @param args  the caller's value arguments, usually a rest parameter
 * @param what  how to name the call in an error, e.g. `wash.red`
 */
export function channelValue(args: readonly unknown[], what: string): PatternOrValue {
  if (args.length === 0) return 1;
  const v = args[0];
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) {
      throw new Error(`${what}: level must be a finite number, got ${describeValue(v)}.${valueHint(v)}`);
    }
    return v;
  }
  // Reading .queryArc runs user code: it can be a getter, and a hostile one
  // throws. A value that cannot even be probed is not a pattern, and the
  // rejection below says so in the same terms as every other bad value rather
  // than surfacing whatever the getter felt like throwing.
  let looksLikePattern = false;
  try {
    looksLikePattern = isPattern(v);
  } catch {
    // Not a pattern.
  }
  // The predicate's narrowing does not survive the assignment above, hence
  // the cast; the guard is what establishes it.
  if (looksLikePattern) return v as PatternLike;
  // A string is mini-notation, as in strudel. See string-patterns.ts.
  if (typeof v === 'string') {
    const parsed = stringPattern(v, what);
    if (parsed !== null) return parsed;
  }

  throw new Error(
    `${what}: expected a level (0-1, or 1-255 for a raw DMX value) or a pattern, got ${describeValue(v)}.${valueHint(v)}`,
  );
}

/**
 * Resolve a group of value arguments that only make sense together, such as the
 * three of rgb() or the r/g/b of a strip fill.
 *
 * All of them or none of them. `fill()` is full white, `fill(1, 0, 0)` is red,
 * and `fill(1, 0)` is a half-written line rather than a colour, so it throws
 * instead of guessing at the missing channel.
 *
 * @param names  the parameter names in order, for the error message
 */
export function channelValues(
  args: readonly unknown[],
  names: readonly string[],
  what: string,
): PatternOrValue[] {
  if (args.length === 0) return names.map(() => 1);
  if (args.length < names.length) {
    throw new Error(
      `${what}: needs all ${names.length} of ${names.join(', ')} (got ${args.length}), or none of them for full.`,
    );
  }
  return names.map((name, i) => channelValue([args[i]], `${what} ${name}`));
}

/** A DMX universe is 512 channels. Named because three checks now cite it. */
const CHANNELS_PER_UNIVERSE = 512;

// universe number (1-based) → 512-byte buffer
const _universes = new Map<number, Uint8Array>();

// Registered channel definitions: "uni:ch" → def
interface ChannelDef {
  universe: number;
  channel: number;
  value: PatternOrValue;
}

// The scene the rig is currently running. tick() resolves from this map and
// nothing else.
let _defs = new Map<string, ChannelDef>();

// Scratch map for a scene that is still being built. Non-null only between
// beginStaging() and commitStaging()/abortStaging(); while it is set, every
// uni() write lands here instead of in the live scene.
let _staging: Map<string, ChannelDef> | null = null;

function getUniverse(n: number): Uint8Array {
  if (!_universes.has(n)) _universes.set(n, new Uint8Array(CHANNELS_PER_UNIVERSE));
  return _universes.get(n)!;
}

function key(universe: number, channel: number): string {
  return `${universe}:${channel}`;
}

/**
 * The universe a call lands on when it does not name one.
 *
 * Zero, and the same for every family. It used to be zero for fixture(),
 * rgbStrip() and friends and ONE for ch(), dim() and rgb() — so a scene that
 * patched a fixture and also wrote a raw channel drove two universes without
 * ever naming one. The visualizer follows the lowest, and a USB interface
 * carries a single universe, so half of such a scene could silently never
 * leave the machine.
 *
 * Zero rather than one because the fixture family is the one nearly every
 * scene uses, because it is what the visualizer and the USB path already
 * default to, and because the connector already knows how to handle it: E1.31
 * reserves universe 0, so the bridge remaps scene universe 0 onto the sACN
 * base. That remap was written for this split and stays correct.
 */
const DEFAULT_UNIVERSE = 0;

// ─── Public DMX API ──────────────────────────────────────────────────────────

/**
 * Set a channel on the default universe. channel is 1-indexed (1-512). Omit the value for
 * full.
 *
 * Resolves the value here rather than leaving it to uni(), so a rejected value
 * is reported against the call the operator actually wrote.
 */
export function ch(channel: number, ...args: [PatternOrValue?]): void {
  const value = channelValue(args, `ch(${channel})`);
  assertChannel(channel, `ch(${channel})`);
  uni(DEFAULT_UNIVERSE, channel, value);
}

/**
 * Refuse an address that cannot exist, naming the call that wrote it.
 *
 * A DMX universe is 512 channels, 1-indexed. Writing outside that used to be
 * accepted and then quietly dropped when the frame was built, so `ch(5100, 1)`
 * — a typo for 510 — reported a running scene and lit nothing. The fixture
 * family has always refused an address it cannot fit; the channel family took
 * anything. Same rule for both now.
 *
 * Checked where the operator names the channel rather than at the buffer, so
 * the message can say which call was wrong instead of which byte was.
 */
function assertChannel(channel: number, label: string): void {
  if (!Number.isInteger(channel)) {
    throw new Error(`${label}: a channel is a whole number, and this one is ${String(channel)}.`);
  }
  if (channel < 1 || channel > CHANNELS_PER_UNIVERSE) {
    // The advice differs by which end was missed: there is nowhere to put a
    // channel below 1, and another universe is the answer only above 512.
    const remedy = channel > CHANNELS_PER_UNIVERSE
      ? 'Use another universe for anything past that.'
      : 'Channels count from 1, not from 0.';
    throw new Error(
      `${label}: a universe has channels 1 to ${CHANNELS_PER_UNIVERSE}, and this one is ${channel}. ${remedy}`,
    );
  }
}

/** The same for a universe, which has no upper bound but must be a number. */
function assertUniverse(universe: number, label: string): void {
  if (!Number.isInteger(universe) || universe < 0) {
    throw new Error(`${label}: a universe is a whole number from 0 up, and this one is ${String(universe)}.`);
  }
}

/** Set a channel on a specific universe. Omit the value for full. */
export function uni(universe: number, channel: number, ...args: [PatternOrValue?]): void {
  const value = channelValue(args, `uni(${universe}, ${channel})`);
  assertUniverse(universe, `uni(${universe}, ${channel})`);
  assertChannel(channel, `uni(${universe}, ${channel})`);
  const target = _capture ?? _staging ?? _defs;
  const k = key(universe, channel);
  // Last write wins, and always has. Noted on the way past so the run can say
  // so afterwards: see noteOverwrite.
  const held = target.get(k);
  if (held !== undefined && !Object.is(held.value, value)) noteOverwrite(universe, channel);
  target.set(k, { universe, channel, value });
}

// ─── Channels set more than once ─────────────────────────────────────────────
//
// A scene is imperative, so two calls to one channel are an assignment
// followed by another assignment: the second replaces the first and nothing
// is mixed. That is the intended behaviour and not something to change — a
// lighting desk would take the highest of the two, but a desk is not running
// somebody's JavaScript, where a silent max would be far stranger than a
// silent overwrite.
//
// What it should not be is invisible. The shape that makes it bite is two
// looks over one rig — verse(); chorus() — where the channels they share come
// out as whatever the later one said and the earlier look is simply gone, with
// a green status bar over the top. So the run counts them and says so.
//
// Only a write that changes the value counts. Setting a channel to what it
// already holds is not something anyone needs told about.

const _overwritten = new Map<string, { universe: number; channel: number; times: number }>();

function noteOverwrite(universe: number, channel: number): void {
  const k = key(universe, channel);
  const held = _overwritten.get(k);
  if (held) held.times++;
  else _overwritten.set(k, { universe, channel, times: 1 });
}

/** Channels this run set more than once, in the order they first collided. */
export function getOverwrittenChannels(): ReadonlyArray<{ universe: number; channel: number; times: number }> {
  return [..._overwritten.values()];
}

/**
 * The patched light covering a channel, and where it starts.
 *
 * The label alone does not identify a light: it is the constructor as written,
 * so two strips are both "rgbStrip()". The address is what tells them apart,
 * and it is also the thing the operator can look up on the rig.
 */
export function patchAt(universe: number, channel: number): { label: string; start: number } | null {
  for (const held of _patched) {
    if (held.universe === universe && channel >= held.start && channel <= held.end) {
      return { label: held.label, start: held.start };
    }
  }
  return null;
}

/**
 * Whether the run in progress has defined this channel.
 *
 * Reads the staging map while a transaction is open, so it answers about the
 * scene being built rather than the one still on the wire. Asking the defs is
 * how anything can tell what a run actually drove without hooking every path
 * that writes: a strip's pixels, a group's members and a plain `ch()` all end
 * up here, and only here.
 */
export function isChannelDriven(universe: number, channel: number): boolean {
  return (_capture ?? _staging ?? _defs).has(key(universe, channel));
}

/** Alias for ch(): set a dimmer channel. Omit the value for full. */
export function dim(channel: number, ...args: [PatternOrValue?]): void {
  const value = channelValue(args, `dim(${channel})`);
  assertChannel(channel, `dim(${channel})`);
  uni(DEFAULT_UNIVERSE, channel, value);
}

/**
 * Set RGB channels starting at startChannel (channels startChannel, +1, +2).
 * Omit all three for full white.
 */
export function rgb(startChannel: number, ...args: [PatternOrValue?, PatternOrValue?, PatternOrValue?]): void {
  const [r, g, b] = channelValues(args, ['r', 'g', 'b'], 'rgb');
  assertChannel(startChannel, `rgb(${startChannel})`);
  // The whole span, not just the address written. It used to take the start,
  // write what fitted and drop the rest, so rgb(511, …) lit red and green and
  // silently swallowed blue — a colour that is not the colour asked for, with
  // nothing said. fixture() has always refused the same overflow; this now
  // matches it.
  const last = startChannel + 2;
  if (last > CHANNELS_PER_UNIVERSE) {
    throw new Error(
      `rgb(${startChannel}): three channels from ${startChannel} would run to ${last}, `
      + `which exceeds ${CHANNELS_PER_UNIVERSE} by ${last - CHANNELS_PER_UNIVERSE}. `
      + 'Move it to a lower address, or drive the components with uni() on another universe.',
    );
  }
  ch(startChannel, r);
  ch(startChannel + 1, g);
  ch(startChannel + 2, b);
}

// ─── Capturing one look ──────────────────────────────────────────────────────
//
// A look is a function that writes channels, so the only way to hold one as a
// value is to run it with its writes going somewhere of its own. That is what
// this is for: cue() with a selector runs every look into its own map, then
// writes one value per channel that reads the selector at query time and
// resolves whichever look it names.
//
// Strictly inside an evaluation, and strictly above staging: what finally
// reaches the staging map is ordinary channel values, so the commit, the
// rollback, hush() and the panic keys are all untouched by this existing. The
// engine never sees a partial picture — the merge happens before anything is
// staged.

let _capture: Map<string, ChannelDef> | null = null;

/** Send subsequent uni() writes to a map of their own. */
export function beginCapture(): void {
  _capture = new Map();
}

/** Stop capturing and hand back what was written. */
export function endCapture(): Map<string, ChannelDef> {
  const held = _capture ?? new Map<string, ChannelDef>();
  _capture = null;
  return held;
}

/**
 * Abandon a capture without returning it.
 *
 * For the failure path: a look that throws halfway through must not leave the
 * redirect in place, or every write for the rest of the run would land in a
 * map nobody reads and the scene would commit empty.
 */
export function abortCapture(): void {
  _capture = null;
}

/** The channel key for a def, so callers can merge maps without rebuilding it. */
export function channelKey(universe: number, channel: number): string {
  return key(universe, channel);
}

// ─── Staged scene swap ───────────────────────────────────────────────────────
//
// User code registers channels imperatively as it runs, so the only way to make
// a scene swap all-or-nothing is to buffer those writes somewhere the renderer
// cannot see and publish them in a single step.
//
// eval.ts brackets the user-code call with beginStaging() + commitStaging(), and
// calls abortStaging() if the code throws. The rig keeps running the previous
// scene up to the commit; a scene that throws halfway through is discarded
// rather than left live as a fragment.
//
// The swap is a reference assignment: _defs holds small plain objects and tick()
// is a pure re-resolve, so there is nothing to copy or reconcile.

/** Buffer subsequent uni() writes into a scratch scene instead of the live one. */
export function beginStaging(): void {
  _staging = new Map();
  // Collisions belong to the run being built, not to the one before it.
  _overwritten.clear();
}

/** Publish the staged scene as the live one. No-op when nothing is staged. */
export function commitStaging(): void {
  if (_staging === null) return;
  _defs = _staging;
  _staging = null;
  // The defs that were failing are gone, so their failures are stale. A re-eval
  // is how the operator clears a query error off the status bar.
  resetQueryFailures();
}

/** Discard the staged scene, leaving the live one unchanged. */
export function abortStaging(): void {
  _staging = null;
}

// ─── Query failures ──────────────────────────────────────────────────────────
//
// queryArc() runs user code at TICK time, not at eval time: a register() body, a
// custom chain method or a getter on a hand-rolled pattern object is only
// invoked when the frame asks for a value. A scene that evaluated without
// throwing (status bar green, staging committed) can still throw 60 times a
// second.
//
// Left uncaught, that throw escapes tick() after the buffers have been zeroed
// and only partly rewritten, and before the UI's tick handler sends anything, so
// no frame reaches the wire and the rig latches its last look until something
// re-evaluates. Guarding each def instead costs one dark channel, and the
// failure is reported.
//
// Failures are accumulated here rather than logged from the loop, so a def
// throwing every frame costs one console line and one status update instead of
// sixty a second.

/** A channel definition whose pattern threw while being queried. */
export interface QueryFailure {
  universe: number;
  /** 1-indexed DMX channel, as the scene addressed it. */
  channel: number;
  /**
   * First error message seen for this channel. Always a string: whatever the
   * scene threw is coerced on the way in, so consumers can treat it as text.
   */
  message: string;
  /** How many ticks this channel has thrown on since it was first seen. */
  ticks: number;
}

// Keyed like _defs ("uni:ch"), so a def that throws every frame is recorded
// once and only its tick count moves.
const _queryFailures = new Map<string, QueryFailure>();

// Bumped whenever the set of failing channels changes (a new one appears, or
// the whole set is reset). Lets the UI detect "something changed" with a
// single integer compare per frame instead of diffing the map.
let _queryFailureGen = 0;

// Cap on console lines so a broken pattern shared across a 170-pixel strip
// doesn't dump 510 lines in one frame. The status bar carries the full count.
const QUERY_FAILURE_LOG_LIMIT = 8;
let _queryFailuresLogged = 0;

/** Channels whose pattern threw since the live scene was last replaced. */
export function getQueryFailures(): QueryFailure[] {
  return Array.from(_queryFailures.values());
}

/**
 * Change counter for the failure set. Only the change is meaningful; the number
 * itself carries no information beyond "not what you last saw".
 */
export function getQueryFailureGeneration(): number {
  return _queryFailureGen;
}

/**
 * Forget every recorded failure. Called wherever the live scene is replaced
 * or dropped, because the defs that were failing no longer exist.
 */
function resetQueryFailures(): void {
  if (_queryFailures.size === 0) return;
  _queryFailures.clear();
  _queryFailuresLogged = 0;
  _queryFailureGen++;
}

/**
 * Record a throwing def. Called from the tick loop, so the repeat path stays
 * cheap: one key string, one map lookup, then a counter bump on an object that
 * already exists. The key string is the only allocation, and only throwing
 * channels reach it; a healthy scene never calls this function.
 *
 * Never throws. It runs inside tick()'s per-def catch, where a throw would
 * escape the loop and cost the whole frame, which is the hole this function
 * exists to close, so the whole body runs under a guard.
 */
/**
 * A word in a pattern where a level belongs: mini('1 x 1'), or a colour name
 * in a pattern handed to a dimmer. Strudel keeps it as the string it was, and
 * a string is no level, so that step went dark with nothing said. It is
 * reported the way a throwing pattern is, once per channel, on the status bar.
 *
 * The existing entry is checked first so the message, and the Error, are made
 * once rather than on every tick the word comes round.
 */
function recordWordHap(def: ChannelDef, word: string): void {
  const existing = _queryFailures.get(key(def.universe, def.channel));
  if (existing !== undefined) {
    existing.ticks++;
    return;
  }
  const shown = word.length > 24 ? `${word.slice(0, 24)}…` : word;
  recordQueryFailure(def, new Error(
    `"${shown}" in a pattern is not a level, so that step is dark. A level is a number from 0 to 1, `
    + 'a rest is - or ~, and a colour name goes to .color().',
  ));
}

function recordQueryFailure(def: ChannelDef, err: unknown): void {
  try {
    const k = key(def.universe, def.channel);
    const existing = _queryFailures.get(k);
    if (existing !== undefined) {
      existing.ticks++;
      return;
    }

    // Reading the message is itself user-controlled: `message` can be a getter,
    // and a thrown non-Error can have a toString() that throws.
    //
    // String() rather than a template literal or `+`, because it is the one
    // coercion that survives a Symbol. An Error whose .message is a Symbol used
    // to be stored raw and then interpolated into the console line below, which
    // throws TypeError; the UI, which trusts this field to be a string, would
    // have thrown on it too. Coercing here keeps `message` a string for every
    // consumer. The inner catch keeps the entry with a fallback message rather
    // than losing the record to one bad message.
    let message = 'unknown error';
    try {
      message = String(err instanceof Error ? err.message : err);
    } catch {
      // Keep the fallback.
    }

    _queryFailures.set(k, { universe: def.universe, channel: def.channel, message, ticks: 1 });
    _queryFailureGen++;

    if (_queryFailuresLogged < QUERY_FAILURE_LOG_LIMIT) {
      _queryFailuresLogged++;
      console.error(
        `[gobo] pattern query threw on universe ${def.universe} channel ${def.channel}; ` +
        `that channel reads 0 on every tick it throws: ${message}`,
      );
      if (_queryFailuresLogged === QUERY_FAILURE_LOG_LIMIT) {
        console.error('[gobo] further pattern query failures suppressed; see the status bar for the total');
      }
    }
  } catch {
    // Bookkeeping must never become the failure it is reporting. Scene code
    // shares this realm, so even the console can be replaced with something
    // that throws. Losing one status-bar entry is cheaper than losing the frame
    // the entry exists to protect.
  }
}

/**
 * The level a hap carries, or null if it carries none.
 *
 * Most operators yield a bare number. Some yield one of strudel's control
 * objects instead, because they were built for sound and carry its parameters
 * alongside the value:
 *
 *   echo(3, 0.125, 0.5)  ->  { value: 1, gain: 1 }, { value: 1, gain: 0.5 }, …
 *   hurry(2)             ->  { value: 1, speed: 2 }
 *
 * Reading only bare numbers meant every one of those landed as 0: the channel
 * went dark, the scene ran clean, and nothing said why. Unwrapping `value`
 * makes them work. `gain` is folded in because that is what it means, an
 * amplitude, so echo's repeats come out decaying rather than all at full.
 * Parameters that describe sound rather than level (speed, pan, room) are
 * ignored, which is the right reading for a lamp.
 */
export function levelOf(v: unknown): number | null {
  if (typeof v === 'number') return v;
  if (v === null || typeof v !== 'object') return null;
  const inner = (v as { value?: unknown }).value;
  if (typeof inner !== 'number') return null;
  // velocity folds in the same way: strudel users reach for .velocity() to
  // accent a step, and it is a level by another name.
  const { gain, velocity } = v as { gain?: unknown; velocity?: unknown };
  let level = inner;
  if (typeof gain === 'number') level *= gain;
  if (typeof velocity === 'number') level *= velocity;
  return level;
}

// ─── Which bit of the source is live ─────────────────────────────────────────

/**
 * The character ranges of the mini-notation tokens driving light right now.
 *
 * @strudel/mini can tag every leaf of a pattern with where it came from in the
 * document — that is what `m(str, offset)` is for, as against `mini(str)`,
 * which throws the offsets away. When a scene is compiled with the tagging
 * version, each hap carries the range of the token that produced it, and this
 * collects the ones that are actually reaching a channel on this tick.
 *
 * Flat pairs rather than objects: this fills sixty times a second and the
 * editor reads it just as often, so it is one array that is emptied and
 * refilled rather than a fresh allocation per frame.
 *
 * Off unless the editor asks for it. A headless run, a test, or a build with
 * no decorations has no use for this and should not pay for it.
 */
let _collectLocations = false;
const _activeLocations: number[] = [];

export function setLocationCollection(on: boolean): void {
  _collectLocations = on;
  if (!on) _activeLocations.length = 0;
}

/** Flat [start, end, start, end, …] for the tokens live on the last tick. */
export function getActiveLocations(): readonly number[] {
  return _activeLocations;
}

/** Shape of what withLoc() hangs off a hap. Read defensively: it comes from
 *  a dependency and only exists on patterns built the tagging way. */
interface LocatedHap {
  context?: { locations?: Array<{ start?: number; end?: number }> };
}

function collectLocations(hap: unknown): void {
  const locs = (hap as LocatedHap).context?.locations;
  if (!locs) return;
  for (let i = 0; i < locs.length; i++) {
    const s = locs[i].start;
    const e = locs[i].end;
    if (typeof s === 'number' && typeof e === 'number') _activeLocations.push(s, e);
  }
}

// ─── Internal ─────────────────────────────────────────────────────────────────

/**
 * Drop every channel definition, so the next tick() drives nothing.
 *
 * Deliberately does NOT zero the universe buffers. tick() zeroes and rewrites
 * every buffer from scratch each frame, so clearing defs is enough to go dark
 * while the scheduler runs. Wiping buffers here would mean any caller that
 * clears defs speculatively (as eval once did) blacks out real hardware before
 * it knows what replaces the scene. Callers that need the outputs dark *now*,
 * with no further tick coming (the stop / blackout path), zero the buffers
 * themselves via getAllUniverses().
 */
/**
 * Drop everything the scene has driven so far, leaving it dark.
 *
 * Clears the staged map during an eval and the live one outside it. Using
 * clearDefs() would empty the running scene while the staged one carried on to
 * be committed over the top, which is the opposite of stopping.
 */
export function hushDefs(): void {
  if (_staging !== null) _staging.clear();
  else _defs.clear();
  _patched.length = 0;
  resetQueryFailures();
}

/** What each patch call claimed, so the next one can be checked against it. */
interface PatchClaim {
  universe: number;
  start: number;
  end: number;
  label: string;
}
const _patched: PatchClaim[] = [];

/**
 * Claim a run of channels for one patched light, or say who already holds them.
 *
 * Two lights at overlapping addresses used to patch quietly and then fight over
 * the channels they shared, every frame, with the second one's dimmer sitting
 * on the first one's green. The rig then does something that reads as a broken
 * fixture rather than as a mistyped number, which is the expensive way to find
 * out. Overlapping patches are the commonest addressing error there is, and the
 * other one is already refused: a fixture that would run past channel 512
 * throws and names the overrun.
 *
 * Lives here rather than in fixtures.ts because this is channel ownership, and
 * because clearDefs() is the signal that a new scene is starting.
 */
export function claimChannels(universe: number, start: number, count: number, label: string): void {
  const end = start + count - 1;
  for (const held of _patched) {
    if (held.universe !== universe) continue;
    if (start > held.end || end < held.start) continue;
    const from = Math.max(start, held.start);
    const to = Math.min(end, held.end);
    const span = from === to ? `channel ${from}` : `channels ${from} to ${to}`;
    throw new Error(
      `${label} at ${start} overlaps ${held.label} at ${held.start}, which already has ${span} `
      + `on universe ${universe}. Two lights on one channel fight over it every frame. `
      + `Move this one to ${held.end + 1} or later, or patch it on another universe.`,
    );
  }
  _patched.push({ universe, start, end, label });
}

/**
 * Forget every patch claim.
 *
 * Separate from clearDefs() because the two resets are not the same event. A
 * scene run does not go through clearDefs(): eval.ts clears the sim, the
 * screens, the controls, the pickers and the fixture activity, and leaves the
 * channel defs to be replaced by the run itself. Hanging the claims off
 * clearDefs() alone meant they survived from one run to the next, so the second
 * ctrl+enter on any scene with a fixture in it reported that fixture
 * overlapping itself.
 */
export function clearPatchClaims(): void {
  _patched.length = 0;
}

export function clearDefs(): void {
  _defs.clear();
  clearPatchClaims();
  resetQueryFailures();
}

/**
 * Called by the scheduler on each tick to resolve patterns → channel values.
 *
 * Never throws for defs registered through the public API, where universe and
 * channel are numbers. Every step that runs user-controlled code is guarded: the
 * queryArc lookup, the query itself, the haps it returns, and recording the
 * failure. (Addresses are read outside those guards, so a caller that ignores
 * the types and passes an object with a throwing valueOf as a channel is on its
 * own.)
 *
 * Each def is resolved under its own guard, so one pattern blowing up costs that
 * one channel, which reads 0. The rest of the frame still resolves and the
 * caller still ships it. If the frame never shipped, the rig would hold its last
 * look with no indication anything is wrong.
 */
export function tick(cyclePos: number): void {
  // Zero all universe buffers
  for (const buf of _universes.values()) buf.fill(0);
  // Which tokens are live is a fact about this tick and no other.
  if (_collectLocations) _activeLocations.length = 0;

  for (const def of _defs.values()) {
    const chIdx = def.channel - 1; // 1-indexed → 0-indexed
    if (chIdx < 0 || chIdx >= 512) continue;

    // Default is dark. Every path that cannot produce a real value (no haps, a
    // non-numeric hap, a throw) leaves this untouched.
    let floatVal = 0;
    const value = def.value;

    if (typeof value === 'number') {
      floatVal = value > 1 ? value / 255 : value;
    } else {
      // Everything about a non-number value is user-controlled: the queryArc
      // lookup can be a throwing getter, the call runs scene code, and the
      // haps it returns are whatever that code built. One guard per def covers
      // the lot. A bare try/catch and a call to a module-level function, so no
      // closure is created and nothing is allocated on the happy path; this
      // runs for every driven channel 60 times a second.
      try {
        if (isPattern(value)) {
          // Query a thin arc so we get the instantaneous value
          const haps = value.queryArc(cyclePos, cyclePos + 0.0001);
          // Highest takes precedence, the merge every lighting desk uses. A
          // channel can have several values at one instant: stack(), a comma
          // inside mini(), superimpose(), off(). Reading haps[0] and dropping
          // the rest meant every layer after the first did nothing, so
          // mini('1 1 1 1, 0.5 0.5 0.5 0.5') put only the first layer on the
          // wire. Brightest-wins is also what makes layering safe to build up:
          // adding a layer can raise a channel but never darken one.
          for (let i = 0; i < haps.length; i++) {
            const raw = haps[i].value;
            const v = levelOf(raw);
            if (typeof raw === 'string') recordWordHap(def, raw);
            if (v !== null && v > floatVal) floatVal = v;
            // Only a hap that is actually lighting something. A token
            // sitting at zero is in the pattern but is not what anyone
            // means by the live one, and outlining it would light the whole
            // string up at once.
            if (_collectLocations && v !== null && v > 0) collectLocations(haps[i]);
          }
        }
      } catch (err) {
        floatVal = 0;
        recordQueryFailure(def, err);
      }
    }

    const buf = getUniverse(def.universe);
    buf[chIdx] = Math.round(Math.max(0, Math.min(1, floatVal)) * 255);
  }
}

export function getUniverseBuffer(universe: number): Uint8Array {
  return getUniverse(universe);
}

export function getAllUniverses(): Map<number, Uint8Array> {
  return _universes;
}

/**
 * Returns a snapshot of the primary (default) universe as a plain number array.
 * Used by the visualizer, fixture sim, and inline editor widgets.
 *
 * The primary universe is universe 0, the same one `fixture()` and `rgbStrip()`
 * write to when no universe argument is passed. This matches the Art-Net /
 * TouchDesigner convention where the first universe is numbered 0.
 */
export function getPrimaryUniverseSnapshot(): number[] {
  return Array.from(getUniverse(0));
}

/**
 * Universes the live scene actually drives, lowest first.
 *
 * Read from the channel definitions rather than the buffers, so a universe
 * whose channels all happen to be at zero this frame still counts: it is in
 * use, it is just dark. A viewer that followed the buffers would drop in and
 * out as the scene blacked out.
 */
export function getActiveUniverses(): number[] {
  const seen = new Set<number>();
  for (const def of _defs.values()) seen.add(def.universe);
  return [...seen].sort((a, b) => a - b);
}

/** A snapshot of any universe, as a plain array. */
export function getUniverseSnapshot(universe: number): number[] {
  return Array.from(getUniverse(universe));
}
