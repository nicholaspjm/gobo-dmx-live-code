/**
 * Safe eval sandbox for user-written lumen code.
 *
 * Uses new Function() to run code with a controlled set of globals.
 * Strudel pattern functions are loaded once and injected into the context.
 *
 * Example user code:
 *   ch(1, sine().slow(2))
 *   rgb(1, sine(), 0, cosine().slow(3))
 *
 * Evaluation is transactional — see evalCode() below. Every part of the API a
 * scene is handed that changes the rig's output — channel definitions, the
 * bridge output config, the tempo — is applied together once the run finishes
 * cleanly, or dropped whole when it throws. What ties a call to a run is WHEN
 * it is made, not which run's context handed out the function: see
 * `_activeBuffer` below, both for calls that escape the eval that bound them
 * and for what a call does when no eval is in flight at all.
 *
 * Two things a scene declares deliberately outlive a failed run, because they
 * are name bindings rather than output: fixture types declared with
 * defineFixture() and chain methods declared with register(). Neither binding
 * drives a channel by existing. A register() *body*, though, is scene code
 * kept for later — it runs at query time, potentially many scenes after the
 * one that wrote it — so what it does when it runs is governed by the rule
 * above, not by the eval that registered it.
 */

import {
  beginStaging,
  commitStaging,
  abortStaging,
  ch,
  uni,
  dim,
  rgb,
  type PatternLike,
} from './dmx.js';
import { setBPM } from './scheduler.js';
import {
  fixture,
  defineFixture,
  listFixtures,
  rgbStrip,
  rgbwStrip,
  clearVizRegistry,
  clearSimFixtures,
  setStripEffectWaveforms,
} from './fixtures.js';
import { sendConfig } from './websocket.js';
import { clearPatternVizRegistry, registerPatternViz } from './pattern-viz.js';

// Strudel functions, loaded once via initStrudel()
const _strudelCtx: Record<string, unknown> = {};

/**
 * Load state of the pattern engine.
 *
 * One value rather than a ready/failed pair of booleans, because evalCode()
 * has to tell "still loading" apart from "never started" and from "failed",
 * and a pair leaves a window where neither flag is set — see strudelRefusal().
 */
type StrudelState = 'idle' | 'loading' | 'ready' | 'failed';
let _strudelState: StrudelState = 'idle';
// Why the pattern engine failed to load, or null if it hasn't. Written only by
// initStrudel(), always alongside the state above.
let _strudelError: string | null = null;
// Cached reference to the Strudel Pattern.prototype. Captured during
// initStrudel() so register() (below) can extend it without re-deriving
// the prototype each call.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _patternProto: any = null;

