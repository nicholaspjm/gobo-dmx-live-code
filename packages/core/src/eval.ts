/**
 * Safe eval sandbox for user-written gobo code.
 *
 * Uses new Function() to run code with a controlled set of globals.
 * Strudel pattern functions are loaded once and injected into the context.
 *
 * Example user code:
 *   ch(1, sine().slow(2))
 *   rgb(1, sine(), 0, cosine().slow(3))
 *
 * Evaluation is transactional (see evalCode() below). Everything a scene can
 * change about the rig's output, meaning channel definitions, the bridge output
 * config and the tempo, is applied together once the run finishes, or dropped
 * when it throws. What ties a call to a run is WHEN it is made, not
 * which run's context handed out the function. See `_activeBuffer` below, for
 * calls that escape the eval that bound them and for what a call does when no
 * eval is in flight.
 *
 * Two things a scene declares outlive a failed run, because they are name
 * bindings rather than output: fixture types declared with defineFixture() and
 * chain methods declared with register(). Neither drives a channel by existing.
 * A register() *body* is scene code kept for later: it runs at query time,
 * possibly many scenes after the one that wrote it, so what it does when it
 * runs follows the rule above rather than the eval that registered it.
 */

import {
  beginStaging,
  commitStaging,
  abortStaging,
  ch,
  uni,
  dim,
  rgb,
  hushDefs,
  type PatternLike,
} from './dmx.js';
import { COLORS, mix } from './colors.js';
import { setBPM } from './scheduler.js';
import {
  fixture,
  defineFixture,
  listFixtures,
  rgbStrip,
  rgbwStrip,
  monoStrip,
  group,
  clearVizRegistry,
  clearSimFixtures,
  setStripEffectWaveforms,
} from './fixtures.js';
import { sendConfig, connectDirect, isBlockedAsMixedContent, isConnected } from './websocket.js';
import { isUsbConnected, isUsbDmxSupported } from './usb-dmx.js';
import { clearPatternVizRegistry, registerPatternViz } from './pattern-viz.js';
import { screen, clearScreens } from './screen.js';
import { slider, pick, clearControls, clearPickers } from './controls.js';

// Strudel functions, loaded once via initStrudel()
const _strudelCtx: Record<string, unknown> = {};

