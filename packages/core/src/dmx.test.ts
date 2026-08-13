/**
 * Unit tests for the DMX state layer.
 *
 * These pin the behaviour the rest of the system leans on: 1-based DMX
 * addressing, the number/pattern value contract, defensive handling of junk
 * input, the zero-and-rebuild-per-tick model, the staged scene swap that
 * makes an eval all-or-nothing, and the per-def guard that keeps a pattern
 * throwing at query time from taking the whole frame down with it. Fixture
 * channel mapping is tested here too: fixtures are a naming layer over uni(),
 * and the offset arithmetic is where addressing bugs hide.
 *
 * No strudel dependency: patterns are stubbed as `{ queryArc() }`, which is
 * the entire surface dmx.ts touches, and the eval tests drive scenes made of
 * plain numbers.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  ch,
  uni,
  dim,
  rgb,
  tick,
  clearDefs,
  beginStaging,
  commitStaging,
  abortStaging,
  getUniverseBuffer,
  getAllUniverses,
  getPrimaryUniverseSnapshot,
  getUniverse1Snapshot,
  getQueryFailures,
  getQueryFailureGeneration,
  type PatternLike,
  type PatternOrValue,
} from './dmx.js';

import { fixture, type FixtureInstance } from './fixtures.js';

// eval.ts reaches websocket.ts, which resolves the bridge host from
// `window.location` at module-load time. These tests run headless, so give it
// the one property it reads before the module graph is pulled in, hence the
// dynamic import rather than a static one at the top of the file.
const g = globalThis as { window?: { location: { hostname: string } } };
if (g.window === undefined) g.window = { location: { hostname: 'localhost' } };
const { evalCode } = await import('./eval.js');

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Minimal strudel-shaped pattern; dmx.ts only ever calls queryArc(). */
function stubPattern(value: unknown, calls?: Array<[number, number]>): PatternLike {
  return {
    queryArc(begin: number, end: number) {
      calls?.push([begin, end]);
      return [{ value }];
    },
  };
}

/** A pattern that yields nothing for the queried arc (a rest / gap). */
const silentPattern: PatternLike = { queryArc: () => [] };

/** A pattern that throws when queried: user code that only fails at tick
 *  time, long after the eval that installed it reported success. */
function throwingPattern(message = 'pattern exploded'): PatternLike {
  return {
    queryArc() {
      throw new Error(message);
    },
  };
}

/** Escape hatch for the invalid-input tests; these values are off-contract. */
const bad = (v: unknown): PatternOrValue => v as PatternOrValue;

/**
 * Named channel accessors (`par.red(v)`) hang off the fixture's index
 * signature, which is typed `unknown`, so narrow one back to a callable.
 */
function setter(inst: FixtureInstance, name: string): (v: PatternOrValue) => void {
  return inst[name] as (v: PatternOrValue) => void;
}

/** Indices in `buf` that hold a non-zero value. */
function nonZeroIndices(buf: Uint8Array): number[] {
  const out: number[] = [];
  buf.forEach((v, i) => {
    if (v !== 0) out.push(i);
  });
  return out;
}

// dmx.ts holds module-level state, so every test starts from a clean slate.
// clearDefs() only drops definitions; buffers are zeroed here explicitly
// because nothing but a tick (or a deliberate blackout) darkens them now.
beforeEach(() => {
  abortStaging();
  clearDefs();
  for (const buf of getAllUniverses().values()) buf.fill(0);
});

// ─── value scaling ────────────────────────────────────────────────────────────

