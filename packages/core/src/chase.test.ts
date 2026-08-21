/**
 * `.chase()` exists so a moving light does not require writing a function.
 * These pin the geometry it generates: which cell gets which phase, and what
 * the options actually change.
 *
 * The waveform is stubbed rather than imported. `sine` comes from strudel,
 * which does not load under this runner, and the thing worth testing here is
 * the phase per pixel, not the shape of a sine.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { rgbStrip, rgbwStrip, monoStrip, setStripEffectWaveforms } from './fixtures.js';
import { COLORS, makeColor, livingColor } from './colors.js';
import { clearDefs, tick, getUniverseBuffer } from './dmx.js';

/** Calls recorded by the fake waveform, in the order chase() made them. */
let calls: Array<{ early: number; earlies: number[]; slow: number; lo: number; mul: number | null }>;

/** Chainable stand-in that records what was asked of it. `queryArc` is what
 *  makes the value count as a pattern to the channel writer. */
function fakeWave(): unknown {
  // `early` is the first call, which is the cell's own phase. `earlies` keeps
  // every call, because a scene offset adds a second one after .slow().
  const rec = { early: NaN, earlies: [] as number[], slow: NaN, lo: NaN, mul: null as number | null };
  const self: Record<string, unknown> = {
    queryArc: () => [],
    early(p: number) { rec.earlies.push(p); if (Number.isNaN(rec.early)) rec.early = p; return self; },
    slow(n: number) { rec.slow = n; return self; },
    range(lo: number) { rec.lo = lo; calls.push(rec); return self; },
    // One envelope per cell is shared by that cell's components, so a scaled
    // component is its own record rather than an overwrite of the envelope's.
    mul(n: number) { calls.push({ ...rec, mul: n }); return self; },
  };
  return self;
}

beforeEach(() => {
  calls = [];
  clearDefs();
  setStripEffectWaveforms(fakeWave as () => never, fakeWave as () => never);
});