/** Call once (async) before first eval to load @strudel/core waveforms. */
export async function initStrudel(): Promise<void> {
  if (_strudelState === 'ready') return;
  // Enter 'loading' before the first await, not after it. evalCode() reads
  // this synchronously and must see the in-flight state for the whole of it.
  _strudelState = 'loading';
  _strudelError = null;
  try {
    // Dynamic import keeps build working even if strudel isn't installed yet
    const core = await import('@strudel/core');

    // Wrap each waveform: if it's already a function → use directly.
    // If it's a Pattern instance → wrap in a factory (() => pattern).
    // This ensures user code can call sine(), cosine(), etc.
    function wrap(exported: unknown): (...args: unknown[]) => PatternLike {
      if (typeof exported === 'function') {
        return exported as (...args: unknown[]) => PatternLike;
      }
      // Pattern instance — make it callable
      return () => exported as PatternLike;
    }

    _strudelCtx.sine = wrap(core.sine);
    _strudelCtx.cosine = wrap(core.cosine);
    _strudelCtx.square = wrap(core.square);
    _strudelCtx.saw = wrap(core.saw);
    _strudelCtx.rand = wrap(core.rand);
    _strudelCtx.sequence = core.sequence;
    _strudelCtx.cat = core.cat;
    _strudelCtx.stack = core.stack;

    // Mini-notation lives in a separate @strudel/mini package — not re-
    // exported from core. Import it so users can do mini('1 - 1 -') the
    // same way Strudel's docs demonstrate. Fail-soft: if the mini package
    // is ever missing, fall back to a thin sequence-based shim that
    // handles the common "space-separated tokens" case without brackets
    // / repeats / alternation.
    try {
      const miniMod = await import('@strudel/mini');
      _strudelCtx.mini = miniMod.mini;
      _strudelCtx.m = miniMod.m ?? miniMod.mini;
    } catch {
      console.warn('[lumen] @strudel/mini unavailable — falling back to sequence()');
      const seq = core.sequence as (...args: unknown[]) => PatternLike;
      const shim = (str: string): PatternLike => {
        const tokens = str.trim().split(/\s+/).map((t) => {
          if (t === '-' || t === '~') return 0;
          const n = Number(t);
          return Number.isFinite(n) ? n : 0;
        });
        return seq(...tokens);
      };
      _strudelCtx.mini = shim;
      _strudelCtx.m = shim;
    }

    // Teach every Strudel Pattern `.flash() / .glow() / .wave()` via a one-time
    // prototype patch. Cheaper than wrapping every pattern in a Proxy, and the
    // methods stay attached through .slow() / .fast() / .add() / etc. chains
    // because those all return the same Pattern class.
    try {
      const sample = typeof core.sine === 'function' ? (core.sine as () => PatternLike)() : core.sine as PatternLike;
      const proto = sample ? Object.getPrototypeOf(sample) : null;
      if (proto && !proto.flash) {
        proto.flash = function () { registerPatternViz(this, 'flash'); return this; };
        proto.glow  = function () { registerPatternViz(this, 'glow');  return this; };
        proto.wave  = function () { registerPatternViz(this, 'wave');  return this; };
      }
      // Stash the prototype for register() (further down) to extend on demand.
      _patternProto = proto;
    } catch {
      // Strudel's internals shape changed or sample failed — audio reactives
      // still get viz methods attached directly.
    }

    _strudelState = 'ready';
    // Hand the waveform factories to fixtures.ts so strip.rainbowChase()
    // can build patterns at eval time without importing strudel itself.
    setStripEffectWaveforms(
      _strudelCtx.sine as () => unknown,
      _strudelCtx.cosine as () => unknown,
    );
    console.log('[lumen] strudel core loaded');
  } catch (err) {
    // No fallback waveforms. A hand-rolled stand-in engine looks identical
    // from user code but resolves subtly different values, so a show would
    // run on the wrong patterns with nothing to indicate it. Record the
    // failure loudly instead and let evalCode() refuse to run: an operator
    // who knows the pattern engine is down can reload or fall back to a
    // console, one who doesn't can only wonder why the rig looks wrong.
    // State and message are written together, so a caller can never read
    // 'failed' without a reason or a reason without 'failed'.
    _strudelState = 'failed';
    _strudelError = errorMessage(err);
    console.error(
      `[lumen] pattern engine (@strudel/core) failed to load — evaluation is disabled: ${_strudelError}`,
    );
  }
}

/** True once the Strudel pattern engine is loaded and scenes can be evaluated. */
export function isStrudelReady(): boolean {
  return _strudelState === 'ready';
}

/** Why the pattern engine failed to load, or null if it hasn't failed. */
export function getStrudelError(): string | null {
  return _strudelError;
}

/**
 * The reason evaluation must not run right now, or null to proceed.
 *
 * Refuses while the engine is loading as well as after it has failed. Those
 * are the same window in practice: initStrudel() clears the previous error
 * before it awaits the import, so a gate that only looked at the error let
 * every run during app start — and every retry after a failure — through with
 * an empty context, where the scene dies on "sine is not defined" instead of
 * saying what is actually wrong.
 *
 * 'idle' (initStrudel() never called) proceeds. A host that never asked for a
 * pattern engine never had one to lose; scenes made of plain numbers are a
 * supported way to drive the DMX layer. The browser app calls initStrudel()
 * during startup, before a run can be triggered by anything, so 'idle' is not
 * a state it evaluates in.
 */