describe('value scaling', () => {
  it('maps 0 → 0 and 1 → 255', () => {
    uni(1, 1, 0);
    uni(1, 2, 1);
    tick(0);

    const buf = getUniverseBuffer(1);
    expect(buf[0]).toBe(0);
    expect(buf[1]).toBe(255);
  });

  it('maps 0.5 → 128: the scale ROUNDS, it does not floor', () => {
    uni(1, 1, 0.5);
    uni(1, 2, 0.25);
    tick(0);

    const buf = getUniverseBuffer(1);
    // Math.round(0.5 * 255) === Math.round(127.5) === 128.
    // Flooring would give 127 here and 63 for 0.25; it does neither.
    expect(buf[0]).toBe(128);
    expect(buf[1]).toBe(64);
  });

  it('treats values above 1 as raw DMX integers, not floats', () => {
    // Documented contract: 0..1 is a float, 1 < v <= 255 is a raw DMX byte.
    uni(1, 1, 128);
    uni(1, 2, 255);
    uni(1, 3, 77);
    tick(0);

    const buf = getUniverseBuffer(1);
    expect(buf[0]).toBe(128);
    expect(buf[1]).toBe(255);
    expect(buf[2]).toBe(77);
  });

  it('resolves the ambiguous value 1 as full, not as raw DMX 1', () => {
    // 1 sits on the boundary of both ranges and the float branch wins
    // (`v > 1` is false). There is no way to express raw DMX 1 as a number
    // literal: 1.5 is the nearest raw value that survives, and it lands at 2.
    uni(1, 1, 1);
    uni(1, 2, 1.5);
    tick(0);

    const buf = getUniverseBuffer(1);
    expect(buf[0]).toBe(255);
    expect(buf[1]).toBe(2); // Math.round(1.5 / 255 * 255)
  });
});

// ─── clamping ─────────────────────────────────────────────────────────────────

describe('clamping', () => {
  it('clamps negatives to 0 rather than wrapping', () => {
    uni(1, 1, -0.5);
    uni(1, 2, -1);
    uni(1, 3, -1000);
    uni(1, 4, -Infinity);
    tick(0);

    const buf = getUniverseBuffer(1);
    expect(Array.from(buf.slice(0, 4))).toEqual([0, 0, 0, 0]);
  });

  it('clamps over-range numbers to 255 rather than wrapping', () => {
    // A raw value over 255 divides to > 1 and is then clamped. Note this
    // means the clamp only bites above 255: 2 is "raw DMX 2", not "200%".
    uni(1, 1, 300);
    uni(1, 2, 1e9);
    uni(1, 3, Infinity);
    uni(1, 4, 2);
    tick(0);

    const buf = getUniverseBuffer(1);
    expect(buf[0]).toBe(255);
    expect(buf[1]).toBe(255);
    expect(buf[2]).toBe(255);
    expect(buf[3]).toBe(2);
  });

  it('clamps pattern values, which are NOT rescaled like raw numbers', () => {
    // The number 2 means raw DMX 2, but a pattern yielding 2 is an over-range
    // float and clamps to full.
    uni(1, 1, stubPattern(2));
    uni(1, 2, stubPattern(-1));
    tick(0);

    const buf = getUniverseBuffer(1);
    expect(buf[0]).toBe(255);
    expect(buf[1]).toBe(0);
  });
});

// ─── invalid input ────────────────────────────────────────────────────────────

