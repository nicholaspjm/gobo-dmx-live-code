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
 * Pattern values are queried at each tick; their value is expected to be 0–1.
 *
 * Channel definitions are swapped in transactionally — see the staged scene
 * swap section below — so a scene that fails to evaluate never reaches the
 * wire, whole or in part.
 *
 * That transaction covers evaluation only. Patterns run user code again on
 * every tick, so a scene that evaluated cleanly can still throw at query
 * time. tick() contains those throws per channel instead of extending the
 * transaction over them — see the query-failure section below.
 */

export interface PatternLike {
  queryArc(begin: number, end: number): Array<{ value: unknown }>;
}

export type PatternOrValue = number | PatternLike;

function isPattern(v: unknown): v is PatternLike {
  return typeof (v as PatternLike)?.queryArc === 'function';
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

/** Set a channel on universe 1. channel is 1-indexed (1–512). */
export function ch(channel: number, value: PatternOrValue): void {
  uni(1, channel, value);
}

/** Set a channel on a specific universe. */
export function uni(universe: number, channel: number, value: PatternOrValue): void {
  const target = _staging ?? _defs;
  target.set(key(universe, channel), { universe, channel, value });
}

/** Alias for ch() — set a dimmer channel. */
export function dim(channel: number, value: PatternOrValue): void {
  ch(channel, value);
}

/** Set RGB channels starting at startChannel (channels startChannel, +1, +2). */
export function rgb(
  startChannel: number,
  r: PatternOrValue,
  g: PatternOrValue,
  b: PatternOrValue,
): void {
  ch(startChannel, r);
  ch(startChannel + 1, g);
  ch(startChannel + 2, b);
}

// ─── Staged scene swap ───────────────────────────────────────────────────────
//
// A live-coding tool must never put a half-evaluated scene on the wire. User
// code registers channels imperatively as it runs, so the only way to make a
// scene swap all-or-nothing is to buffer those writes somewhere the renderer
// can't see and publish them in a single step.
//
// eval.ts brackets the user-code call with beginStaging() + commitStaging(),
// and calls abortStaging() if the code throws. The rig keeps running the
// previous scene right up to the commit; a scene that throws halfway through
// is discarded whole rather than left live as an arbitrary fragment.
//
// The swap is a reference assignment: _defs holds small plain objects and
// tick() is a pure re-resolve, so there is nothing to copy or reconcile.

/** Buffer subsequent uni() writes into a scratch scene instead of the live one. */
export function beginStaging(): void {
  _staging = new Map();
}

/** Publish the staged scene as the live one. No-op when nothing is staged. */
export function commitStaging(): void {
  if (_staging === null) return;
  _defs = _staging;
  _staging = null;
  // The defs that were failing are gone, so their failures are stale — a
  // re-eval is how the operator clears a query error off the status bar.
  resetQueryFailures();
}

/** Discard the staged scene, leaving the live one exactly as it was. */
export function abortStaging(): void {
  _staging = null;
}

// ─── Query failures ──────────────────────────────────────────────────────────
//
// queryArc() runs user code, and it runs it at TICK time, not at eval time —
// a register() body, a custom chain method or a getter on a hand-rolled
// pattern object is only invoked when the frame asks for a value. So a scene
// that evaluated cleanly (status bar green, staging committed) can still
// throw 60 times a second afterwards.
//
// Left uncaught, that throw escapes tick() after the buffers have been zeroed
// and only partly rewritten, and it escapes before the UI's tick handler gets
// to send anything — so no frame reaches the wire at all and the rig latches
// its last look until something else re-evaluates. Containing it per def is
// the difference between "one channel is dark" and "the whole rig is frozen
// and nobody is told".
//
// The failures are accumulated here rather than logged from the loop so that
// a def throwing every frame costs one console line and one status update,
// not sixty a second.

/** A channel definition whose pattern threw while being queried. */
export interface QueryFailure {
  universe: number;
  /** 1-indexed DMX channel, as the scene addressed it. */
  channel: number;
  /**
   * First error message seen for this channel. Always a string — whatever the
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
 * Change counter for the failure set. Only the value changing is meaningful —
 * the number itself carries no information beyond "not what you last saw".
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
 * already exists. The key string is the only allocation, and it is bounded to
 * channels that are actually throwing — a healthy scene never reaches this
 * function at all.
 *
 * Never throws. It runs from inside tick()'s per-def catch, where a throw would
 * escape the loop and cost the whole frame — the exact hole this function
 * exists to close — so the entire body runs under a guard.
 */
function recordQueryFailure(def: ChannelDef, err: unknown): void {
  try {
    const k = key(def.universe, def.channel);
    const existing = _queryFailures.get(k);
    if (existing !== undefined) {
      existing.ticks++;
      return;
    }

    // Reading the message is itself user-controlled — `message` can be a getter
    // and a thrown non-Error can have a toString() that throws.
    //
    // String() rather than a template literal or `+`: it is the one coercion
    // that survives a Symbol. An Error whose .message is a Symbol used to be
    // stored raw and then interpolated into the console line below, which
    // throws TypeError — and the UI, which trusts this field to be a string,
    // would have thrown on it too. Coercing here keeps `message` a string for
    // every consumer. The inner catch keeps the entry with a fallback message
    // rather than losing the whole record to one bad message.
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
        `[gobo] pattern query threw on universe ${def.universe} channel ${def.channel} — ` +
        `that channel reads 0 on every tick it throws: ${message}`,
      );
      if (_queryFailuresLogged === QUERY_FAILURE_LOG_LIMIT) {
        console.error('[gobo] further pattern query failures suppressed — see the status bar for the total');
      }
    }
  } catch {
    // Bookkeeping must never become the failure it is reporting. Scene code
    // shares this realm, so even the console can be replaced with something
    // that throws; losing one status-bar entry is far cheaper than losing the
    // frame that the entry exists to protect.
  }
}

