/**
 * Tests for live controls.
 *
 * Two properties carry the whole feature, and both are easy to lose:
 *
 *   moving a control changes the light with no re-evaluation, because a
 *   re-run mid-show is a visible seam
 *
 *   a control someone has moved keeps its position across an edit, because
 *   snapping every handle back to what the source says on every run would
 *   make it useless during a show
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { tick, clearDefs, getUniverseBuffer, uni } from './dmx.js';
import {
  slider,
  clearControls,
  getControls,
  getControlValue,
  setControlValue,
  resetControls,
} from './controls.js';

beforeEach(() => {
  clearDefs();
  clearControls();
  resetControls();
  getUniverseBuffer(1).fill(0);
});

/** Channel 1 of universe 1 after a tick. */
function level(): number {
  tick(0);
  return getUniverseBuffer(1)[0];
}

describe('declaring a control', () => {
  it('registers it with its range, in source order', () => {
    slider('a');
    slider('b', 1, 16, { step: 1, start: 4 });
    expect(getControls()).toEqual([
      { name: 'a', min: 0, max: 1, initial: 0, step: 0 },
      { name: 'b', min: 1, max: 16, initial: 4, step: 1 },
    ]);
  });

  it('starts at the low end unless told otherwise', () => {
    slider('a');
    expect(getControlValue('a')).toBe(0);
    slider('b', 0, 1, { start: 0.75 });
    expect(getControlValue('b')).toBe(0.75);
  });

  it('clamps a start outside the range rather than accepting it', () => {
    slider('a', 0, 1, { start: 5 });
    expect(getControlValue('a')).toBe(1);
  });

  it('refuses two controls with one name', () => {
    // They would share a position and fight over it, each redrawing the
    // other's handle.
    slider('a');
    expect(() => slider('a')).toThrow(/already declared/);
  });

  it('refuses a range that is not one', () => {
    expect(() => slider('a', 1, 1)).toThrow(/must be below max/);
    expect(() => slider('a', 5, 2)).toThrow(/must be below max/);
  });

  it('refuses a nameless control', () => {
    expect(() => slider('')).toThrow(/needs a name/);
    expect(() => slider('   ')).toThrow(/needs a name/);
  });
});

describe('moving a control', () => {
  it('changes the channel without anything being re-evaluated', () => {
    uni(1, 1, slider('level'));
    expect(level()).toBe(0);

    setControlValue('level', 0.5);
    expect(level()).toBe(128);

    setControlValue('level', 1);
    expect(level()).toBe(255);
  });

  it('clamps to the declared range', () => {
    uni(1, 1, slider('level'));
    setControlValue('level', 99);
    expect(level()).toBe(255);
    setControlValue('level', -99);
    expect(level()).toBe(0);
  });

  it('ignores a value that is not a number', () => {
    uni(1, 1, slider('level', 0, 1, { start: 0.5 }));
    setControlValue('level', NaN);
    setControlValue('level', Infinity);
    expect(level()).toBe(128);
  });

  it('keeps controls apart', () => {
    uni(1, 1, slider('a'));
    uni(1, 2, slider('b'));
    setControlValue('a', 1);
    tick(0);
    expect(Array.from(getUniverseBuffer(1).slice(0, 2))).toEqual([255, 0]);
  });
});

describe('a control survives the scene being re-run', () => {
  it('keeps a position someone set, rather than snapping back to the source', () => {
    // The scene runs, someone turns it up, then they edit a line elsewhere
    // and run again. The level they set has to still be there.
    clearControls();
    uni(1, 1, slider('level', 0, 1, { start: 0.1 }));
    setControlValue('level', 0.8);
    expect(level()).toBe(204);

    clearDefs();
    clearControls();                                  // what evalCode does
    uni(1, 1, slider('level', 0, 1, { start: 0.1 })); // the same line, re-run
    expect(level()).toBe(204);
  });

  it('re-declares the entry each run, so a changed range takes effect', () => {
    clearControls();
    slider('level', 0, 1);
    clearControls();
    slider('level', 0, 16, { step: 1 });
    expect(getControls()).toEqual([
      { name: 'level', min: 0, max: 16, initial: 0, step: 1 },
    ]);
  });

  it('re-clamps a kept position into a range that has since narrowed', () => {
    clearControls();
    slider('level', 0, 16);
    setControlValue('level', 12);
    clearControls();
    slider('level', 0, 1);
    // The stored 12 is out of the new range; the next move brings it back in.
    setControlValue('level', 12);
    expect(getControlValue('level')).toBe(1);
  });

  it('forgets everything only when told to', () => {
    slider('level', 0, 1, { start: 0.2 });
    setControlValue('level', 0.9);
    resetControls();
    expect(getControlValue('level')).toBeNull();
  });
});
