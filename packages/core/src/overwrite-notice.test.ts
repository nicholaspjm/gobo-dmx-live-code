/**
 * Saying when a run set one channel more than once.
 *
 * Last write wins, and that stays. A scene is imperative and two calls to one
 * channel are an assignment followed by another assignment; a lighting desk
 * would take the higher of the two, but a desk is not running somebody's
 * JavaScript, where a silent max would be stranger than a silent overwrite.
 *
 * What it should not be is invisible. The shape that makes it bite is two
 * looks over one rig — verse(); chorus() — where the channels they share come
 * out as whatever the later look said, the earlier one silently gone, with a
 * green status bar over the top.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  uni,
  beginStaging,
  commitStaging,
  clearDefs,
  claimChannels,
  clearPatchClaims,
  getOverwrittenChannels,
  patchAt,
} from './dmx.js';

beforeEach(() => {
  clearDefs();
  clearPatchClaims();
  beginStaging();
});

/** The channels a staged run collided on. */
function collisions(): Array<{ channel: number; times: number }> {
  return getOverwrittenChannels().map((c) => ({ channel: c.channel, times: c.times }));
}

describe('counting channels set more than once', () => {
  it('says nothing when every channel is set once', () => {
    uni(1, 1, 1);
    uni(1, 2, 0.5);
    expect(collisions()).toEqual([]);
  });

  it('notes a channel set twice with different values', () => {
    uni(1, 1, 1);
    uni(1, 1, 0.5);
    expect(collisions()).toEqual([{ channel: 1, times: 1 }]);
  });

  it('counts each later write, not each write', () => {
    uni(1, 1, 1);
    uni(1, 1, 0.5);
    uni(1, 1, 0.2);
    expect(collisions()).toEqual([{ channel: 1, times: 2 }]);
  });

  it('ignores a rewrite that changes nothing', () => {
    // Setting a channel to what it already holds is not worth telling anyone.
    uni(1, 1, 0.5);
    uni(1, 1, 0.5);
    expect(collisions()).toEqual([]);
  });

  it('keeps universes apart', () => {
    uni(1, 1, 1);
    uni(2, 1, 0.5);
    expect(collisions()).toEqual([]);
  });

  it('is the shape two looks over one rig makes', () => {
    // verse() sets the wash red; chorus() sets it blue. Red is replaced, not
    // added to, and the run should be able to say so.
    const verse = (): void => { uni(1, 1, 1); uni(1, 2, 0); };
    const chorus = (): void => { uni(1, 1, 0); uni(1, 3, 1); };
    verse();
    chorus();
    expect(collisions()).toEqual([{ channel: 1, times: 1 }]);
  });

  it('starts empty for each run rather than accumulating', () => {
    uni(1, 1, 1);
    uni(1, 1, 0.5);
    expect(collisions()).toHaveLength(1);
    commitStaging();
    beginStaging();
    uni(1, 1, 1);
    expect(collisions()).toEqual([]);
  });
});

describe('naming the light on a channel', () => {
  it('names the patched light covering a channel, with its address', () => {
    // The address is carried because the label is the constructor as written:
    // two strips are both "rgbStrip()" and only the address tells them apart.
    claimChannels(1, 5, 4, 'rgbStrip()');
    expect(patchAt(1, 5)).toEqual({ label: 'rgbStrip()', start: 5 });
    expect(patchAt(1, 8)).toEqual({ label: 'rgbStrip()', start: 5 });
  });

  it('tells two lights of the same kind apart', () => {
    claimChannels(1, 1, 4, 'rgbStrip()');
    claimChannels(1, 20, 4, 'rgbStrip()');
    expect(patchAt(1, 2)?.start).toBe(1);
    expect(patchAt(1, 21)?.start).toBe(20);
  });

  it('has no name for a channel nothing is patched over', () => {
    claimChannels(1, 5, 4, 'wash');
    expect(patchAt(1, 9)).toBeNull();
    expect(patchAt(2, 5)).toBeNull();
  });
});