// ─── Internal ─────────────────────────────────────────────────────────────────

/**
 * Drop every channel definition, so the next tick() drives nothing.
 *
 * Deliberately does NOT zero the universe buffers. tick() already zeroes and
 * rewrites every buffer from scratch each frame, so clearing defs is enough
 * to go dark while the scheduler runs — and wiping buffers here would mean
 * any caller that clears defs speculatively (as eval once did) blacks out
 * real hardware before it knows what replaces the scene. Callers that need
 * the outputs dark *now*, with no further tick coming — the stop / blackout
 * path — zero the buffers themselves via getAllUniverses().
 */
export function clearDefs(): void {
  _defs.clear();
  resetQueryFailures();
}

/**
 * Called by the scheduler on each tick to resolve patterns → channel values.
 *
 * Never throws for defs registered through the public API, where universe and
 * channel are numbers: every step that runs user-controlled code — the queryArc
 * lookup, the query itself, the haps it returns, and recording the failure — is
 * guarded. (Addresses are read outside those guards, so a caller that ignores
 * the types and passes an object with a throwing valueOf as a channel is on its
 * own.)
 *
 * Each def is resolved under its own guard, so one pattern blowing up costs
 * that one channel (it reads 0) and nothing else: the rest of the frame still
 * resolves and the caller still gets to ship it. A frame that never ships is
 * worse than a dark channel — the rig would hold its last look with no
 * indication anything is wrong.
 */
export function tick(cyclePos: number): void {
  // Zero all universe buffers
  for (const buf of _universes.values()) buf.fill(0);

  for (const def of _defs.values()) {
    const chIdx = def.channel - 1; // 1-indexed → 0-indexed
    if (chIdx < 0 || chIdx >= 512) continue;

    // Default is dark: every path that can't produce a real value — no haps,
    // a non-numeric hap, a throw — leaves this untouched.
    let floatVal = 0;
    const value = def.value;

    if (typeof value === 'number') {
      floatVal = value > 1 ? value / 255 : value;
    } else {
      // Everything about a non-number value is user-controlled: the queryArc
      // lookup can be a throwing getter, the call runs scene code, and the
      // haps it returns are whatever that code built. One guard per def
      // covers the lot. It is deliberately a bare try/catch and a call to a
      // module-level function — no closure is created and nothing is
      // allocated on the happy path, because this runs for every driven
      // channel 60 times a second.
      try {
        if (isPattern(value)) {
          // Query a thin arc so we get the instantaneous value
          const haps = value.queryArc(cyclePos, cyclePos + 0.0001);
          if (haps.length > 0) {
            const v = haps[0].value;
            if (typeof v === 'number') floatVal = v;
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
 * The "primary" universe is universe 0 — the same universe that `fixture()` and
 * `rgbStrip()` write to when no universe argument is passed. This lines up
 * with the Art-Net / TouchDesigner convention where the first universe is
 * numbered 0.
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