describe('chase', () => {
  it('phases each column by its place across the strip', () => {
    const strip = rgbStrip(1, 12, 0, { skipSim: true });
    strip.chase(COLORS.red);
    // One record per lit component. Red only, so one per pixel. Negative: a
    // cell further right runs later, which is what sends the crest rightward.
    expect(calls.map((c) => Number(c.early.toFixed(4))))
      .toEqual([0, -0.0833, -0.1667, -0.25, -0.3333, -0.4167, -0.5, -0.5833, -0.6667, -0.75, -0.8333, -0.9167]);
  });

  it('runs the other way when reversed', () => {
    const strip = rgbStrip(1, 4, 0, { skipSim: true });
    strip.chase(COLORS.red, { reverse: true });
    expect(calls.map((c) => c.early)).toEqual([0, 0.25, 0.5, 0.75]);
  });

  it('takes one lap every four cycles by default', () => {
    const strip = rgbStrip(1, 4, 0, { skipSim: true });
    strip.chase(COLORS.red);
    expect(calls.every((c) => c.slow === 4)).toBe(true);
  });

  it('goes faster when asked', () => {
    const strip = rgbStrip(1, 4, 0, { skipSim: true });
    strip.chase(COLORS.red, { cycles: 1 });
    expect(calls.every((c) => c.slow === 1)).toBe(true);
  });

  it('fits more crests on the strip', () => {
    const strip = rgbStrip(1, 4, 0, { skipSim: true });
    strip.chase(COLORS.red, { waves: 2 });
    expect(calls.map((c) => c.early)).toEqual([-0, -0.5, -1, -1.5]);
  });

  it('narrows the lit band as width falls', () => {
    // range(lo, 1) on a 0..1 wave: a lower floor clamps more of it away.
    const strip = rgbStrip(1, 2, 0, { skipSim: true });
    strip.chase(COLORS.red, { width: 1 });
    expect(calls[0].lo).toBe(0);
    calls = [];
    strip.chase(COLORS.red, { width: 0.5 });
    expect(calls[0].lo).toBe(-1);
    calls = [];
    strip.chase(COLORS.red, { width: 0.25 });
    expect(calls[0].lo).toBe(-3);
  });

  it('scales a mixed colour and skips components that are zero', () => {
    const strip = rgbStrip(1, 1, 0, { skipSim: true });
    strip.chase(1, 0.5, 0);
    // Red is 1 so it passes through unscaled; green is halved; blue is dropped.
    expect(calls).toHaveLength(2);
    expect(calls[0].mul).toBe(null);
    expect(calls[1].mul).toBe(0.5);
  });

  /**
   * The bug these pin ran silently for as long as `pick()` has existed.
   *
   * A component from `pick()` is a pattern, and `.mul()` looked like the verb
   * that scales an envelope by one. It is not: strudel reifies a duck-typed
   * object with `pure()`, so the multiply becomes a union of two control
   * objects rather than a product. The result carries the envelope's own level
   * with the colour hanging off it under a key nothing reads, so the channel
   * saw full brightness on all three components. Every `.chase(pick(…))` ran
   * white, with no error and no failed query to notice, and the docs used that
   * exact call as the example.
   */
  it('does not put a pattern component through the waveform mul()', () => {
    const strip = rgbStrip(1, 1, 0, { skipSim: true });
    const half = { queryArc: () => [{ value: 0.5 }] };
    strip.chase(livingColor(half, 0, 0));
    expect(calls.every((c) => c.mul === null)).toBe(true);
  });

  it('multiplies the envelope by a pattern component', () => {
    // A waveform that answers with a real level, so the value reaches a buffer.
    const wave = () => {
      const self: Record<string, unknown> = {
        queryArc: () => [{ value: 0.8 }],
        early() { return self; },
        slow() { return self; },
        range() { return self; },
        mul() { throw new Error('a pattern component must not reach mul()'); },
      };
      return self;
    };
    setStripEffectWaveforms(wave as () => never, wave as () => never);
    const strip = rgbStrip(1, 1, 0, { skipSim: true });
    const half = { queryArc: () => [{ value: 0.5 }] };
    strip.chase(livingColor(half, half, 0));
    tick(0);
    const buf = getUniverseBuffer(0);
    // 0.8 envelope x 0.5 component. Unscaled would be 204, which is what the
    // union produced, and what made the chase white.
    expect([buf[0], buf[1], buf[2]]).toEqual([102, 102, 0]);
  });

  it('reads a silent component as dark rather than as full', () => {
    const wave = () => {
      const self: Record<string, unknown> = {
        queryArc: () => [{ value: 1 }],
        early() { return self; }, slow() { return self; }, range() { return self; },
        mul() { return self; },
      };
      return self;
    };
    setStripEffectWaveforms(wave as () => never, wave as () => never);
    const strip = rgbStrip(1, 1, 0, { skipSim: true });
    strip.chase(livingColor({ queryArc: () => [] }, 0, 0));
    tick(0);
    expect(getUniverseBuffer(0)[0]).toBe(0);
  });

  it('leaves a dedicated white where the scene put it', () => {
    // A colour is three components, and the fourth channel is a white emitter
    // that a three-component mix has no business touching. .fill() and .pixel()
    // already worked that way; .chase() passed 0 for W, so a chase over a strip
    // with white up went dark under the band instead of running the colour
    // across it. .full() is still the call that lights every emitter.
    const wave = (): unknown => {
      const self: Record<string, unknown> = {
        queryArc: () => [{ value: 1 }],
        early() { return self; }, slow() { return self; }, range() { return self; },
        mul() { return self; },
      };
      return self;
    };
    setStripEffectWaveforms(wave as () => never, wave as () => never);
    const strip = rgbwStrip(1, 2, 0, { skipSim: true });
    strip.white(0.5);
    strip.chase(COLORS.red);
    tick(0);
    const buf = getUniverseBuffer(0);
    expect(Array.from(buf.slice(0, 8))).toEqual([255, 0, 0, 128, 255, 0, 0, 128]);
  });

  it('phases down the rows on a grid when asked', () => {
    const strip = rgbStrip(1, 12, 0, { columns: 4, skipSim: true });   // 4 x 3
    strip.chase(COLORS.red, { down: true });
    // Three rows, four cells each, all cells in a row sharing a phase.
    expect(calls.map((c) => c.early))
      .toEqual([-0, -0, -0, -0, -1 / 3, -1 / 3, -1 / 3, -1 / 3, -2 / 3, -2 / 3, -2 / 3, -2 / 3]);
  });

  it('offsets the whole chase when asked, so two can run out of step', () => {
    // `.early()` cannot go on the end of the call: it belongs to patterns, and
    // a chase is a command that writes every channel. So it is an option.
    const strip = rgbStrip(1, 2, 0, { skipSim: true });
    strip.chase(COLORS.red, { early: 1 });
    // Cell phase first, then the scene's offset, which lands after .slow() so
    // it counts in cycles of real time.
    expect(calls.map((c) => c.earlies)).toEqual([[-0, 1], [-0.5, 1]]);
  });

  it('leaves the phases alone when no offset is given', () => {
    const strip = rgbStrip(1, 2, 0, { skipSim: true });
    strip.chase(COLORS.red);
    expect(calls.map((c) => c.earlies)).toEqual([[-0], [-0.5]]);
  });

  it('needs no colour on a single-channel strip', () => {
    const cells = monoStrip(1, 4, 0, { skipSim: true });
    cells.chase();
    expect(calls.map((c) => c.early)).toEqual([-0, -0.25, -0.5, -0.75]);
  });

  it('takes the pattern verbs, which is how people reach for it', () => {
    // A chase is a command, not a pattern, but .slow() and .early() are the
    // words people already have. Each restates the chase with one option
    // changed, so the last spelling in the chain is what runs.
    const strip = rgbStrip(1, 2, 0, { skipSim: true });
    strip.chase(COLORS.red).slow(4);
    // Both applications are recorded; the later one is the one that survives
    // on the channel, so it is the last records that matter.
    expect(calls.slice(-2).every((c) => c.slow === 16)).toBe(true);   // 4 by default, x4
  });

  it('composes the verbs in any order', () => {
    const strip = rgbStrip(1, 2, 0, { skipSim: true });
    strip.chase(COLORS.red).slow(2).early(1).reverse();
    const last = calls.slice(-2);
    expect(last.every((c) => c.slow === 8)).toBe(true);
    expect(last.map((c) => c.earlies[0])).toEqual([0, 0.5]);  // reversed sign
    expect(last.every((c) => c.earlies[1] === 1)).toBe(true); // the offset
  });

  it('lets fast undo slow', () => {
    const strip = rgbStrip(1, 1, 0, { skipSim: true });
    strip.chase(COLORS.red).slow(4).fast(4);
    expect(calls[calls.length - 1].slow).toBe(4);
  });

  it('hands the same verbs to a single-channel strip', () => {
    const cells = monoStrip(1, 2, 0, { skipSim: true });
    cells.chase().slow(3).reverse();
    expect(calls[calls.length - 1].slow).toBe(12);
  });

  it('refuses a quoted colour and names the identifier instead', () => {
    // The rule: a colour is a value, never a string. A quoted name that IS a
    // colour gets pointed at its identifier rather than a list.
    const strip = rgbStrip(1, 2, 0, { skipSim: true });
    expect(() => (strip.chase as (c: unknown) => void)('red'))
      .toThrow(/without quotes.*Use red rather than 'red'/);
  });

  it('lists the colours when the quoted name is not one', () => {
    const strip = rgbStrip(1, 2, 0, { skipSim: true });
    expect(() => (strip.chase as (c: unknown) => void)('puce')).toThrow(/is not a colour/);
    expect(() => (strip.chase as (c: unknown) => void)('puce')).toThrow(/magenta/);
  });

  it('takes a mix as three arguments, the way .color() does', () => {
    const strip = rgbStrip(1, 1, 0, { skipSim: true });
    expect(() => strip.chase(1, 0.4, 0)).not.toThrow();
    expect(() => strip.chase(1, 0.4, 0, { cycles: 2 })).not.toThrow();
  });

  it('says what it needs when handed nothing usable', () => {
    const strip = rgbStrip(1, 1, 0, { skipSim: true });
    expect(() => (strip.chase as (c: unknown) => void)(undefined)).toThrow(/needs a colour/);
  });

  it('accepts a colour built by hand', () => {
    const strip = rgbStrip(1, 1, 0, { skipSim: true });
    expect(() => strip.chase(makeColor(0.2, 0.4, 0.6))).not.toThrow();
  });
});
