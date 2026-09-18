/**
 * Choosing which look is live.
 *
 * The selection is a position, like a fader's: it outlives a run, because
 * re-running the file during a show must not change what is on the rig. And a
 * selection that no longer names anything falls back to the first look rather
 * than to nothing, because coming up dark is the one outcome a lighting tool
 * does not get to choose.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  registerCues,
  selectCue,
  selectCueIndex,
  getCues,
  getSelectedCue,
  onCueChange,
  restoreCue,
  resetCues,
} from './cues.js';

beforeEach(() => {
  resetCues();
});

describe('what is offered', () => {
  it('has nothing to offer before a scene registers anything', () => {
    expect(getCues()).toEqual([]);
    expect(getSelectedCue()).toBeNull();
  });

  it('keeps the order the scene offered them in', () => {
    registerCues(['verse', 'chorus', 'breakdown']);
    expect(getCues()).toEqual(['verse', 'chorus', 'breakdown']);
  });

  it('comes up on the first look when nothing has been picked', () => {
    registerCues(['verse', 'chorus']);
    expect(getSelectedCue()).toBe('verse');
  });
});

describe('picking one', () => {
  it('selects by name', () => {
    registerCues(['verse', 'chorus']);
    selectCue('chorus');
    expect(getSelectedCue()).toBe('chorus');
  });

  it('selects by 1-based position, the way the buttons are numbered', () => {
    registerCues(['verse', 'chorus', 'breakdown']);
    selectCueIndex(3);
    expect(getSelectedCue()).toBe('breakdown');
  });

  it('ignores a name it does not have rather than throwing', () => {
    // The callers are a click, a key and a MIDI message. None of them is
    // somewhere an operator can see an exception.
    registerCues(['verse']);
    selectCue('nothing like it');
    expect(getSelectedCue()).toBe('verse');
  });

  it('ignores a position past the end', () => {
    registerCues(['verse']);
    selectCueIndex(9);
    expect(getSelectedCue()).toBe('verse');
  });
});

describe('announcing a change', () => {
  it('announces a real change, which is what runs the scene again', () => {
    const heard = vi.fn();
    registerCues(['verse', 'chorus']);
    onCueChange(heard);
    selectCue('chorus');
    expect(heard).toHaveBeenCalledOnce();
    expect(heard.mock.calls[0][0]).toBe('chorus');
  });

  it('hands the listener the look that was live before', () => {
    // The host needs it to put the selection back when the new look throws.
    const heard = vi.fn();
    registerCues(['verse', 'chorus']);
    onCueChange(heard);
    selectCue('chorus');
    expect(heard).toHaveBeenCalledWith('chorus', 'verse');
  });

  it('says nothing when the live look is picked, even by fallback', () => {
    // Nothing has been picked, so the first look is the one that is lit.
    // Pressing its button should not re-run the file.
    const heard = vi.fn();
    registerCues(['verse', 'chorus']);
    onCueChange(heard);
    selectCue('verse');
    expect(heard).not.toHaveBeenCalled();
  });

  it('says nothing when the same look is picked twice', () => {
    // Otherwise pressing the live cue's button re-runs the file for no reason.
    const heard = vi.fn();
    registerCues(['verse', 'chorus']);
    onCueChange(heard);
    selectCue('chorus');
    selectCue('chorus');
    expect(heard).toHaveBeenCalledOnce();
  });

  it('says nothing when a run re-registers the same looks', () => {
    // registerCues runs during evaluation. Announcing from there would ask the
    // host to evaluate again, from inside the evaluation it was asked for.
    const heard = vi.fn();
    registerCues(['verse', 'chorus']);
    onCueChange(heard);
    registerCues(['verse', 'chorus']);
    expect(heard).not.toHaveBeenCalled();
  });
});

describe('putting the selection back', () => {
  it('restores without announcing, because the announcement is what failed', () => {
    const heard = vi.fn();
    registerCues(['verse', 'chorus']);
    selectCue('chorus');
    onCueChange(heard);
    restoreCue('verse');
    expect(getSelectedCue()).toBe('verse');
    expect(heard).not.toHaveBeenCalled();
  });

  it('restores the fallback when nothing had been picked', () => {
    registerCues(['verse', 'chorus']);
    selectCue('chorus');
    restoreCue(null);
    expect(getSelectedCue()).toBe('verse');
  });
});

describe('the selection outlives a run', () => {
  it('stays put when the same looks are registered again', () => {
    registerCues(['verse', 'chorus']);
    selectCue('chorus');
    registerCues(['verse', 'chorus']);
    expect(getSelectedCue()).toBe('chorus');
  });

  it('falls back to the first look when the picked one is gone', () => {
    registerCues(['verse', 'chorus']);
    selectCue('chorus');
    registerCues(['verse', 'bridge']);
    expect(getSelectedCue()).toBe('verse');
  });

  it('remembers a name that comes back', () => {
    // Renaming a look and renaming it back should not lose where you were, so
    // the pick is not cleared when it stops matching — only overridden.
    registerCues(['verse', 'chorus']);
    selectCue('chorus');
    registerCues(['verse']);
    expect(getSelectedCue()).toBe('verse');
    registerCues(['verse', 'chorus']);
    expect(getSelectedCue()).toBe('chorus');
  });
});