function strudelRefusal(): string | null {
  if (_strudelState === 'failed') {
    return `pattern engine unavailable — evaluation is disabled (${_strudelError}). Reload the page.`;
  }
  if (_strudelState === 'loading') {
    return 'pattern engine still loading — evaluation is disabled until it is ready.';
  }
  return null;
}

// ─── Bridge config helpers (called from user code) ───────────────────────────
//
// These build a config payload; they do not send it. sendConfig() puts a frame
// on the wire the moment it is called, which would let a scene that throws on
// a later line switch the bridge over permanently — the rolled-back scene is
// gone but the previous scene's output now goes somewhere else. So the sandbox
// gets stand-ins that route through the eval in flight (stageConfig, below)
// and the send happens only after a clean run has committed.

type BridgeConfig = Record<string, unknown>;

function artnetConfig(host = '127.0.0.1', port = 6454): BridgeConfig {
  return { mode: 'artnet', artnet: { host, port } };
}

function sacnConfig(universe = 1, priority = 100): BridgeConfig {
  return { mode: 'sacn', sacn: { universe, priority } };
}

function oscConfig(host = '127.0.0.1', port = 9000): BridgeConfig {
  return { mode: 'osc', osc: { host, port } };
}

function mockConfig(): BridgeConfig {
  return { mode: 'mock' };
}

/**
 * One run's output-changing calls, held until the run is known to have
 * finished. The last call of each kind wins — the same as the immediate sends
 * these stand in for, where the last one on the wire is the one that sticks.
 */
interface SideEffectBuffer {
  config: BridgeConfig | null;
  bpm: number | null;
}

/**
 * The buffer belonging to the eval currently in flight, or null when there is
 * none. stageConfig()/stageBPM() below resolve it at CALL time.
 *
 * A module-level slot rather than a per-run closure, because the functions a
 * scene calls are not all the running eval's own. register() writes its body
 * onto the shared Pattern prototype, which survives across evals on purpose;
 * that body closes over the sandbox bindings of the eval that DEFINED it, and
 * it runs lazily — when a pattern chain is queried, which can be a later
 * scene's eval or a tick() long after every eval has finished. Bound by
 * closure, such a call found its defining eval's buffer already settled and
 * applied immediately, outside the running eval's transaction: the new scene's
 * channel defs rolled back while the tempo and output host its register() body
 * set did not, leaving the rig on the previous scene's defs at the new scene's
 * tempo, pointed at a new host. That is the exact state evalCode()'s flush
 * ordering exists to prevent.
 *
 * Resolving through this slot instead, a call belongs to whichever eval is in
 * flight when it is made, no matter who handed out the function.
 *
 * One slot is enough for all of it: evalCode() runs user code synchronously,
 * so no second eval and no tick can start while one is in flight.
 */
let _activeBuffer: SideEffectBuffer | null = null;

/**
 * Route a bridge config into the running eval's transaction.
 *
 * With no eval in flight the call applies immediately. That is a deliberate
 * choice, not a leftover: a call from a timer, or from a register() body that
 * a tick invoked, has no run to be committed or rolled back with, and parking
 * it for whatever eval happens to come next would fire it at a moment no scene
 * asked for. Immediate is also exactly what these calls did before any of the
 * buffering existed.
 */
function stageConfig(config: BridgeConfig): void {
  const buffer = _activeBuffer;
  if (buffer === null) {
    sendConfig(config);
    return;
  }
  buffer.config = config;
}

/** Route a tempo change into the running eval's transaction. See stageConfig(). */
function stageBPM(value: number): void {
  const buffer = _activeBuffer;
  if (buffer === null) {
    setBPM(value);
    return;
  }
  // setBPM() ignores non-finite input and keeps the last good tempo. Filter
  // the same values here so a typo on a later line does not become "the last
  // call" and quietly throw away a good setBPM() from an earlier one.
  if (!Number.isFinite(value)) return;
  buffer.bpm = value;
}

