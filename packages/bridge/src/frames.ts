/**
 * What to put on the wire, and when to say it twice.
 *
 * Separated from index.ts because index.ts starts listening sockets the moment
 * it is imported, which makes the one path that has to be right impossible to
 * test. This module holds no sockets and no config: it is handed a `send` and
 * decides what to hand back.
 *
 * The rule it exists for: going dark is the only frame in a show that cannot
 * afford to be dropped. Art-Net, sACN and OSC all ride on UDP, which does not
 * retransmit, and a DMX receiver holds its last value indefinitely. Every
 * other frame is corrected by the next one 30 milliseconds later; after a
 * blackout both ends consider the universe idle and nothing further is sent,
 * so one lost packet leaves the rig lit with no correction coming.
 */

/** Milliseconds after the first blackout frame to send it again. */
export const BLACKOUT_REPEATS_MS = [55, 120];

export interface FrameRouterOpts {
  /** Put one frame on whatever wire this bridge is configured for. */
  send: (universe: number, channels: number[]) => void;
  /** Injected so tests do not wait in real time. */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export interface FrameRouter {
  /** Route one universe of a frame that arrived from the app. */
  handle(universe: number, channels: number[]): void;
  /**
   * Darken every universe that has carried data, then forget them. For the
   * case where nobody got to press stop: a closed tab, a crashed browser, a
   * shut laptop lid.
   */
  blackoutAll(): number[];
  /** Universes that have carried light since they were last darkened. */
  live(): number[];
  /** Drop pending repeats, for shutdown. */
  dispose(): void;
}

export function createFrameRouter(opts: FrameRouterOpts): FrameRouter {
  const send = opts.send;
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));

  /** Universes this bridge has sent light for. Nothing else knows which are in
   *  play: the bridge holds no scene, only what has passed through it. */
  const liveUniverses = new Set<number>();
  /** Repeats still pending, per universe, so a universe that lights up again
   *  can call off the tail of its own blackout. */
  const repeats = new Map<number, unknown[]>();

  function cancelRepeats(universe: number): void {
    const handles = repeats.get(universe);
    if (!handles) return;
    for (const h of handles) clearTimer(h);
    repeats.delete(universe);
  }

  function blackout(universe: number): void {
    const zeros = new Array<number>(512).fill(0);
    cancelRepeats(universe);
    send(universe, zeros);
    repeats.set(
      universe,
      BLACKOUT_REPEATS_MS.map((ms) => setTimer(() => send(universe, zeros), ms)),
    );
  }

  return {
    handle(universe, channels) {
      if (channels.some((v) => v > 0)) {
        liveUniverses.add(universe);
        // Light arriving calls off a blackout still repeating for this
        // universe, so a scene that comes straight back cannot be darkened by
        // the tail of its own stop.
        cancelRepeats(universe);
        send(universe, channels);
        return;
      }
      // All zero. If this universe was lit, this is the stop frame and it gets
      // the repeats. If it was already dark it is an ordinary idle frame.
      if (liveUniverses.delete(universe)) blackout(universe);
      else send(universe, channels);
    },

    blackoutAll() {
      const darkened = [...liveUniverses];
      for (const universe of darkened) blackout(universe);
      liveUniverses.clear();
      return darkened;
    },

    live() {
      return [...liveUniverses];
    },

    dispose() {
      for (const universe of [...repeats.keys()]) cancelRepeats(universe);
    },
  };
}
