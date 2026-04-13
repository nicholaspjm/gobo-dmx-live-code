/**
 * Scheduler — drives the pattern engine at TICK_RATE hz.
 * cyclePos is an ever-increasing float: integer part = cycle number,
 * fractional part = position within that cycle (0.0 → 1.0).
 * At 120 BPM with 4 beats per cycle, 1 cycle = 2 seconds.
 */

export const TICK_RATE = 44; // hz
const BEATS_PER_CYCLE = 4;

export type TickCallback = (cyclePos: number, delta: number) => void;

let _bpm = 120;
let _cyclePos = 0.0;
let _intervalId: ReturnType<typeof setInterval> | null = null;
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

export function start(): void {
  if (_intervalId !== null) return;
  _cyclePos = 0;
  _intervalId = setInterval(() => {
    const inc = _bpm / 60 / BEATS_PER_CYCLE / TICK_RATE;
    _cyclePos += inc;
    for (const cb of _callbacks) {
      try {
        cb(_cyclePos, inc);
      } catch {
        // Swallow per-tick errors; user sees them via eval error display
      }
    }
  }, 1000 / TICK_RATE);
}

export function stop(): void {
  if (_intervalId !== null) {
    clearInterval(_intervalId);
    _intervalId = null;
  }
  _cyclePos = 0;
}

export function isRunning(): boolean {
  return _intervalId !== null;
}