/**
 * Sandbox stand-ins for artnet/sacn/osc/mock/setBPM.
 *
 * One shared set for every eval, not a fresh set per run: they hold no
 * per-run state now that the run is resolved at call time, and a scene keeping
 * hold of one of them past its own eval is precisely the case that has to
 * behave. Signatures and defaults are unchanged from the scene's point of view.
 */
const sandboxOutputBindings: Record<string, unknown> = {
  artnet: (host?: string, port?: number): void => stageConfig(artnetConfig(host, port)),
  sacn: (universe?: number, priority?: number): void => stageConfig(sacnConfig(universe, priority)),
  osc: (host?: string, port?: number): void => stageConfig(oscConfig(host, port)),
  mock: (): void => stageConfig(mockConfig()),
  setBPM: (value: number): void => stageBPM(value),
};

/** Apply a run's buffered calls. Call after the staged defs are committed. */
function flushSideEffects(buffer: SideEffectBuffer): void {
  if (buffer.config !== null) sendConfig(buffer.config);
  if (buffer.bpm !== null) setBPM(buffer.bpm);
}

// ─── register: extend Pattern with a custom chain method ───────────────────
// Mirrors Strudel's `register(name, fn)`: `fn` takes a pattern and returns a
// transformed one. After registration the name is callable as a method on
// any pattern, surviving .slow()/.fast()/.add() chains since those all
// return the same Pattern class.
//
//   const punch = register('punch', (p) => p.range(-4, 1).flash())
//   spot.white(mini('1 - - -').punch())
//
// Idempotent: re-registering overwrites the previous body so re-evaluating
// a scene with edited register() bodies picks up the new code. Names persist
// across evals (we can't tell which were "removed" without diffing the doc),
// which matches Strudel's behaviour.
//
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function register(name: string, fn: (pat: any) => any): (pat: any) => any {
  if (_patternProto && typeof name === 'string' && name.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-this-alias, @typescript-eslint/no-explicit-any
    _patternProto[name] = function (this: any): any {
      return fn(this);
    };
  } else if (!_patternProto) {
    // Strudel hasn't initialised yet — surface a clear hint rather than
    // silently swallowing the registration.
    console.warn(`[lumen] register("${name}") called before strudel loaded; await initStrudel() first`);
  }
  return fn;
}

