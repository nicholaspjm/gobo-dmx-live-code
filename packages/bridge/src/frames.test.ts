/**
 * The bridge's first tests, on the path that matters most.
 *
 * A blackout that does not arrive leaves a rig lit with nobody sending
 * anything further, so these pin the retransmit and, just as importantly, that
 * it gets out of the way the moment real light comes back.
 */

import { describe, it, expect } from 'vitest';
import { createFrameRouter, BLACKOUT_REPEATS_MS } from './frames.js';

/** A router with a fake clock, so nothing waits in real time. */
function harness() {
  const sent: Array<{ universe: number; max: number }> = [];
  const timers: Array<{ id: number; fn: () => void; ms: number; cancelled: boolean }> = [];
  let nextId = 0;
  const router = createFrameRouter({
    send: (universe, channels) => sent.push({ universe, max: Math.max(0, ...channels) }),
    setTimer: (fn, ms) => {
      const t = { id: nextId++, fn, ms, cancelled: false };
      timers.push(t);
      return t.id;
    },
    clearTimer: (h) => {
      const t = timers.find((x) => x.id === h);
      if (t) t.cancelled = true;
    },
  });
  /** Fire every timer that has not been cancelled. */
  const runTimers = (): void => {
    for (const t of timers) if (!t.cancelled) { t.cancelled = true; t.fn(); }
  };
  const pending = (): number => timers.filter((t) => !t.cancelled).length;
  return { router, sent, runTimers, pending, timers };
}

const lit = [255, 0, 0];
const dark = new Array<number>(512).fill(0);

describe('frame routing', () => {
  it('passes a lit frame straight through', () => {
    const h = harness();
    h.router.handle(0, lit);
    expect(h.sent).toEqual([{ universe: 0, max: 255 }]);
    expect(h.router.live()).toEqual([0]);
  });

  it('repeats the frame that goes dark', () => {
    // The one frame that cannot be dropped: after it, nothing further is sent,
    // so a lost packet leaves the rig lit with no correction coming.
    const h = harness();
    h.router.handle(0, lit);
    h.router.handle(0, dark);
    expect(h.sent).toEqual([{ universe: 0, max: 255 }, { universe: 0, max: 0 }]);
    expect(h.pending()).toBe(BLACKOUT_REPEATS_MS.length);
    h.runTimers();
    expect(h.sent.filter((s) => s.max === 0)).toHaveLength(1 + BLACKOUT_REPEATS_MS.length);
  });

  it('spaces the repeats over about a sixth of a second', () => {
    const h = harness();
    h.router.handle(0, lit);
    h.router.handle(0, dark);
    expect(h.timers.map((t) => t.ms)).toEqual(BLACKOUT_REPEATS_MS);
  });

  it('does not repeat a universe that was already dark', () => {
    // An idle frame is not a blackout. Repeating every one of them would put
    // three packets on the wire for every frame of a stopped scene.
    const h = harness();
    h.router.handle(0, dark);
    expect(h.sent).toEqual([{ universe: 0, max: 0 }]);
    expect(h.pending()).toBe(0);
  });

  it('lets light coming back call off the repeats', () => {
    // Otherwise a scene restarted inside the repeat window is darkened by the
    // tail of its own stop.
    const h = harness();
    h.router.handle(0, lit);
    h.router.handle(0, dark);
    h.router.handle(0, lit);
    expect(h.pending()).toBe(0);
    h.runTimers();
    expect(h.sent).toEqual([
      { universe: 0, max: 255 },
      { universe: 0, max: 0 },
      { universe: 0, max: 255 },
    ]);
  });

  it('keeps universes independent', () => {
    const h = harness();
    h.router.handle(0, lit);
    h.router.handle(1, lit);
    h.router.handle(0, dark);
    expect(h.router.live()).toEqual([1]);
    h.router.handle(1, lit);
    expect(h.pending()).toBe(BLACKOUT_REPEATS_MS.length); // universe 0's, untouched
  });

  it('darkens every live universe when the app vanishes', () => {
    const h = harness();
    h.router.handle(0, lit);
    h.router.handle(3, lit);
    expect(h.router.blackoutAll()).toEqual([0, 3]);
    expect(h.sent.filter((s) => s.max === 0).map((s) => s.universe)).toEqual([0, 3]);
    expect(h.router.live()).toEqual([]);
    h.runTimers();
    expect(h.sent.filter((s) => s.universe === 0 && s.max === 0))
      .toHaveLength(1 + BLACKOUT_REPEATS_MS.length);
  });

  it('has nothing to darken when nothing was ever lit', () => {
    const h = harness();
    expect(h.router.blackoutAll()).toEqual([]);
    expect(h.sent).toEqual([]);
  });

  it('stops repeating a universe that goes dark twice', () => {
    // Two stops in a row must not stack two sets of repeats.
    const h = harness();
    h.router.handle(0, lit);
    h.router.handle(0, dark);
    h.router.handle(0, lit);
    h.router.handle(0, dark);
    expect(h.pending()).toBe(BLACKOUT_REPEATS_MS.length);
  });

  it('drops pending repeats on dispose', () => {
    const h = harness();
    h.router.handle(0, lit);
    h.router.handle(0, dark);
    h.router.dispose();
    expect(h.pending()).toBe(0);
  });
});
