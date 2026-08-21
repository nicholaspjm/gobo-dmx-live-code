/**
 * Scheduler: drives the pattern engine from a Web Worker clock.
 *
 * cyclePos is an ever-increasing float: integer part = cycle number,
 * fractional part = position within that cycle (0.0 to 1.0).
 * At 120 BPM with 4 beats per cycle, 1 cycle = 2 seconds.
 *
 * The clock lives in a Worker (see clockWorker.ts) rather than on the main
 * thread because Chromium throttles main-thread timers on backgrounded tabs:
 * requestAnimationFrame pauses entirely and setInterval is clamped to 1 Hz.
 * Workers run at full rate regardless of tab visibility, so DMX output keeps
 * flowing during alt-tab.
 *
 * The worker only fires "tick" messages; pattern eval and DMX writes happen on
 * the main thread via onTick callbacks. The increment per tick is computed from
 * wall-clock elapsed time, so BPM is accurate and drift-free at any tick rate.
 */

const BEATS_PER_CYCLE = 4;
const TICK_INTERVAL_MS = 16; // ~60 Hz, matching the main-thread send cap

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
 * Scene code calls this straight out of the eval sandbox, so `value` is
 * whatever the user's expression produced: setBPM(), parseInt('fast') and a
 * typo'd variable all arrive as NaN. The clamp cannot catch that on its own,
 * because Math.max/Math.min propagate NaN rather than rejecting it. NaN is
 * absorbing once it reaches the cycle accumulator, so one bad call silently
 * kills every pattern. Reject non-finite input and keep the last good tempo.
 */
export function setBPM(value: number): void {
  if (!Number.isFinite(value)) return;
  _bpm = Math.max(1, Math.min(400, value));
}

export function getBPM(): number {
  return _bpm;
}

/** Current cycle position (ever-increasing). Fractional part = phase 0-1. */
export function getCyclePos(): number {
  return _cyclePos;
}

/** Phase within the current cycle, 0.0 → <1.0 */
export function getCycleFraction(): number {
  return _cyclePos % 1;
}

/**
 * Put the count back to the top of a cycle, without touching the tempo.
 *
 * Tapping a tempo fixes the speed and says nothing about where the downbeat
 * is, so a set can end up at exactly the right BPM and half a bar out. This is
 * the other half of that.
 *
 * Deliberately separate from stop()/start(), which also zero the accumulator:
 * restarting the clock costs the few milliseconds a replacement worker takes
 * to come up, and no tick runs in that window, so the rig holds its last frame
 * and a resync can be seen as a stutter. This is a single assignment between
 * ticks, so nothing is dropped.
 */
export function resetPhase(): void {
  _cyclePos = 0;
}

/** Register a tick callback. Returns an unsubscribe function. */
export function onTick(cb: TickCallback): () => void {
  _callbacks.add(cb);
  return () => _callbacks.delete(cb);
}

/** Handler for 'tick' messages posted by the clock worker. */
function handleTick(): void {
  // Self-heal: cyclePos is an accumulator, so a single non-finite value sticks
  // forever, because NaN absorbs every later addition. Fixing the BPM from the
  // UI does not recover it: cyclePos stays poisoned, and start() early-returns
  // while the worker is alive, so only stop() clears it. Healing here rather
  // than only in setBPM means no route can leave the clock wedged with the rig
  // half-lit.
  if (!Number.isFinite(_cyclePos)) _cyclePos = 0;

  const nowMs = performance.now();
  // Seconds elapsed since the previous tick (real wall-clock time)
  const rawDt = Math.max(0, (nowMs - _lastTickMs) / 1000);
  _lastTickMs = nowMs;

  // Clamp dt so an abnormally long pause (e.g. machine sleep) doesn't
  // jump the pattern engine forward by many cycles in a single tick.
  const dtSec = Math.min(rawDt, 0.1);

  const inc = (_bpm / 60 / BEATS_PER_CYCLE) * dtSec;

  // One timebase: the wall clock, advanced by the tempo. There used to be a
  // hook here for an external provider to pin cyclePos to an audio playhead,
  // but the audio module it existed for was never wired to anything, so the
  // branch only ever took the fallback. Sync to an outside clock belongs back
  // here when something actually drives it, shaped by what that needs.
  _cyclePos += inc;

  for (const cb of _callbacks) {
    try {
      cb(_cyclePos, inc);
    } catch (err) {
      // Keep the clock running: one broken subscriber must not stop the others
      // from ticking or kill the timebase.
      //
      // Nothing here reaches the UI. The eval error display only shows the
      // result of evalCode(), which has already reported success by the time a
      // tick runs, so a callback that throws every frame is otherwise
      // invisible. Callbacks whose failures the operator needs to know about
      // must surface them themselves (dmx.tick() does this for pattern
      // queries, the one throw path that used to reach here).
      //
      // Logged once, not per tick: at ~60 Hz a repeating throw would bury the
      // console and starve the frame budget.
      if (!_tickErrorLogged) {
        _tickErrorLogged = true;
        console.error('[gobo] tick callback threw; further occurrences are not logged:', err);
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
