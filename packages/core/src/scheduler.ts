/**
 * Scheduler — drives the pattern engine via requestAnimationFrame.
 * cyclePos is an ever-increasing float: integer part = cycle number,
 * fractional part = position within that cycle (0.0 → 1.0).
 * At 120 BPM with 4 beats per cycle, 1 cycle = 2 seconds.
 *
 * rAF is used (not setInterval) because setInterval drifts and jitters
 * badly under load — which shows up as stuttery OSC/ArtNet output. The
 * increment per frame is computed from real elapsed time, so BPM stays
 * accurate regardless of display refresh rate (60, 120, 144 Hz all work).
 */

const BEATS_PER_CYCLE = 4;

export type TickCallback = (cyclePos: number, delta: number) => void;

let _bpm = 120;
let _cyclePos = 0.0;
let _rafId: number | null = null;
let _lastFrameMs = 0;
const _callbacks = new Set<TickCallback>();

export function setBPM(value: number): void {
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

function loop(nowMs: number): void {
  // Seconds elapsed since the previous frame
  const dtSec = Math.max(0, (nowMs - _lastFrameMs) / 1000);
  _lastFrameMs = nowMs;

  // cycles-per-second = BPM / 60 / beatsPerCycle, times elapsed seconds
  const inc = (_bpm / 60 / BEATS_PER_CYCLE) * dtSec;
  _cyclePos += inc;

  for (const cb of _callbacks) {
    try {
      cb(_cyclePos, inc);
    } catch {
      // Swallow per-tick errors; user sees them via eval error display
    }
  }

  _rafId = requestAnimationFrame(loop);
}

export function start(): void {
  if (_rafId !== null) return;
  _cyclePos = 0;
  _lastFrameMs = performance.now();
  _rafId = requestAnimationFrame(loop);
}

export function stop(): void {
  if (_rafId !== null) {
    cancelAnimationFrame(_rafId);
    _rafId = null;
  }
  _cyclePos = 0;
}

export function isRunning(): boolean {
  return _rafId !== null;
}
