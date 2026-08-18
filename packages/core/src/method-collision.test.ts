/**
 * A channel must not take a generic method's name away from it.
 *
 * The docs recommend calling a colour wheel's channel `color`, and the loop
 * that attaches named setters ran after the instance literal, so that def
 * overwrote the r,g,b mixer. `head.color(1, 0, 0)` then reached the
 * one-argument channel setter: it drove the wheel to DMX 255, dropped the
 * green and blue arguments, left the red emitter dark, and did not throw. A
 * scene that said "go red" turned the wheel instead.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { defineFixture, fixture } from './fixtures.js';
import { tick, clearDefs, getUniverseBuffer } from './dmx.js';

beforeEach(() => {
  clearDefs();
  getUniverseBuffer(0).fill(0);
});

/** Channels 1..4 after a tick. */
function channels(): number[] {
  tick(0);
  return Array.from(getUniverseBuffer(0).slice(0, 4));
}

defineFixture('wheel-and-emitters', {
  name: 'Wheel and emitters', manufacturer: 'test', type: 'moving-head', channelCount: 4,
  channels: [
    { offset: 0, name: 'dim', type: 'intensity' },
    { offset: 1, name: 'red', type: 'color' },
    { offset: 2, name: 'green', type: 'color' },
    { offset: 3, name: 'color', type: 'color', slots: [
      { name: 'open', value: 0 },
      { name: 'red', from: 10, to: 19 },
    ] },
  ],
});

describe('a channel named after a generic method', () => {
  it('does not take the r,g,b mixer', () => {
    const head = fixture(1, 'wheel-and-emitters');
    head.color(1, 0, 0);
    // Red emitter lit, wheel untouched. Before: [0, 0, 0, 255].
    expect(channels()).toEqual([0, 255, 0, 0]);
  });

  it('is still reachable by slot name through the same verb', () => {
    const head = fixture(1, 'wheel-and-emitters');
    head.color('red');
    expect(channels()).toEqual([0, 0, 0, 15]);
  });

  it('is still reachable through set()', () => {
    const head = fixture(1, 'wheel-and-emitters');
    head.set('color', 'red');
    expect(channels()).toEqual([0, 0, 0, 15]);
  });

  it('reports an unknown slot against the call that was made', () => {
    const head = fixture(1, 'wheel-and-emitters');
    expect(() => head.color('nope')).toThrow(/\.color\(\): no slot named "nope"\. Available: open, red\./);
  });

  it('leaves other generic methods alone', () => {
    // `off` and `full` drive every emitter. A def that named a channel `off`
    // used to replace the method with a setter that returns undefined.
    defineFixture('off-named-channel', {
      name: 'Awkward', manufacturer: 'test', type: 'generic', channelCount: 2,
      channels: [
        { offset: 0, name: 'red', type: 'color' },
        { offset: 1, name: 'off', type: 'control' },
      ],
    });
    const odd = fixture(1, 'off-named-channel');
    expect(typeof odd.off).toBe('function');
    odd.full();
    expect(channels()[0]).toBe(255);
    clearDefs();
    getUniverseBuffer(0).fill(0);
    // The channel itself is still addressable, just not as a method.
    odd.set('off', 1);
    expect(channels()[1]).toBe(255);
  });

  it('does not dispatch a slot name on a fixture with no such channel', () => {
    // A plain RGB par has no wheel, so a string is not a slot name and the
    // mixer must reject it rather than quietly picking something.
    const par = fixture(10, 'rgb');
    expect(() => (par.color as (v: unknown) => void)('red')).toThrow();
  });
});
