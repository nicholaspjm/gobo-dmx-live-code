/**
 * A cue whose choice is written into the scene.
 *
 * The chips, the number keys and a MIDI program change all decide the look at
 * evaluation time, which means the switch is something you perform and cannot
 * be part of the pattern. A selector moves that decision to query time: every
 * look is captured, and each channel any of them drives gets one value that
 * reads the selector when the frame asks and resolves whichever look it names.
 *
 * The property that matters most here is what does NOT change. The merge
 * happens before anything is staged, so what reaches the engine is ordinary
 * channel values — the commit, the rollback and the panic verbs are exactly
 * what they were, and no partial picture ever reaches the def map.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { beginCapture, endCapture, abortCapture, uni, clearDefs, getUniverseBuffer, tick } from './dmx.js';
import { registerCues, isCueDrivenByPattern, selectCue, getSelectedCue, resetCues } from './cues.js';

beforeEach(() => {
  clearDefs();
  resetCues();
});

describe('capturing a look', () => {
  it('keeps a look writes out of the live scene', () => {
    beginCapture();
    uni(0, 1, 1);
    const held = endCapture();
    tick(0);
    // The capture holds it; the rig does not.
    expect(held.size).toBe(1);
    expect(getUniverseBuffer(0)[0]).toBe(0);
  });

  it('hands back one entry per channel the look drove', () => {
    beginCapture();
    uni(0, 1, 1);
    uni(0, 5, 0.5);
    const held = endCapture();
    expect([...held.values()].map((d) => d.channel).sort((a, b) => a - b)).toEqual([1, 5]);
  });

  it('keeps two looks apart', () => {
    beginCapture();
    uni(0, 1, 1);
    const first = endCapture();
    beginCapture();
    uni(0, 2, 1);
    const second = endCapture();
    expect(first.size).toBe(1);
    expect(second.size).toBe(1);
  });

  it('writes reach the scene again once the capture ends', () => {
    beginCapture();
    uni(0, 1, 1);
    endCapture();
    uni(0, 2, 1);
    tick(0);
    expect(getUniverseBuffer(0)[1]).toBe(255);
  });

  it('aborting leaves the redirect off, so the rest of the run still lands', () => {
    // The failure path. A look that throws must not leave every later write in
    // the evaluation going into a map nobody reads.
    beginCapture();
    uni(0, 1, 1);
    abortCapture();
    uni(0, 2, 1);
    tick(0);
    expect(getUniverseBuffer(0)[1]).toBe(255);
  });
});

describe('a pattern-driven cue set', () => {
  it('says the scene is choosing', () => {
    registerCues(['verse', 'chorus'], true);
    expect(isCueDrivenByPattern()).toBe(true);
  });

  it('is not the default', () => {
    registerCues(['verse', 'chorus']);
    expect(isCueDrivenByPattern()).toBe(false);
  });

  it('ignores a pick, because pressing one would change nothing', () => {
    registerCues(['verse', 'chorus'], true);
    selectCue('chorus');
    expect(getSelectedCue()).toBe('verse');
  });

  it('takes picks again once the scene stops choosing', () => {
    registerCues(['verse', 'chorus'], true);
    selectCue('chorus');
    registerCues(['verse', 'chorus']);
    selectCue('chorus');
    expect(getSelectedCue()).toBe('chorus');
  });

  it('is forgotten on reset', () => {
    registerCues(['verse'], true);
    resetCues();
    expect(isCueDrivenByPattern()).toBe(false);
  });
});