describe('invalid values', () => {
  it('degrades NaN / null / undefined / strings / plain objects to 0', () => {
    uni(1, 1, NaN);
    uni(1, 2, bad(null));
    uni(1, 3, bad(undefined));
    uni(1, 4, bad('1'));
    uni(1, 5, bad({}));
    uni(1, 6, bad([1, 2, 3]));
    tick(0);

    // Nothing throws and nothing is left dirty; a bad value reads as "off".
    // (NaN survives to the buffer write and Uint8Array coerces it to 0.)
    const buf = getUniverseBuffer(1);
    expect(Array.from(buf.slice(0, 6))).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it('does not throw when a whole scene is junk', () => {
    expect(() => {
      uni(1, 1, bad(undefined));
      uni(1, 2, bad({ queryArc: 'not a function' }));
      tick(0);
    }).not.toThrow();
  });
});

// ─── channel addressing ───────────────────────────────────────────────────────

describe('channel addressing (1-based)', () => {
  it('writes channel 1 to buffer index 0', () => {
    // The classic lighting off-by-one. DMX addresses are 1-based; the buffer
    // the bridge ships is 0-based.
    uni(1, 1, 1);
    tick(0);

    const buf = getUniverseBuffer(1);
    expect(buf[0]).toBe(255);
    expect(buf[1]).toBe(0);
    expect(nonZeroIndices(buf)).toEqual([0]);
  });

  it('writes channel 512 to buffer index 511, the last legal slot', () => {
    uni(1, 512, 1);
    tick(0);

    const buf = getUniverseBuffer(1);
    expect(buf).toHaveLength(512);
    expect(buf[511]).toBe(255);
    expect(nonZeroIndices(buf)).toEqual([511]);
  });

  it('silently ignores channel 0, 513 and negative channels', () => {
    uni(1, 0, 1);
    uni(1, 513, 1);
    uni(1, 9999, 1);
    uni(1, -5, 1);
    expect(() => tick(0)).not.toThrow();

    // Out-of-range defs are dropped at tick time: no wrap to index 511,
    // no write into a neighbouring channel, no exception.
    expect(nonZeroIndices(getUniverseBuffer(1))).toEqual([]);
  });

  it('does not even allocate a universe for an out-of-range-only def', () => {
    // The range check happens before getUniverse(), so universe 88 is never
    // created by this def alone.
    uni(88, 0, 1);
    tick(0);
    expect(getAllUniverses().has(88)).toBe(false);
  });
});

// ─── universes ────────────────────────────────────────────────────────────────

describe('universes', () => {
  it('creates a 512-byte buffer for a universe first seen at tick time', () => {
    expect(getAllUniverses().has(77)).toBe(false);

    uni(77, 1, 1);
    tick(0);

    const buf = getAllUniverses().get(77);
    expect(buf).toBeInstanceOf(Uint8Array);
    expect(buf).toHaveLength(512);
    expect(buf![0]).toBe(255);
  });

  it('keeps universes independent', () => {
    uni(3, 1, 1);
    uni(4, 2, 0.5);
    tick(0);

    const u3 = getUniverseBuffer(3);
    const u4 = getUniverseBuffer(4);
    expect(nonZeroIndices(u3)).toEqual([0]);
    expect(nonZeroIndices(u4)).toEqual([1]);
    expect(u3[0]).toBe(255);
    expect(u4[1]).toBe(128);
  });

  it('hands out the live buffer, not a copy, so the bridge reads through it', () => {
    const buf = getUniverseBuffer(5);
    uni(5, 1, 1);
    tick(0);

    expect(buf[0]).toBe(255);
    expect(getAllUniverses().get(5)).toBe(buf);
    expect(getUniverseBuffer(5)).toBe(buf);
  });

  it('allocates on read as well: getUniverseBuffer() never returns undefined', () => {
    expect(getAllUniverses().has(99)).toBe(false);
    const buf = getUniverseBuffer(99);
    expect(buf).toHaveLength(512);
    expect(getAllUniverses().has(99)).toBe(true);
  });

  it('snapshots the primary universe (0) as a plain number array', () => {
    uni(0, 1, 1);
    uni(0, 2, 0.5);
    tick(0);

    const snap = getPrimaryUniverseSnapshot();
    expect(Array.isArray(snap)).toBe(true);
    expect(snap).toHaveLength(512);
    expect(snap.slice(0, 3)).toEqual([255, 128, 0]);

    // The deprecated alias reads the same universe despite its name.
    expect(getUniverse1Snapshot()).toEqual(snap);
  });
});

// ─── zero-and-rebuild per tick ────────────────────────────────────────────────

describe('zero-and-rebuild per tick', () => {
  it('wipes the buffer before rebuilding, so stale bytes cannot survive', () => {
    const buf = getUniverseBuffer(1);
    buf[10] = 200; // stale byte from a previous frame / direct poke
    uni(1, 1, 1);
    tick(0);

    expect(buf[0]).toBe(255);
    expect(buf[10]).toBe(0);
  });

  it('drops channels that are no longer driven after a scene swap', () => {
    uni(1, 1, 1);
    tick(0);
    expect(getUniverseBuffer(1)[0]).toBe(255);

    // Stand-in for a scene swap: drop the old defs, register the new ones.
    // (evalCode() does this through the staging map; see below.)
    clearDefs();
    uni(1, 2, 1);
    tick(0);

    const buf = getUniverseBuffer(1);
    expect(buf[0]).toBe(0);
    expect(buf[1]).toBe(255);
    expect(nonZeroIndices(buf)).toEqual([1]);
  });

  it('lets a later def on the same channel replace the earlier one', () => {
    uni(1, 1, 1);
    uni(1, 1, 0.25); // same universe:channel key, so the last write wins
    tick(0);

    expect(getUniverseBuffer(1)[0]).toBe(64);
  });

  it('re-queries patterns every tick so values track the clock', () => {
    let v = 0;
    const moving: PatternLike = { queryArc: () => [{ value: v }] };
    uni(1, 1, moving);

    tick(0);
    expect(getUniverseBuffer(1)[0]).toBe(0);

    v = 1;
    tick(0.5);
    expect(getUniverseBuffer(1)[0]).toBe(255);

    v = 0;
    tick(0.75);
    expect(getUniverseBuffer(1)[0]).toBe(0);
  });
});

// ─── clearDefs ────────────────────────────────────────────────────────────────

describe('clearDefs()', () => {
  it('drops the definitions and leaves the buffers to the next tick', () => {
    uni(1, 1, 1);
    uni(2, 1, 1);
    tick(0);
    expect(getUniverseBuffer(1)[0]).toBe(255);
    expect(getUniverseBuffer(2)[0]).toBe(255);

    clearDefs();

    // The buffers still hold the last frame; clearDefs() does NOT zero them.
    // Clearing defs is a cheap, reversible bookkeeping step, so it must not
    // be able to darken live hardware on its own. Callers that want black
    // *now* (the stop/blackout path in the UI) zero the buffers themselves.
    expect(getUniverseBuffer(1)[0]).toBe(255);
    expect(getUniverseBuffer(2)[0]).toBe(255);

    // Nothing is driven any more, so the next tick zeroes them and there is
    // nothing to write back.
    tick(0);
    expect(nonZeroIndices(getUniverseBuffer(1))).toEqual([]);
    expect(nonZeroIndices(getUniverseBuffer(2))).toEqual([]);
  });

  it('keeps the universe entries themselves so the bridge keeps sending zeros', () => {
    uni(6, 1, 1);
    tick(0);
    clearDefs();

    expect(getAllUniverses().has(6)).toBe(true);
    expect(getAllUniverses().get(6)).toHaveLength(512);
  });

  it('supports the blackout path: clear defs, zero buffers, stay dark', () => {
    // What runStop() does when stopAction is 'blackout'. No tick follows,
    // because the scheduler is stopped, so the explicit fill(0) is what
    // darkens the outputs and the cleared defs are what keep them dark.
    uni(1, 1, 1);
    uni(1, 5, 0.5);
    tick(0);

    clearDefs();
    for (const buf of getAllUniverses().values()) buf.fill(0);

    expect(nonZeroIndices(getUniverseBuffer(1))).toEqual([]);
    tick(0.5);
    expect(nonZeroIndices(getUniverseBuffer(1))).toEqual([]);
  });
});

// ─── staged scene swap ────────────────────────────────────────────────────────

describe('staging', () => {
  it('routes writes to the scratch scene, leaving the live one driving', () => {
    uni(1, 1, 1);
    tick(0);
    expect(getUniverseBuffer(1)[0]).toBe(255);

    beginStaging();
    uni(1, 2, 1);

    // Mid-staging ticks still resolve the OLD scene; the staged channel is
    // invisible until it is committed.
    tick(0);
    const buf = getUniverseBuffer(1);
    expect(buf[0]).toBe(255);
    expect(buf[1]).toBe(0);
    expect(nonZeroIndices(buf)).toEqual([0]);
  });

  it('replaces the live scene wholesale on commit', () => {
    uni(1, 1, 1);
    tick(0);

    beginStaging();
    uni(1, 2, 1);
    commitStaging();
    tick(0);

    // The staged scene REPLACES rather than merges: channel 1 is gone
    // because the new scene never mentioned it.
    const buf = getUniverseBuffer(1);
    expect(buf[0]).toBe(0);
    expect(buf[1]).toBe(255);
    expect(nonZeroIndices(buf)).toEqual([1]);
  });

  it('throws the scratch scene away on abort', () => {
    uni(1, 1, 1);
    tick(0);

    beginStaging();
    uni(1, 2, 1);
    uni(1, 3, 1);
    abortStaging();
    tick(0);

    const buf = getUniverseBuffer(1);
    expect(buf[0]).toBe(255);
    expect(nonZeroIndices(buf)).toEqual([0]);
  });

  it('sends writes back to the live scene once staging ends', () => {
    beginStaging();
    uni(1, 1, 1);
    abortStaging();

    uni(1, 2, 1);
    tick(0);

    expect(nonZeroIndices(getUniverseBuffer(1))).toEqual([1]);
  });

  it('commits an empty staged scene as an empty scene, not a no-op', () => {
    // An empty scene is a legitimate edit ("comment everything out and run").
    uni(1, 1, 1);
    tick(0);

    beginStaging();
    commitStaging();
    tick(0);

    expect(nonZeroIndices(getUniverseBuffer(1))).toEqual([]);
  });

  it('ignores a commit with nothing staged', () => {
    uni(1, 1, 1);
    commitStaging();
    tick(0);

    expect(getUniverseBuffer(1)[0]).toBe(255);
  });
});

// ─── transactional eval ───────────────────────────────────────────────────────
// An eval that does not complete must leave the rig running what it was
// running before. These drive evalCode() rather than the staging primitives
// directly, because the ordering inside evalCode (compile first, stage, commit
// last) is the part that has to hold.
//
// No strudel here: these scenes use plain numbers, which is all dmx.ts needs.
// Patterns are covered above.

describe('transactional eval', () => {
  it('swaps the scene atomically on success', () => {
    expect(evalCode('uni(1, 1, 1)').success).toBe(true);
    tick(0);
    expect(nonZeroIndices(getUniverseBuffer(1))).toEqual([0]);

    expect(evalCode('uni(1, 2, 1)').success).toBe(true);
    tick(0);

    // Fully the new scene, nothing of the old one.
    const buf = getUniverseBuffer(1);
    expect(buf[0]).toBe(0);
    expect(buf[1]).toBe(255);
    expect(nonZeroIndices(buf)).toEqual([1]);
  });

  it('leaves the previous scene running when the new code will not parse', () => {
    evalCode('uni(1, 1, 1)');
    tick(0);
    expect(getUniverseBuffer(1)[0]).toBe(255);

    // A stray paren: the everyday typo.
    const result = evalCode('uni(1, 2, 1');
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();

    // Nothing was cleared, so the rig is still lit BEFORE any further tick.
    // This is the case that used to drive the whole rig to black.
    expect(getUniverseBuffer(1)[0]).toBe(255);

    tick(0.25);
    expect(nonZeroIndices(getUniverseBuffer(1))).toEqual([0]);
  });

  it('leaves the previous scene running when the new code throws mid-file', () => {
    evalCode('uni(1, 1, 1); uni(1, 2, 1)');
    tick(0);
    expect(nonZeroIndices(getUniverseBuffer(1))).toEqual([0, 1]);

    // Parses fine, registers one channel, then dies. Neither half of that
    // survives: not the channel it managed to write, and not the loss of the
    // channels it never reached.
    const result = evalCode('uni(1, 10, 1); nope(); uni(1, 11, 1)');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/nope/);

    tick(0.5);
    const buf = getUniverseBuffer(1);
    expect(buf[0]).toBe(255);
    expect(buf[1]).toBe(255);
    expect(buf[9]).toBe(0);
    expect(nonZeroIndices(buf)).toEqual([0, 1]);
  });

  it('keeps fixture writes inside the transaction too', () => {
    // Fixtures are a naming layer over uni(), so they have to stage with it.
    evalCode("fixture(1, 'rgb', 7).color(1, 1, 1)");
    tick(0);
    expect(nonZeroIndices(getUniverseBuffer(7))).toEqual([0, 1, 2]);

    const result = evalCode("fixture(20, 'rgb', 7).color(1, 1, 1); boom()");
    expect(result.success).toBe(false);

    tick(0);
    expect(nonZeroIndices(getUniverseBuffer(7))).toEqual([0, 1, 2]);
  });

  it('recovers: a good eval after a failed one still swaps', () => {
    evalCode('uni(1, 1, 1)');
    expect(evalCode('uni(1, 2,').success).toBe(false);
    expect(evalCode('uni(1, 3, 1); boom()').success).toBe(false);

    expect(evalCode('uni(1, 4, 1)').success).toBe(true);
    tick(0);

    // Neither failed attempt left anything behind in the staging map.
    expect(nonZeroIndices(getUniverseBuffer(1))).toEqual([3]);
  });

  it('reports the error message rather than throwing out of evalCode', () => {
    expect(() => evalCode('this is not javascript at all {{{')).not.toThrow();
    expect(() => evalCode('throw new Error("scene exploded")')).not.toThrow();
    expect(evalCode('throw new Error("scene exploded")').error).toBe('scene exploded');
  });
});

// ─── patterns ─────────────────────────────────────────────────────────────────

describe('pattern values', () => {
  it('scales the first hap value like a 0-1 float', () => {
    uni(1, 1, stubPattern(0.5));
    uni(1, 2, stubPattern(1));
    uni(1, 3, stubPattern(0));
    tick(0);

    const buf = getUniverseBuffer(1);
    expect(Array.from(buf.slice(0, 3))).toEqual([128, 255, 0]);
  });

  it('queries a thin arc at the current cycle position', () => {
    const calls: Array<[number, number]> = [];
    uni(1, 1, stubPattern(1, calls));

    tick(0.25);

    expect(calls).toHaveLength(1);
    const [begin, end] = calls[0];
    expect(begin).toBe(0.25);
    expect(end).toBeCloseTo(0.2501, 10);
    expect(end).toBeGreaterThan(begin);
  });

  it('reads 0 when the pattern yields no haps', () => {
    uni(1, 1, silentPattern);
    tick(0);
    expect(getUniverseBuffer(1)[0]).toBe(0);
  });

  it('reads 0 when the hap value is not a number', () => {
    uni(1, 1, stubPattern('bright'));
    uni(1, 2, stubPattern(null));
    uni(1, 3, stubPattern({ n: 1 }));
    tick(0);

    expect(Array.from(getUniverseBuffer(1).slice(0, 3))).toEqual([0, 0, 0]);
  });

  it('uses the first hap when the arc returns several', () => {
    const multi: PatternLike = {
      queryArc: () => [{ value: 1 }, { value: 0 }],
    };
    uni(1, 1, multi);
    tick(0);
    expect(getUniverseBuffer(1)[0]).toBe(255);
  });

  it('mixes static numbers and patterns in the same frame', () => {
    uni(1, 1, 1);
    uni(1, 2, stubPattern(0.5));
    uni(1, 3, 64);
    tick(0);

    expect(Array.from(getUniverseBuffer(1).slice(0, 3))).toEqual([255, 128, 64]);
  });
});

// ─── pattern query failures ───────────────────────────────────────────────────
// A pattern's body runs at QUERY time, so a scene that evaluated without
// throwing can still throw on every tick afterwards. Before this was guarded, that throw
// escaped tick() with the buffers already zeroed and half-rewritten, and the
// caller never got to send the frame, so the rig latched its last look while
// the status bar still read "running". These pin the containment.

function spyConsoleError() {
  return vi.spyOn(console, 'error').mockImplementation(() => {});
}

describe('pattern query failures', () => {
  let errSpy: ReturnType<typeof spyConsoleError>;

  beforeEach(() => {
    errSpy = spyConsoleError();
  });

  afterEach(() => {
    errSpy.mockRestore();
  });

  it('resolves the rest of the frame when one pattern throws', () => {
    uni(1, 1, 1);
    uni(1, 2, throwingPattern());
    uni(1, 3, stubPattern(0.5));
    uni(1, 4, 64);

    expect(() => tick(0)).not.toThrow();

    // Channels registered before AND after the thrower still resolve; only
    // the throwing one is dark.
    const buf = getUniverseBuffer(1);
    expect(Array.from(buf.slice(0, 4))).toEqual([255, 0, 128, 64]);
  });

  it('darkens a channel that starts throwing after it was lit', () => {
    let broken = false;
    const flaky: PatternLike = {
      queryArc() {
        if (broken) throw new Error('gone bad');
        return [{ value: 1 }];
      },
    };
    uni(1, 1, flaky);
    uni(1, 2, 1);

    tick(0);
    expect(getUniverseBuffer(1)[0]).toBe(255);

    broken = true;
    tick(0.5);

    const buf = getUniverseBuffer(1);
    expect(buf[0]).toBe(0);   // the thrower goes dark
    expect(buf[1]).toBe(255); // everything else keeps running
  });

  it('reports a repeat offender once, not once per tick', () => {
    uni(1, 1, throwingPattern());
    for (let i = 0; i < 60; i++) tick(i / 60);

    // One console line and one failure entry for sixty throws.
    expect(errSpy).toHaveBeenCalledTimes(1);
    const failures = getQueryFailures();
    expect(failures).toHaveLength(1);
    expect(failures[0].universe).toBe(1);
    expect(failures[0].channel).toBe(1);
    expect(failures[0].message).toBe('pattern exploded');
    // The tick count is what distinguishes "reported once" from "failed once".
    expect(failures[0].ticks).toBe(60);
  });

  it('bumps the change counter only when a new channel starts failing', () => {
    uni(1, 1, throwingPattern());
    const before = getQueryFailureGeneration();

    tick(0);
    const afterFirst = getQueryFailureGeneration();
    expect(afterFirst).not.toBe(before);

    // Same def still throwing, so nothing new to tell the operator.
    tick(0.1);
    tick(0.2);
    expect(getQueryFailureGeneration()).toBe(afterFirst);

    // A second broken channel is new information.
    uni(1, 2, throwingPattern('second failure'));
    tick(0.3);
    expect(getQueryFailureGeneration()).not.toBe(afterFirst);
    expect(getQueryFailures()).toHaveLength(2);
  });

  it('identifies each failing channel separately, including its universe', () => {
    uni(2, 5, throwingPattern('first'));
    uni(3, 9, throwingPattern('second'));
    tick(0);

    const failures = getQueryFailures();
    expect(failures).toHaveLength(2);
    expect(failures.map((f) => `${f.universe}:${f.channel}`)).toEqual(['2:5', '3:9']);
    expect(failures.map((f) => f.message)).toEqual(['first', 'second']);
  });

  it('survives a value whose queryArc probe itself throws', () => {
    // isPattern() reads .queryArc off the value, so a throwing getter fails
    // before the call is ever made, outside the obvious guard.
    const trap = bad(Object.defineProperty({}, 'queryArc', {
      get() { throw new Error('trapped getter'); },
    }));
    uni(1, 1, trap);
    uni(1, 2, 1);

    expect(() => tick(0)).not.toThrow();
    expect(Array.from(getUniverseBuffer(1).slice(0, 2))).toEqual([0, 255]);
    expect(getQueryFailures()).toHaveLength(1);
  });

  it('survives a thrown value that cannot be stringified', () => {
    const hostile: PatternLike = {
      queryArc() {
        throw Object.defineProperty({}, 'toString', {
          get() { throw new Error('nope'); },
        });
      },
    };
    uni(1, 1, hostile);

    expect(() => tick(0)).not.toThrow();
    expect(getQueryFailures()[0].message).toBe('unknown error');
  });

  it('forgets failures when a new scene is committed', () => {
    uni(1, 1, throwingPattern());
    tick(0);
    expect(getQueryFailures()).toHaveLength(1);

    // The fix: re-evaluate with a scene that doesn't throw.
    beginStaging();
    uni(1, 1, 1);
    commitStaging();

    expect(getQueryFailures()).toEqual([]);
    tick(0.5);
    expect(getQueryFailures()).toEqual([]);
    expect(getUniverseBuffer(1)[0]).toBe(255);
  });

  it('forgets failures when the defs are dropped', () => {
    uni(1, 1, throwingPattern());
    tick(0);
    expect(getQueryFailures()).toHaveLength(1);

    clearDefs();
    expect(getQueryFailures()).toEqual([]);
  });
});

// ─── ch / dim / rgb helpers ───────────────────────────────────────────────────

describe('ch / dim / rgb', () => {
  it('ch() and dim() write universe 1', () => {
    ch(1, 1);
    dim(2, 0.5);
    tick(0);

    const buf = getUniverseBuffer(1);
    expect(buf[0]).toBe(255);
    expect(buf[1]).toBe(128);
    // fixture() defaults to universe 0, ch() to universe 1; see the fixture
    // tests below. Universe 0 stays untouched here.
    expect(nonZeroIndices(getUniverseBuffer(0))).toEqual([]);
  });

  it('rgb() writes three consecutive channels from the start address', () => {
    rgb(10, 1, 0.5, 0);
    tick(0);

    const buf = getUniverseBuffer(1);
    expect(Array.from(buf.slice(9, 13))).toEqual([255, 128, 0, 0]);
    expect(nonZeroIndices(buf)).toEqual([9, 10]);
  });

  it('rgb() at the top of the universe drops the channels that overflow', () => {
    rgb(511, 1, 1, 1); // 511, 512, 513: the last one has nowhere to go
    expect(() => tick(0)).not.toThrow();

    const buf = getUniverseBuffer(1);
    expect(buf[510]).toBe(255);
    expect(buf[511]).toBe(255);
    expect(nonZeroIndices(buf)).toEqual([510, 511]);
  });
});

// ─── fixture channel mapping ──────────────────────────────────────────────────

describe('fixture channel mapping', () => {
  it('maps an rgb fixture at start channel N onto N, N+1, N+2', () => {
    const par = fixture(10, 'rgb');
    // Named accessors: the shape user code writes.
    setter(par, 'red')(1);
    setter(par, 'green')(0.5);
    setter(par, 'blue')(0);
    tick(0);

    // Fixtures default to universe 0.
    const buf = getUniverseBuffer(0);
    expect(Array.from(buf.slice(8, 14))).toEqual([0, 255, 128, 0, 0, 0]);
    expect(nonZeroIndices(buf)).toEqual([9, 10]);
  });

  it('maps an rgbw fixture, offset K → channel N+K, in the given universe', () => {
    const par = fixture(5, 'rgbw', 2);
    par.set('red', 1);
    par.set('green', 64);
    par.set('blue', 0.25);
    par.set('white', 0.5);
    tick(0);

    const buf = getUniverseBuffer(2);
    // start channel 5 → buffer index 4; offsets 0..3 → indices 4..7.
    expect(Array.from(buf.slice(3, 9))).toEqual([0, 255, 64, 64, 128, 0]);
    expect(nonZeroIndices(buf)).toEqual([4, 5, 6, 7]);
    // Nothing bled into the default universe.
    expect(nonZeroIndices(getUniverseBuffer(0))).toEqual([]);
  });

  it('maps every channel of a multi-channel moving head', () => {
    const head = fixture(100, 'moving-head-basic');
    head.set('pan', 1);
    head.set('tilt', 0.5);
    head.set('dim', 1);
    head.set('strobe', 0);
    head.set('red', 255);
    head.set('green', 0);
    head.set('blue', 128);
    head.set('white', 0.25);
    tick(0);

    const buf = getUniverseBuffer(0);
    // Channels 100..107 → indices 99..106.
    expect(Array.from(buf.slice(99, 107))).toEqual([255, 128, 255, 0, 255, 0, 128, 64]);
    expect(buf[98]).toBe(0);
    expect(buf[107]).toBe(0);
  });

  it('drives patterns through named channel setters', () => {
    const par = fixture(1, 'rgb');
    expect(par.channels()).toEqual(['red', 'green', 'blue']);
    setter(par, 'red')(stubPattern(1));
    setter(par, 'blue')(stubPattern(0.25));
    tick(0);

    expect(Array.from(getUniverseBuffer(0).slice(0, 3))).toEqual([255, 0, 64]);
  });

  it('resolves legacy fixture ids to the same addresses', () => {
    const par = fixture(20, 'generic-rgbw');
    par.set('white', 1);
    tick(0);

    // white is offset 3 → channel 23 → index 22.
    expect(nonZeroIndices(getUniverseBuffer(0))).toEqual([22]);
  });

  it('throws on an unknown channel name instead of writing somewhere wrong', () => {
    const par = fixture(1, 'rgb');
    expect(() => par.set('amber', 1)).toThrow(/no channel "amber"/);
  });

  it('color() covers the channels a fixture has', () => {
    const par = fixture(1, 'rgb', 3);
    par.color(1, 0.5, 0, 1); // white arg ignored: no white channel on rgb
    tick(0);

    const buf = getUniverseBuffer(3);
    expect(Array.from(buf.slice(0, 4))).toEqual([255, 128, 0, 0]);
  });

  it('off() zeroes light channels but leaves position channels standing', () => {
    const head = fixture(1, 'moving-head-basic', 4);
    head.set('pan', 1);
    head.set('tilt', 1);
    head.set('dim', 1);
    head.set('red', 1);
    head.off();
    tick(0);

    const buf = getUniverseBuffer(4);
    expect(buf[0]).toBe(255); // pan held
    expect(buf[1]).toBe(255); // tilt held
    expect(buf[2]).toBe(0);   // dim killed
    expect(buf[4]).toBe(0);   // red killed
  });

  it('full() drives every light-emitting channel to 255', () => {
    const par = fixture(1, 'dim-rgbw', 5);
    par.full();
    tick(0);

    const buf = getUniverseBuffer(5);
    expect(Array.from(buf.slice(0, 6))).toEqual([255, 255, 255, 255, 255, 0]);
  });
});
