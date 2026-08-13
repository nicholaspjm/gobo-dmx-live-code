/**
 * Patch-address validation for fixture().
 *
 * Addressing mistakes are the most common patching error in lighting, and
 * they used to fail silently: a fixture patched near the top of a universe
 * lost its overflow channels, and a start channel below 1 wrote to the
 * wrong place. Both look like broken hardware, so these tests pin the
 * throw-with-the-address contract rgbStrip / rgbwStrip already had, and pin
 * that a rejected patch writes nothing and registers nothing.
 *
 * Channel-mapping behaviour for valid patches lives in dmx.test.ts.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { ch, tick, clearDefs, getUniverseBuffer } from './dmx.js';

import {
  fixture,
  defineFixture,
  clearSimFixtures,
  getSimFixtures,
} from './fixtures.js';

// Both modules hold registry state at module level, so every test starts
// from a clean slate.
beforeEach(() => {
  clearDefs();
  clearSimFixtures();
});

// ─── universe overrun ─────────────────────────────────────────────────────────

describe('fixture() start-channel range', () => {
  it('accepts a fixture whose last channel is exactly 512', () => {
    // moving-head-basic is 8 channels: 505..512 is the tightest legal patch.
    const head = fixture(505, 'moving-head-basic');
    head.set('white', 1);
    tick(0);

    // white is offset 7 → channel 512 → index 511, the last byte.
    expect(getUniverseBuffer(0)[511]).toBe(255);
  });

  it('throws when the fixture would run past channel 512', () => {
    expect(() => fixture(506, 'moving-head-basic')).toThrow(
      /would run to channel 513, which exceeds 512 by 1/,
    );
  });

  it('names the fixture, its address, and the overrun in the message', () => {
    // 12-channel spot at 510 → runs to 521, i.e. 9 channels of overflow.
    expect(() => fixture(510, 'moving-head-spot')).toThrow(
      /"moving-head-spot" \(12 channels\) starting at 510 would run to channel 521, which exceeds 512 by 9/,
    );
  });

  it('reports the id the user actually wrote, including legacy aliases', () => {
    expect(() => fixture(511, 'generic-rgbw')).toThrow(/"generic-rgbw"/);
  });

  it('rejects an overrunning patch outright instead of clamping it', () => {
    // The old behaviour wrote the channels that fit and dropped the rest,
    // which is the failure mode this guard exists to kill.
    expect(() => fixture(511, 'rgbw')).toThrow();
    tick(0);

    const buf = getUniverseBuffer(0);
    expect(Array.from(buf.slice(508, 512))).toEqual([0, 0, 0, 0]);
  });

  it('does not register a rejected patch with the sim panel', () => {
    expect(() => fixture(511, 'rgbw')).toThrow();
    expect(getSimFixtures()).toHaveLength(0);
  });

  it('takes the overrun from the definition, not the declared channels', () => {
    // A def may reserve more channels than it names (spare / unused slots).
    // The reservation is what has to fit, so the guard uses channelCount.
    defineFixture('sparse-16ch', {
      name: 'Sparse 16ch',
      manufacturer: 'Test',
      type: 'generic',
      channelCount: 16,
      channels: [
        { offset: 0, name: 'dim', type: 'intensity' },
      ],
    });

    expect(() => fixture(500, 'sparse-16ch')).toThrow(/exceeds 512 by 3/);
    expect(() => fixture(497, 'sparse-16ch')).not.toThrow();
  });
});

describe('fixture() start-channel validity', () => {
  it('throws on a start channel below 1', () => {
    expect(() => fixture(0, 'rgb')).toThrow(
      /startChannel must be an integer >= 1 \(got 0\)/,
    );
    expect(() => fixture(-4, 'rgb')).toThrow(/startChannel must be an integer >= 1/);
  });

  it('throws on a non-integer or non-finite start channel', () => {
    expect(() => fixture(1.5, 'rgb')).toThrow(/startChannel must be an integer >= 1/);
    expect(() => fixture(NaN, 'rgb')).toThrow(/startChannel must be an integer >= 1/);
    expect(() => fixture(Infinity, 'rgb')).toThrow(/startChannel must be an integer >= 1/);
  });
});

// ─── universe argument ────────────────────────────────────────────────────────

describe('fixture() universe argument', () => {
  it('accepts universe 0 (the Art-Net default) and any positive integer', () => {
    expect(() => fixture(1, 'rgb')).not.toThrow();
    expect(() => fixture(1, 'rgb', 0)).not.toThrow();
    expect(() => fixture(1, 'rgb', 7)).not.toThrow();
  });

  it('throws on a negative or non-integer universe', () => {
    expect(() => fixture(1, 'rgb', -1)).toThrow(
      /universe must be a non-negative integer \(got -1\)/,
    );
    expect(() => fixture(1, 'rgb', 1.5)).toThrow(/universe must be a non-negative integer/);
    expect(() => fixture(1, 'rgb', NaN)).toThrow(/universe must be a non-negative integer/);
  });
});

// ─── failure containment ──────────────────────────────────────────────────────

describe('fixture() patch failures', () => {
  it('leaves already-patched output untouched when a later patch is rejected', () => {
    // The throw propagates to evalCode(), which reports it in the error
    // banner. It must not corrupt the channels the scene already set.
    ch(1, 1);
    expect(() => fixture(600, 'rgb')).toThrow();
    tick(0);

    expect(getUniverseBuffer(1)[0]).toBe(255);
  });

  it('still reports an unknown fixture id ahead of any address complaint', () => {
    // Getting "unknown fixture" for a typo is more useful than being told
    // the address is wrong for a fixture that doesn't exist.
    expect(() => fixture(0, 'no-such-fixture')).toThrow(/Unknown fixture "no-such-fixture"/);
  });
});