export interface EvalResult {
  success: boolean;
  error?: string;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Compile and run a scene, swapping it in only if the whole thing succeeds.
 *
 * The order here is the contract, not an implementation detail. Typing is a
 * performance: half-finished code is in the buffer most of the time, and an
 * eval that fails must be a no-op on the wire. So:
 *
 *   1. Refuse outright unless the pattern engine is usable.
 *   2. Compile. A syntax error returns before a single live byte is touched.
 *   3. Run the user code with channel writes staged off to one side and the
 *      output-changing calls (bridge config, tempo) held in a buffer.
 *   4. Commit the defs and then flush the buffer on a clean return; discard
 *      both on a throw.
 *
 * Either way the rig keeps running the previous scene until a complete new
 * one is ready to replace it — a failed eval reports the error and changes
 * nothing else about the output.
 */
export function evalCode(code: string): EvalResult {
  const refusal = strudelRefusal();
  if (refusal !== null) return { success: false, error: refusal };

  const sideEffects: SideEffectBuffer = { config: null, bpm: null };

  const ctx: Record<string, unknown> = {
    // DMX API
    ch,
    uni,
    dim,
    rgb,
    // Fixture system
    fixture,
    defineFixture,
    listFixtures,
    rgbStrip,
    rgbwStrip,
    // Pattern extension — define custom chain methods at top level.
    register,
    // Patterns (populated by initStrudel)
    ..._strudelCtx,
    // Clock + bridge config. These reach past the staging map to the wire and
    // the scheduler, so the sandbox gets stand-ins that route through the eval
    // in flight instead. Spread after the pattern context, which must not
    // shadow them back to the immediate versions.
    ...sandboxOutputBindings,
    // Passthrough safe globals
    Math,
    console,
  };

  const keys = Object.keys(ctx);
  const values = Object.values(ctx);

  // Compile before touching any live state. Building the context above is
  // pure reference-gathering, so a SyntaxError here returns with the running
  // scene bit-for-bit unchanged — mistyping a paren mid-set is a status-bar
  // message, never a blackout.
  let fn: (...args: unknown[]) => unknown;
  try {
    // new Function is intentional — this is the eval sandbox
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    fn = new Function(...keys, `"use strict";\n${code}`) as (...args: unknown[]) => unknown;
  } catch (err) {
    return { success: false, error: errorMessage(err) };
  }

  // The code parses, so it's worth building a scene from. Channel writes go to
  // the staging map, which the renderer cannot see until it is committed.
  //
  // The three display-only registries are different: user code fills them as
  // it runs, so they have to be emptied first and there is no prior state left
  // to restore if the run then throws. Emptying them again on the failure path
  // is what is available from here, and it is the half that matters: a failed
  // run empties them rather than leaving a fragment of a scene that never went
  // live — best-effort, on the terms set out in the failure branch below. The
  // UI happens to read them only on the success path today, so
  // the fragment was never seen — but that is a calling convention in another
  // package, and this invariant should not rest on it.
  //
  // Every exit from the block below runs the finally, so the staging map is
  // always closed out — including when one of the clears is what threw.
  //
  // Seeded with a failure so rollback is the default: the finally always has a
  // decision to make, and any path that reaches it without setting a result
  // rolls back rather than publishing a scene nobody confirmed.
  let result: EvalResult = { success: false, error: 'evaluation did not complete' };
  beginStaging();
  try {
    // Claim ownership of the output-changing calls. From here until the
    // finally releases it, every artnet()/setBPM() made anywhere — by this
    // code, or through a binding an earlier eval handed to a register() body
    // this code queries — is buffered by THIS run. Set inside the try so no
    // path can leave it standing.
    _activeBuffer = sideEffects;
    clearVizRegistry();
    clearPatternVizRegistry();
    clearSimFixtures();
    fn(...values);
    result = { success: true };
  } catch (err) {
    result = { success: false, error: errorMessage(err) };
  } finally {
    // Release ownership before anything else in this block, on both paths. A
    // stranded _activeBuffer would buffer every later artnet()/setBPM() —
    // from any caller, for the rest of the session — into a transaction that
    // never flushes, swallowing them silently. So it is a bare assignment,
    // which cannot itself throw, and it runs ahead of the commit and the flush
    // below, which can. Clearing this early changes nothing about what applies:
    // flushSideEffects() calls sendConfig()/setBPM() directly rather than
    // going back through the staging functions.
    _activeBuffer = null;
    if (result.success) {
      // Defs first, then the buffered config and tempo. The whole sequence is
      // one synchronous turn, so no tick can land inside it; the order is for
      // the bridge, which never sees an output config for a scene whose
      // channel definitions are not live yet.
      commitStaging();
      flushSideEffects(sideEffects);
    } else {
      // A throw partway through leaves an arbitrary fragment of a scene in the
      // staging map — exactly what must never reach the wire. Drop it whole.
      // Any bridge-config or setBPM call the fragment made needs no undoing:
      // it was only ever written to `sideEffects`, a local that goes out of
      // scope unflushed. abortStaging() cannot throw, and it goes first so
      // nothing below can come between a failed run and its rollback.
      abortStaging();
      // Emptying the display registries is best-effort by comparison. One of
      // them throwing is how we can get here in the first place, and it would
      // throw again on the way out — turning an eval error that evalCode
      // reports as a value into an exception its callers have no path for.
      // The failure is already in `result`; a stale swatch in a panel is not
      // worth losing it over.
      try {
        clearVizRegistry();
        clearPatternVizRegistry();
        clearSimFixtures();
      } catch {
        // Nothing left to do here — the rig is already back on the old scene.
      }
    }
  }

  return result;
}
