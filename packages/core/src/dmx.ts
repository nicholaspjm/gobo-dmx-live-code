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
  if (typeof v === 'function') return ' Signals need calling: sine() rather than sine.';
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
  if (!_universes.has(n)) _universes.set(n, new Uint8Array(512));
  return _universes.get(n)!;
}

function key(universe: number, channel: number): string {
  return `${universe}:${channel}`;
}

// ─── Public DMX API ──────────────────────────────────────────────────────────

/**
 * Set a channel on universe 1. channel is 1-indexed (1-512). Omit the value for
 * full.
 *
 * Resolves the value here rather than leaving it to uni(), so a rejected value
 * is reported against the call the operator actually wrote.
 */
export function ch(channel: number, ...args: [PatternOrValue?]): void {
  uni(1, channel, channelValue(args, `ch(${channel})`));
}

/** Set a channel on a specific universe. Omit the value for full. */
export function uni(universe: number, channel: number, ...args: [PatternOrValue?]): void {
  const value = channelValue(args, `uni(${universe}, ${channel})`);
  const target = _staging ?? _defs;
  target.set(key(universe, channel), { universe, channel, value });
}

/** Alias for ch(): set a dimmer channel. Omit the value for full. */
export function dim(channel: number, ...args: [PatternOrValue?]): void {
  uni(1, channel, channelValue(args, `dim(${channel})`));
}

/**
 * Set RGB channels starting at startChannel (channels startChannel, +1, +2).
 * Omit all three for full white.
 */
export function rgb(startChannel: number, ...args: [PatternOrValue?, PatternOrValue?, PatternOrValue?]): void {
  const [r, g, b] = channelValues(args, ['r', 'g', 'b'], 'rgb');
  ch(startChannel, r);
  ch(startChannel + 1, g);
  ch(startChannel + 2, b);
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
export function clearDefs(): void {
  _defs.clear();
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
            const v = haps[i].value;
            if (typeof v === 'number' && v > floatVal) floatVal = v;
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
 * @deprecated Use `getPrimaryUniverseSnapshot()` instead. Kept for one release
 * in case external scripts still reference the old name; it now reads the
 * primary universe (0), not specifically universe 1.
 */
export function getUniverse1Snapshot(): number[] {
  return getPrimaryUniverseSnapshot();
}