/**
 * Load state of the pattern engine.
 *
 * One value rather than a ready/failed pair of booleans, because evalCode()
 * has to tell "still loading" apart from "never started" and from "failed",
 * and a pair leaves a window where neither flag is set. See strudelRefusal().
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
      // Pattern instance: make it callable
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

    // ── Named moves ────────────────────────────────────────────────────
    //
    // Four gestures a lighting desk has a button for, each one strudel
    // expression that you have to already know to write. Real patterns, built
    // from the primitives above, so they chain and stack like anything else:
    // `wash.dim(flash().mul(0.7))` and `stack(pulse(8), flash())` both work.
    //
    // The negative floor in flash() and adsr() is the load-bearing trick and
    // the one nobody guesses: a channel clamps below zero, so pushing most of
    // a wave under the line leaves only its tip above, which is what makes a
    // sharp hit out of a linear ramp.

    /** The slow swell. Breathing, on any channel. */
    _strudelCtx.pulse = (cycles = 4): PatternLike =>
      (core.sine as PatternLike & { slow(n: number): PatternLike }).slow(cycles);

    /** Hard on/off, `per` times a cycle. A software strobe for fixtures that
     *  have no strobe channel of their own. */
    _strudelCtx.strobe = (per = 8): PatternLike =>
      (core.square as PatternLike & { fast(n: number): PatternLike }).fast(per);

    /**
     * Sharp hit, quick decay: the move you make on a kick.
     *
     * `tail` is how much of each beat it stays lit, so 0.3 is a snap and 0.9
     * is nearly a sawtooth. isaw falls 1 to 0 across a cycle, and dropping the
     * floor to 1 - 1/tail puts everything past that fraction below zero.
     */
    _strudelCtx.flash = (per = 1, tail = 0.3): PatternLike => {
      const t = Math.min(1, Math.max(0.01, tail));
      const isaw = _strudelCtx.isaw as (() => PatternLike) | undefined;
      const base = isaw ? isaw() : (core.saw as PatternLike);
      return (base as PatternLike & { fast(n: number): { range(lo: number, hi: number): PatternLike } })
        .fast(per).range(1 - 1 / t, 1);
    };

    /** Candle, fire, a lamp on its way out. Wanders around full by `amount`. */
    _strudelCtx.flicker = (amount = 0.3): PatternLike => {
      const a = Math.min(1, Math.max(0, amount));
      const perlin = _strudelCtx.perlin as (() => PatternLike) | undefined;
      const base = perlin ? perlin() : (core.rand as PatternLike);
      return (base as PatternLike & { range(lo: number, hi: number): PatternLike }).range(1 - a, 1);
    };

    /**
     * An envelope to put over anything, once per cycle.
     *
     * Multiply it onto an effect and the effect gets a shape:
     * `wash.dim(flicker().mul(adsr(0.1, 0.1, 0.7, 0.2)))`. The four numbers are
     * fractions of a cycle for attack, decay and release, with sustain the
     * level held in between, which is how every synth spells it.
     *
     * Built on fmap over a ramp rather than out of range/add arithmetic,
     * because an envelope is piecewise and arithmetic on a single wave cannot
     * be. Falls back to a plain ramp where fmap is missing, so a scene using
     * it still runs.
     */
    _strudelCtx.adsr = (attack = 0.05, decay = 0.1, sustain = 0.7, release = 0.2): PatternLike => {
      const a = Math.max(0, attack);
      const d = Math.max(0, decay);
      const s = Math.min(1, Math.max(0, sustain));
      const r = Math.max(0, release);
      const at = (t: number): number => {
        if (a > 0 && t < a) return t / a;                        // rising
        if (d > 0 && t < a + d) return 1 - (1 - s) * ((t - a) / d); // falling to sustain
        const relStart = 1 - r;
        if (r > 0 && t >= relStart) return s * (1 - (t - relStart) / r); // letting go
        return s;                                                 // holding
      };
      const ramp = core.saw as PatternLike & { fmap?(fn: (v: number) => number): PatternLike };
      if (typeof ramp.fmap === 'function') return ramp.fmap(at);
      console.warn('[gobo] adsr(): this strudel build has no fmap, falling back to a plain ramp');
      return ramp;
    };

    // The rest of the pattern vocabulary, under the names strudel gives them.
    //
    // These were all present in @strudel/core and simply never handed to the
    // sandbox, so a scene that reached for one got "irand is not defined" and
    // no hint that the function existed. Chain methods (.euclid, .degradeBy,
    // .sometimesBy …) already arrive on the Pattern prototype; what needed
    // wiring is the top-level functions and the remaining signals.
    //
    // Names are strudel's, deliberately. Anything renamed here would be a
    // dialect: a pattern copied out of the strudel docs should run.
    const passthrough = [
      // signals
      'tri', 'isaw', 'perlin',
      // randomness
      'irand', 'brand', 'brandBy', 'choose', 'wchoose', 'chooseCycles',
      'randcat', 'wrandcat', 'shuffle', 'scramble',
      // structure
      'polymeter', 'polyrhythm', 'pm', 'pr',
      'slowcat', 'fastcat', 'timeCat', 'stepcat', 'run', 'pure', 'silence',
    ] as const;
    // Signals are exported as Pattern instances; wrap() makes them callable so
    // scene code says tri() the way it says sine(). Everything else is already
    // a function, or is meant to be used bare.
    //
    // silence is deliberately NOT in here. Strudel writes it without parens
    // (`wash.red(silence)`), so wrapping it would turn the documented form
    // into a function reaching the channel, which is now a rejected value.
    const signals = new Set(['tri', 'isaw', 'perlin']);
    for (const name of passthrough) {
      // Each read is guarded on its own. A missing name must cost only that
      // name: reading an absent export off a module namespace can throw rather
      // than give undefined, and an escape from here lands in the outer catch,
      // which marks the whole engine failed and makes evalCode refuse every
      // scene. One optional extra would take the entire pattern engine down.
      try {
        const exported = (core as Record<string, unknown>)[name];
        if (exported === undefined) continue;
        _strudelCtx[name] = signals.has(name) ? wrap(exported) : exported;
      } catch {
        // This strudel build does not have it; the rest still load.
      }
    }

    // Mini-notation lives in a separate @strudel/mini package and is not
    // re-exported from core. Import it so users can write mini('1 - 1 -') as
    // Strudel's docs do. If the mini package is missing, fall back to a thin
    // sequence-based shim covering space-separated tokens, without brackets,
    // repeats or alternation.
    try {
      const miniMod = await import('@strudel/mini');
      _strudelCtx.mini = miniMod.mini;
      _strudelCtx.m = miniMod.m ?? miniMod.mini;
    } catch {
      console.warn('[gobo] @strudel/mini unavailable, falling back to sequence()');
      const seq = core.sequence as (...args: unknown[]) => PatternLike;
      const shim = (str: string): PatternLike => {
        const tokens = str.trim().split(/\s+/).map((t) => {
          if (t === '-' || t === '~') return 0;
          const n = Number(t);
          // A token that is not a number is passed through as itself, so a
          // colour name still reaches whatever consumes it. Mapping it to 0
          // made every colour token silently black on a build where the real
          // mini failed to load. Safe to pass a string on: the hook that
          // parses one into a pattern is installed by @strudel/mini, which by
          // definition is not here.
          return Number.isFinite(n) ? n : t;
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
        // Each returns the pattern unchanged, so a decoration never alters
        // what reaches the wire and any number of them can be chained: two
        // calls put two widgets on the line.
        for (const kind of ['flash', 'glow', 'wave', 'roll', 'punchcard', 'spiral', 'spectrum'] as const) {
          proto[kind] = function (this: PatternLike) {
            registerPatternViz(this, kind);
            return this;
          };
        }
      }
      // Stash the prototype for register() (further down) to extend on demand.
      _patternProto = proto;
    } catch {
      // Strudel's internals changed shape, or sample failed. Audio reactives
      // still get viz methods attached directly.
    }

    _strudelState = 'ready';
    // Hand the waveform factories to fixtures.ts so strip.rainbowChase()
    // can build patterns at eval time without importing strudel itself.
    setStripEffectWaveforms(
      _strudelCtx.sine as () => unknown,
      _strudelCtx.cosine as () => unknown,
    );
    console.log('[gobo] strudel core loaded');
  } catch (err) {
    // No fallback waveforms. A hand-rolled stand-in engine looks identical from
    // user code but resolves different values, so a show would run on the wrong
    // patterns with nothing to indicate it. Record the failure instead and let
    // evalCode() refuse to run: an operator who knows the pattern engine is
    // down can reload or fall back to a console. State and message are written
    // together, so a caller can never read 'failed' without a reason or a
    // reason without 'failed'.
    _strudelState = 'failed';
    _strudelError = errorMessage(err);
    console.error(
      `[gobo] pattern engine (@strudel/core) failed to load; evaluation is disabled: ${_strudelError}`,
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
 * Refuses while the engine is loading as well as after it has failed.
 * initStrudel() clears the previous error before it awaits the import, so a
 * gate that only looked at the error let every run during app start, and every
 * retry after a failure, through with an empty context. The scene then died on
 * "sine is not defined" instead of reporting the real problem.
 *
 * 'idle' (initStrudel() never called) proceeds. A host that never asked for a
 * pattern engine never had one to lose; scenes made of plain numbers are a
 * supported way to drive the DMX layer. The browser app calls initStrudel()
 * during startup, before a run can be triggered by anything, so 'idle' is not
 * a state it evaluates in.
 */
function strudelRefusal(): string | null {
  if (_strudelState === 'failed') {
    return `pattern engine unavailable; evaluation is disabled (${_strudelError}). Reload the page.`;
  }
  if (_strudelState === 'loading') {
    return 'pattern engine still loading; evaluation is disabled until it is ready.';
  }
  return null;
}

// ─── Bridge config helpers (called from user code) ───────────────────────────
//
// These build a config payload; they do not send it. sendConfig() puts a frame
// on the wire the moment it is called, which would let a scene that throws on a
// later line switch the bridge over permanently: the rolled-back scene is gone,
// but the previous scene's output now goes somewhere else. The sandbox gets
// stand-ins that route through the eval in flight (stageConfig, below), and the
// send happens only after a clean run has committed.

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
 * Why each bridge output needs a program running on this machine.
 *
 * A scene that calls artnet() in a plain browser with nothing listening runs
 * clean and lights nothing, and on its own the only sign is the status line
 * reporting some seconds later that the target "was never reached", which reads
 * as a fault in the rig. Saying why, on the run that asked for the output, is
 * the difference between "gobo is broken" and "I have not started the connector
 * yet".
 *
 * Keyed by the `mode` of the config each helper builds, so a mode with no entry
 * (there is none today) simply produces no warning rather than a wrong one.
 */
const OUTPUT_NEEDS_CONNECTOR: Record<string, string> = {
  artnet:
    'artnet() sends Art-Net as network packets, and a web page is not allowed to put packets on the network by itself.',
  sacn:
    'sacn() sends sACN as network packets, and a web page is not allowed to put packets on the network by itself.',
  osc:
    'osc() sends OSC as network packets, the same kind Art-Net uses, so it is not a no-install output either.',
  mock:
    'mock() prints the live channels from inside the connector, so it needs the connector as much as the real outputs do.',
};

/**
 * What to do about it. One shared tail so the four messages stay identical
 * where they say the same thing.
 *
 * Names only routes core can be sure of: the connector binary, and a checkout's
 * `npm start`, which serves the page and speaks UDP from one process. Both end
 * in the same place, a bridge on this machine, which is exactly what
 * isConnected() below reports on.
 */
const CONNECTOR_FIX =
  'Nothing is listening on this machine right now, so run the connector (or start gobo from a checkout with '
  + 'npm start) and press ctrl+enter again. Driving a USB DMX box instead? Open the outputs panel from the connection light and pick usb, '
  + 'nothing to install.';

/**
 * The plain-language reason a staged output is reaching nothing, or null when
 * it is arriving (or when the mode does not need the connector).
 *
 * A hint, not a verdict, which is why the calls that produce it still succeed.
 * The bridge socket reconnects on a timer, so "not connected at this instant"
 * also describes a connector that is three seconds from being up, and blacking
 * out a scene over that would be worse than the silence it replaces.
 */
function unreachableOutputWarning(config: BridgeConfig): string | null {
  const mode = typeof config.mode === 'string' ? config.mode : null;
  if (mode === null) return null;
  const cause = OUTPUT_NEEDS_CONNECTOR[mode];
  if (cause === undefined) return null;
  if (isConnected()) return null;
  return `${cause} ${CONNECTOR_FIX}`;
}

/**
 * One run's output-changing calls, held until the run is known to have
 * finished. The last call of each kind wins, matching the immediate sends these
 * stand in for, where the last one on the wire is the one that sticks.
 */
interface SideEffectBuffer {
  config: BridgeConfig | null;
  bpm: number | null;
  direct: { host: string; port: number } | null;
}

/**
 * The buffer belonging to the eval currently in flight, or null when there is
 * none. stageConfig()/stageBPM() below resolve it at CALL time.
 *
 * A module-level slot rather than a per-run closure, because the functions a
 * scene calls are not all the running eval's own. register() writes its body
 * onto the shared Pattern prototype, which survives across evals on purpose.
 * That body closes over the sandbox bindings of the eval that DEFINED it, and
 * runs lazily, when a pattern chain is queried: a later scene's eval, or a
 * tick() long after every eval has finished. Bound by closure, such a call
 * found its defining eval's buffer already settled and applied immediately,
 * outside the running eval's transaction. The new scene's channel defs rolled
 * back while the tempo and output host its register() body set did not, leaving
 * the rig on the previous scene's defs at the new scene's tempo, pointed at a
 * new host. That is the state evalCode()'s flush ordering exists to prevent.
 *
 * Resolving through this slot instead, a call belongs to whichever eval is in
 * flight when it is made, whoever handed out the function.
 *
 * One slot is enough: evalCode() runs user code synchronously, so no second
 * eval and no tick can start while one is in flight.
 */
let _activeBuffer: SideEffectBuffer | null = null;

/**
 * Route a bridge config into the running eval's transaction.
 *
 * With no eval in flight the call applies immediately, deliberately. A call
 * from a timer, or from a register() body that a tick invoked, has no run to be
 * committed or rolled back with, and parking it for whatever eval comes next
 * would fire it at a moment no scene asked for. Immediate is also what these
 * calls did before the buffering existed.
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
 * One shared set for every eval rather than a fresh set per run: they hold no
 * per-run state now that the run is resolved at call time, and a scene holding
 * on to one past its own eval is the case that has to behave. Signatures and
 * defaults are unchanged from the scene's point of view.
 */
const sandboxOutputBindings: Record<string, unknown> = {
  artnet: (host?: string, port?: number): void => stageConfig(artnetConfig(host, port)),
  sacn: (universe?: number, priority?: number): void => stageConfig(sacnConfig(universe, priority)),
  osc: (host?: string, port?: number): void => stageConfig(oscConfig(host, port)),
  mock: (): void => stageConfig(mockConfig()),
  td: (host?: string, port?: number): void => stageDirect(host, port),
  usb: (): void => requireUsb(),
  setBPM: (value: number): void => stageBPM(value),
};

/**
 * Direct output to a WebSocket receiver, TouchDesigner in practice.
 *
 * Unlike the other output calls this one does not go through the bridge: the
 * page opens the socket itself. The scene's frames land in TD, and TD puts
 * Art-Net on the wire, so the hosted build drives a rig with no gobo process
 * running. Connecting is a side effect like any other, so it is held with the
 * eval and only opened once the run commits.
 */
function stageDirect(host = 'localhost', port = 9980): void {
  // Refuse a host the browser will not allow here, at call time, rather than
  // leaving it to applyDirect() at flush time. The flush runs from evalCode()'s
  // finally, after the scene has been committed, so a throw there leaves
  // evalCode by exception instead of returning a failed result: the caller gets
  // no error to show and the half-configured scene is already live. Checked
  // here it is an ordinary scene error, rolled back with everything else.
  if (isBlockedAsMixedContent(host)) throw new Error(mixedContentMessage(host));
  const buffer = _activeBuffer;
  if (buffer === null) {
    applyDirect(host, port);
    return;
  }
  buffer.direct = { host, port };
}

/**
 * Select an already-connected USB DMX interface as the output.
 *
 * Choosing the device needs a user gesture, which scene code is not, so the UI
 * owns connecting and this call only asserts that it happened. Saying so here
 * beats a scene that looks like it runs while nothing is driven.
 */
function requireUsb(): void {
  if (isUsbConnected()) return;
  if (!isUsbDmxSupported()) {
    throw new Error('usb() needs WebSerial, which Chrome and Edge have but Firefox and Safari do not.');
  }
  throw new Error('No USB DMX interface connected. Open the outputs panel from the connection light, choose usb and pick the interface, then run again.');
}

/**
 * Chrome allows ws:// to localhost from an https page but blocks every other
 * host. Saying so beats a socket that never opens and looks like the receiver
 * is down, which is a fault no amount of restarting TouchDesigner fixes.
 */
function mixedContentMessage(host: string): string {
  return (
    `td('${host}') is blocked: this page is served over https, and browsers only allow an insecure ` +
    `WebSocket to localhost. Run TouchDesigner on this machine and use td('localhost'), or serve gobo over http.`
  );
}

function applyDirect(host: string, port: number): void {
  // Also checked in stageDirect(), which is where a scene's call lands. This
  // one covers the path with no eval in flight, where there is no staging step
  // to have caught it.
  if (isBlockedAsMixedContent(host)) throw new Error(mixedContentMessage(host));
  connectDirect(host, port);
}

/** Apply a run's buffered calls. Call after the staged defs are committed. */
function flushSideEffects(buffer: SideEffectBuffer): void {
  if (buffer.config !== null) sendConfig(buffer.config);
  if (buffer.bpm !== null) setBPM(buffer.bpm);
  if (buffer.direct !== null) applyDirect(buffer.direct.host, buffer.direct.port);
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
    // Strudel hasn't initialised yet. Surface a hint rather than silently
    // swallowing the registration.
    console.warn(`[gobo] register("${name}") called before strudel loaded; await initStrudel() first`);
  }
  return fn;
}

export interface EvalResult {
  success: boolean;
  error?: string;
  /**
   * Set on a run that succeeded but whose output is reaching nothing, with the
   * reason and the fix in plain language. Separate from `error` because the
   * scene did run: the patterns are live, the visualizer moves, and only the
   * wire is silent.
   */
  warning?: string;
}

/**
 * Names a scene cannot bind, because the sandbox already binds them.
 *
 * JavaScript reports this as "Identifier 'red' has already been declared",
 * which says nothing about where the other declaration is or why it is
 * unmovable. Colours made the problem worth answering: `red`, `green`, `blue`
 * and `white` are plausible names for a scene's own variables in a way that
 * `sine` and `fixture` never were.
 */
function reservedNameHint(message: string, reserved: Iterable<string>): string {
  const m = /Identifier '([^']+)' has already been declared/.exec(message);
  if (!m) return message;
  const name = m[1];
  const names = new Set(reserved);
  if (!names.has(name)) return message;
  // JavaScript's message has no full stop, so one is added rather than running
  // the two sentences together.
  return (
    `${message.replace(/\s*$/, '')}. "${name}" is one of gobo's own names, so a scene cannot reuse it. ` +
    `Rename your variable, for example ${name}Wash or my${name[0].toUpperCase()}${name.slice(1)}.`
  );
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Compile and run a scene, swapping it in only if the whole thing succeeds.
 *
 * The order here is the contract. Half-finished code is in the buffer most of
 * the time, and an eval that fails must be a no-op on the wire:
 *
 *   1. Refuse outright unless the pattern engine is usable.
 *   2. Compile. A syntax error returns before a single live byte is touched.
 *   3. Run the user code with channel writes staged off to one side and the
 *      output-changing calls (bridge config, tempo) held in a buffer.
 *   4. Commit the defs and then flush the buffer on a clean return; discard
 *      both on a throw.
 *
 * The rig keeps running the previous scene until a complete new one is ready to
 * replace it. A failed eval reports the error and changes nothing about the
 * output.
 */
export function evalCode(code: string): EvalResult {
  const refusal = strudelRefusal();
  if (refusal !== null) return { success: false, error: refusal };

  const sideEffects: SideEffectBuffer = { config: null, bpm: null, direct: null };

  const ctx: Record<string, unknown> = {
    // Colours, as identifiers. A colour is a value here rather than a quoted
    // name: `wash.pixels.chase(red)`, not `chase('red')`.
    //
    // These are sandbox bindings, which are function parameters, so they are
    // reserved: a scene writing `const red = …` gets a SyntaxError, the same
    // way `const sine = …` always has. Eleven more reserved words is the price
    // of naming a colour without quoting it. reservedNameHint() below turns
    // that error into one that says so.
    ...COLORS,
    // DMX API
    ch,
    uni,
    dim,
    rgb,
    /** Everything dark, from inside the scene. Strudel spells it this way. */
    hush: hushDefs,
    /**
     * Tempo the way strudel writes it, so pasted code runs.
     *
     * One gobo cycle is one bar of four beats, so cycles per second times
     * four times sixty is the tempo setBPM already takes.
     */
    setcps: (cps: number) => setBPM(cps * 4 * 60),
    setcpm: (cpm: number) => setBPM(cpm * 4),
    // Fixture system
    fixture,
    defineFixture,
    listFixtures,
    rgbStrip,
    rgbwStrip,
    monoStrip,
    group,
    screen,
    slider,
    pick,
    /** Blend two colours, for a curve the built-in spread does not give:
     *  `bar.each(p => mix(red, blue, p * p))`. */
    mix,
    // Pattern extension: define custom chain methods at top level.
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

  // Compile before touching any live state. Building the context above is only
  // reference-gathering, so a SyntaxError here returns with the running scene
  // bit-for-bit unchanged: a mistyped paren is a status-bar message, not a
  // blackout.
  let fn: (...args: unknown[]) => unknown;
  try {
    // new Function is intentional: this is the eval sandbox
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    fn = new Function(...keys, `"use strict";\n${code}`) as (...args: unknown[]) => unknown;
  } catch (err) {
    return { success: false, error: reservedNameHint(errorMessage(err), keys) };
  }

  // The code parses, so it is worth building a scene from. Channel writes go to
  // the staging map, which the renderer cannot see until it is committed.
  //
  // The three display-only registries work differently: user code fills them as
  // it runs, so they have to be emptied first and there is no prior state left
  // to restore if the run then throws. Emptying them again on the failure path
  // is what is available from here, and it is the half that matters, so a
  // failed run empties them rather than leaving a fragment of a scene that
  // never went live. Best-effort, on the terms set out in the failure branch
  // below. The UI reads them only on the success path today, so the fragment
  // was never seen, but that is a calling convention in another package and
  // this invariant should not rest on it.
  //
  // Every exit from the block below runs the finally, so the staging map is
  // always closed out, including when one of the clears is what threw.
  //
  // Seeded with a failure so rollback is the default: any path that reaches the
  // finally without setting a result rolls back rather than publishing a scene
  // nobody confirmed.
  let result: EvalResult = { success: false, error: 'evaluation did not complete' };
  beginStaging();
  try {
    // Claim ownership of the output-changing calls. From here until the finally
    // releases it, every artnet()/setBPM() made anywhere is buffered by THIS
    // run: by this code, or through a binding an earlier eval handed to a
    // register() body this code queries. Set inside the try so no path can
    // leave it standing.
    _activeBuffer = sideEffects;
    clearVizRegistry();
    clearPatternVizRegistry();
    clearSimFixtures();
    clearScreens();
    clearControls();
  clearPickers();
    fn(...values);
    result = { success: true };
  } catch (err) {
    result = { success: false, error: errorMessage(err) };
  } finally {
    // Release ownership before anything else in this block, on both paths. A
    // stranded _activeBuffer would buffer every later artnet()/setBPM(), from
    // any caller, for the rest of the session, into a transaction that never
    // flushes, swallowing them silently. It is a bare assignment, which cannot
    // itself throw, and it runs ahead of the commit and the flush below, which
    // can. Clearing it early changes nothing about what applies:
    // flushSideEffects() calls sendConfig()/setBPM() directly rather than going
    // back through the staging functions.
    _activeBuffer = null;
    if (result.success) {
      // Defs first, then the buffered config and tempo. The whole sequence is
      // one synchronous turn, so no tick can land inside it; the order is for
      // the bridge, which never sees an output config for a scene whose
      // channel definitions are not live yet.
      commitStaging();
      flushSideEffects(sideEffects);
      // The scene is live either way; this only says whether anything is
      // carrying it out of the page. Read after the flush so it reflects the
      // output the run actually settled on.
      const warning =
        sideEffects.config === null ? null : unreachableOutputWarning(sideEffects.config);
      if (warning !== null) {
        // The status line is the UI's to write, and it may be showing something
        // else by the time anyone looks. The console keeps the reason where it
        // can be found afterwards.
        console.warn(`[gobo] ${warning}`);
        result = { success: true, warning };
      }
    } else {
      // A throw partway through leaves a fragment of a scene in the staging
      // map, which must not reach the wire. Drop it. Any bridge-config or
      // setBPM call the fragment made needs no undoing: it was only ever
      // written to `sideEffects`, a local that goes out of scope unflushed.
      // abortStaging() cannot throw, and it goes first so nothing below can
      // come between a failed run and its rollback.
      abortStaging();
      // Emptying the display registries is best-effort by comparison. One of
      // them throwing is how we can get here, and it would throw again on the
      // way out, turning an eval error that evalCode reports as a value into an
      // exception its callers have no path for. The failure is already in
      // `result`; a stale swatch in a panel is not worth losing it over.
      try {
        clearVizRegistry();
        clearPatternVizRegistry();
        clearSimFixtures();
        clearScreens();
        clearControls();
      } catch {
        // Nothing left to do; the rig is already back on the old scene.
      }
    }
  }

  return result;
}
