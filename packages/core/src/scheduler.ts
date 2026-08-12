/**
 * Scheduler — drives the pattern engine from a Web Worker clock.
 *
 * cyclePos is an ever-increasing float: integer part = cycle number,
 * fractional part = position within that cycle (0.0 → 1.0).
 * At 120 BPM with 4 beats per cycle, 1 cycle = 2 seconds.
 *
 * The clock lives in a Worker (see clockWorker.ts) rather than on the
 * main thread because Chromium throttles main-thread timers when a tab
 * is backgrounded — requestAnimationFrame pauses entirely and
 * setInterval is clamped to 1 Hz. Workers run at full rate regardless
 * of tab visibility, so DMX output keeps flowing during alt-tab.
 *
 * The worker only fires "tick" messages; all pattern eval and DMX
 * writes happen on the main thread via onTick callbacks. The increment
 * per tick is computed from wall-clock elapsed time, so BPM is accurate
 * and drift-free no matter the tick rate.
 */

const BEATS_PER_CYCLE = 4;
const TICK_INTERVAL_MS = 16; // ~60 Hz — matches the main-thread send cap

export type TickCallback = (cyclePos: number, delta: number) => void;

let _bpm = 120;
let _cyclePos = 0.0;
let _worker: Worker | null = null;
let _lastTickMs = 0;
const _callbacks = new Set<TickCallback>();
// One-shot latch for the callback error log below. Reset by start() so each
// run of the scheduler gets one line.
let _tickErrorLogged = false;

/**
 * Optional external clock provider — lets another module (currently the
 * audio integration) pin cyclePos to track position so patterns stay
 * phase-locked to the music. Returns null when it has nothing to offer
 * and the internal wall-clock should be used instead.
 */
let _clockProvider: (() => number | null) | null = null;
export function setClockProvider(fn: (() => number | null) | null): void {
  _clockProvider = fn;
}

/**
 * Scene code calls this straight out of the eval sandbox, so `value` is
 * whatever the user's expression happened to produce — setBPM(),
 * parseInt('fast') and a typo'd variable all arrive as NaN. The clamp
 * cannot catch that on its own: Math.max/Math.min propagate NaN rather
 * than rejecting it, and NaN is absorbing once it reaches the cycle
 * accumulator, so one bad call silently kills every pattern mid-show.
 * Reject non-finite input and keep the last good tempo running.
 */
export function setBPM(value: number): void {
  if (!Number.isFinite(value)) return;
  _bpm = Math.max(1, Math.min(400, value));
}

export function getBPM(): number {
  return _bpm;
}

/** Current cycle position (ever-increasing). Fractional part = phase 0–1. */
export function getCyclePos(): number {
  return _cyclePos;
}

/** Phase within the current cycle, 0.0 → <1.0 */
export function getCycleFraction(): number {
  return _cyclePos % 1;
}

/** Register a tick callback. Returns an unsubscribe function. */
export function onTick(cb: TickCallback): () => void {
  _callbacks.add(cb);
  return () => _callbacks.delete(cb);
}

/** Handler for 'tick' messages posted by the clock worker. */
function handleTick(): void {
  // Self-heal: cyclePos is an accumulator, so a single non-finite value
  // sticks forever — NaN absorbs every later addition. Recovery from the
  // UI doesn't help either, because fixing the BPM leaves cyclePos poisoned
  // and start() early-returns while the worker is alive, so only stop()
  // clears it. Healing here (not just in setBPM) means no route can leave
  // the clock wedged with the rig stuck in a half-lit state.
  if (!Number.isFinite(_cyclePos)) _cyclePos = 0;

  const nowMs = performance.now();
  // Seconds elapsed since the previous tick (real wall-clock time)
  const rawDt = Math.max(0, (nowMs - _lastTickMs) / 1000);
  _lastTickMs = nowMs;

  // Clamp dt so an abnormally long pause (e.g. machine sleep) doesn't
  // jump the pattern engine forward by many cycles in a single tick.
  const dtSec = Math.min(rawDt, 0.1);

  const inc = (_bpm / 60 / BEATS_PER_CYCLE) * dtSec;

  // External clock (audio track) wins when active. This pins cyclePos to
  // the track's playhead so patterns pause/seek with the music. When it
  // returns null (no track loaded, paused, mic mode) we fall back to the
  // internal wall-clock advance. A non-finite reading is treated the same
  // as null: the provider derives its value from a playhead and a detected
  // BPM (see audio.ts), so a zero or missing tempo can hand us NaN/Infinity,
  // and assigning that would wedge the accumulator exactly like a bad BPM.
  const external = _clockProvider?.();
  if (external !== null && external !== undefined && Number.isFinite(external)) {
    _cyclePos = external;
  } else {
    _cyclePos += inc;
  }

  for (const cb of _callbacks) {
    try {
      cb(_cyclePos, inc);
    } catch (err) {
      // Keep the clock running: one broken subscriber must not stop the
      // others from ticking, and it must not kill the show's timebase.
      //
      // Nothing here reaches the UI. The eval error display only ever shows
      // the result of evalCode(), and by the time a tick runs that has
      // already reported success — so a callback that throws every frame
      // would otherwise be completely invisible. Callbacks that can fail in
      // a way the operator needs to know about are responsible for
      // surfacing it themselves (dmx.tick() does this for pattern queries,
      // which is the one throw path that used to reach here).
      //
      // Logged once, not per tick: at ~60 Hz a repeating throw would bury
      // the console and starve the frame budget.
      if (!_tickErrorLogged) {
        _tickErrorLogged = true;
        console.error('[lumen] tick callback threw — further occurrences are not logged:', err);
      }
    }
  }
}

export function start(): void {
  if (_worker !== null) return;
  _cyclePos = 0;
  _lastTickMs = performance.now();
  _tickErrorLogged = false;
  _worker = new Worker(new URL('./clockWorker.ts', import.meta.url), { type: 'module' });
  _worker.onmessage = handleTick;
  _worker.postMessage({ type: 'start', intervalMs: TICK_INTERVAL_MS });
}

export function stop(): void {
  if (_worker !== null) {
    _worker.postMessage({ type: 'stop' });
    _worker.terminate();
    _worker = null;
  }
  _cyclePos = 0;
}

export function isRunning(): boolean {
  return _worker !== null;
}
