/**
 * Clock worker — drives lumen's scheduler from a background thread so
 * that DMX output continues even when the browser tab is hidden.
 *
 * Main-thread timers in Chromium get heavily throttled on hidden tabs:
 * requestAnimationFrame pauses entirely and setInterval is clamped to
 * 1 Hz. Workers are exempt from that throttling, so a setInterval here
 * keeps firing at the requested rate even during alt-tab or minimize.
 *
 * Protocol:
 *   main → worker: { type: 'start', intervalMs: number }
 *   main → worker: { type: 'stop' }
 *   worker → main: 'tick'   (bare string, sent every intervalMs)
 */

let intervalId: ReturnType<typeof setInterval> | null = null;

interface StartMsg { type: 'start'; intervalMs: number }
interface StopMsg { type: 'stop' }
type InMsg = StartMsg | StopMsg;

self.onmessage = (ev: MessageEvent<InMsg>) => {
  const msg = ev.data;
  if (msg.type === 'start') {
    if (intervalId !== null) clearInterval(intervalId);
    intervalId = setInterval(() => {
      (self as unknown as { postMessage: (m: string) => void }).postMessage('tick');
    }, msg.intervalMs);
  } else if (msg.type === 'stop') {
    if (intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
  }
};
