/**
 * Working-buffer tests.
 *
 * Two things here are safety properties rather than features, and they are
 * the reason this suite exists:
 *
 *   1. The legacy scene keys are the user's only copy of work made under
 *      the old multi-scene model. Every test that touches the buffer also
 *      asserts those keys are byte-identical afterwards. If a future edit
 *      to buffer.ts "tidies up" after the migration notice, this fails.
 *
 *   2. isUnsavedSinceFileSave() is what stops an incoming share link from
 *      silently overwriting a set. A false negative here loses work, so
 *      the transitions are pinned individually, including the awkward
 *      cases: no reference point recorded, and an edit undone by hand.
 *
 * The suite runs in the default node environment, so localStorage is
 * stubbed below. buffer.ts touches storage only inside its functions, never
 * at module load, which is what makes the stub-then-import order safe.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
  loadBuffer,
  saveBuffer,
  getBufferName,
  setBufferName,
  isUnsavedSinceFileSave,
  markSavedToFile,
  listLegacyScenes,
  legacyNoticeDismissed,
  dismissLegacyNotice,
} from './buffer.js';

import { EXAMPLES } from './examples.js';

// ─── localStorage stub ───────────────────────────────────────────────────────

/** Minimal Storage implementation. `failWrites` simulates an exhausted
 *  quota or private mode, which browsers signal by throwing from setItem. */
class MemoryStorage {
  private map = new Map<string, string>();
  failWrites = false;

  getItem(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }

  setItem(key: string, value: string): void {
    if (this.failWrites) throw new Error('QuotaExceededError');
    this.map.set(key, String(value));
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }

  key(i: number): string | null {
    return Array.from(this.map.keys())[i] ?? null;
  }

  get length(): number {
    return this.map.size;
  }
}

let store: MemoryStorage;

beforeEach(() => {
  store = new MemoryStorage();
  vi.stubGlobal('localStorage', store);
});

const BUFFER_KEY = 'gobo-buffer-v1';
const NAME_KEY = 'gobo-buffer-name-v1';
const SCENES_KEY = 'gobo-scenes-v1';
const ACTIVE_KEY = 'gobo-active-scene-v1';
const META_KEY = 'gobo-scene-meta-v1';

// ─── first run ───────────────────────────────────────────────────────────────

describe('first run', () => {
  it('seeds the buffer from the first bundled example', () => {
    const { code, name } = loadBuffer();
    expect(code).toBe(EXAMPLES[0].code);
    expect(name).toBe(EXAMPLES[0].label);
  });

  it('persists the seed so the next load is an ordinary load', () => {
    loadBuffer();
    expect(store.getItem(BUFFER_KEY)).toBe(EXAMPLES[0].code);

    // Edit, then load again: the seed must not come back over the edit.
    saveBuffer('artnet("2.0.0.100")');
    expect(loadBuffer().code).toBe('artnet("2.0.0.100")');
  });

  it('does not re-seed a buffer the user has emptied', () => {
    saveBuffer('');
    expect(loadBuffer().code).toBe('');
  });

  it('treats a freshly seeded buffer as not needing a save prompt', () => {
    loadBuffer();
    expect(isUnsavedSinceFileSave()).toBe(false);
  });

  it('survives storage that refuses every write', () => {
    store.failWrites = true;
    expect(() => loadBuffer()).not.toThrow();
    expect(loadBuffer().code).toBe(EXAMPLES[0].code);
  });
});

// ─── save / load ─────────────────────────────────────────────────────────────

describe('save and load', () => {
  it('round-trips code and name', () => {
    saveBuffer('sine().slow(4)', 'friday set');
    const loaded = loadBuffer();
    expect(loaded.code).toBe('sine().slow(4)');
    expect(loaded.name).toBe('friday set');
    expect(getBufferName()).toBe('friday set');
  });

  it('leaves the name alone when saveBuffer omits it', () => {
    saveBuffer('one', 'friday set');
    saveBuffer('two');
    expect(getBufferName()).toBe('friday set');
    expect(loadBuffer().code).toBe('two');
  });

  it('falls back to untitled for a buffer with no name', () => {
    saveBuffer('code with no name');
    expect(getBufferName()).toBe('untitled');
  });

  it('falls back to untitled for a blank name', () => {
    setBufferName('   ');
    expect(getBufferName()).toBe('untitled');
  });

  it('renames without touching the code', () => {
    saveBuffer('keep me', 'old');
    setBufferName('new');
    expect(getBufferName()).toBe('new');
    expect(loadBuffer().code).toBe('keep me');
  });

  it('does not throw when the quota is full', () => {
    store.failWrites = true;
    expect(() => saveBuffer('anything', 'any name')).not.toThrow();
    expect(() => setBufferName('any name')).not.toThrow();
    expect(() => markSavedToFile()).not.toThrow();
  });
});

// ─── unsaved-since-file-save ─────────────────────────────────────────────────

describe('isUnsavedSinceFileSave', () => {
  it('walks the full seed → edit → save → edit cycle', () => {
    loadBuffer();
    expect(isUnsavedSinceFileSave()).toBe(false);

    saveBuffer(EXAMPLES[0].code + '\nwash.red(1)');
    expect(isUnsavedSinceFileSave()).toBe(true);

    markSavedToFile();
    expect(isUnsavedSinceFileSave()).toBe(false);

    saveBuffer('something else entirely');
    expect(isUnsavedSinceFileSave()).toBe(true);
  });

  it('reads as saved again when an edit is undone by hand', () => {
    saveBuffer('original');
    markSavedToFile();
    saveBuffer('original + typo');
    expect(isUnsavedSinceFileSave()).toBe(true);

    saveBuffer('original');
    expect(isUnsavedSinceFileSave()).toBe(false);
  });

  it('assumes unsaved work when no reference point was ever recorded', () => {
    // Buffer written by a build that never got to record a reference, or
    // the reference key cleared by hand. Content must be treated as the
    // user's until proven otherwise.
    store.setItem(BUFFER_KEY, 'a set nobody has a copy of');
    expect(isUnsavedSinceFileSave()).toBe(true);
  });

  it('does not claim unsaved work for an empty buffer with no reference', () => {
    expect(isUnsavedSinceFileSave()).toBe(false);
    store.setItem(BUFFER_KEY, '   \n  ');
    expect(isUnsavedSinceFileSave()).toBe(false);
  });

  it('stays true when the quota blocked the reference write', () => {
    saveBuffer('work in progress');
    store.failWrites = true;
    markSavedToFile();
    // The download may have succeeded, but the reference was not recorded,
    // so keep prompting rather than risk discarding the buffer.
    expect(isUnsavedSinceFileSave()).toBe(true);
  });
});

// ─── legacy scenes ───────────────────────────────────────────────────────────

/** The user's real-world shape: a scene map plus its two sibling keys. */
const LEGACY_SCENES = JSON.stringify({
  'ultratronics 11': '// live template\nsetBPM(108)\n',
  default: '// default\n',
  'four-color-bar demo': '// bar\n',
});
const LEGACY_ACTIVE = 'ultratronics 11';
const LEGACY_META = JSON.stringify({ 'ultratronics 11': { lastAccessedAt: 1710000000000 } });

function seedLegacy(scenes: string = LEGACY_SCENES): void {
  store.setItem(SCENES_KEY, scenes);
  store.setItem(ACTIVE_KEY, LEGACY_ACTIVE);
  store.setItem(META_KEY, LEGACY_META);
}

/** Byte-for-byte comparison of every legacy key. */
function expectLegacyUntouched(scenes: string = LEGACY_SCENES): void {
  expect(store.getItem(SCENES_KEY)).toBe(scenes);
  expect(store.getItem(ACTIVE_KEY)).toBe(LEGACY_ACTIVE);
  expect(store.getItem(META_KEY)).toBe(LEGACY_META);
}

describe('legacy scenes', () => {
  it('lists the old scenes for the migration notice', () => {
    seedLegacy();
    expect(listLegacyScenes()).toEqual([
      { name: 'default', code: '// default\n' },
      { name: 'four-color-bar demo', code: '// bar\n' },
      { name: 'ultratronics 11', code: '// live template\nsetBPM(108)\n' },
    ]);
  });

  it('reads the pre-rename key when the renamed one is absent', () => {
    // Nothing copies lumen-* forward once scenes.ts is gone, so the old
    // name has to be readable directly, still without writing it.
    store.setItem('lumen-scenes-v1', JSON.stringify({ 'old set': '// old\n' }));
    expect(listLegacyScenes()).toEqual([{ name: 'old set', code: '// old\n' }]);
    expect(store.getItem(SCENES_KEY)).toBeNull();
    expect(store.getItem('lumen-scenes-v1')).toBe(JSON.stringify({ 'old set': '// old\n' }));
  });

  it('never mutates the legacy keys, whatever the buffer does', () => {
    seedLegacy();
    expectLegacyUntouched();

    loadBuffer();
    expectLegacyUntouched();

    saveBuffer('new work', 'saturday');
    expectLegacyUntouched();

    setBufferName('sunday');
    expectLegacyUntouched();

    markSavedToFile();
    expectLegacyUntouched();

    isUnsavedSinceFileSave();
    expectLegacyUntouched();

    listLegacyScenes();
    expectLegacyUntouched();

    dismissLegacyNotice();
    expectLegacyUntouched();

    legacyNoticeDismissed();
    expectLegacyUntouched();
  });

  it('does not hand out a live reference to the stored scenes', () => {
    seedLegacy();
    const scenes = listLegacyScenes();
    scenes[0].code = 'clobbered';
    scenes.length = 0;
    expectLegacyUntouched();
    expect(listLegacyScenes()).toHaveLength(3);
  });

  it('returns nothing when there are no legacy scenes at all', () => {
    expect(listLegacyScenes()).toEqual([]);
  });

  it('returns nothing for an empty scene map', () => {
    seedLegacy('{}');
    expect(listLegacyScenes()).toEqual([]);
    expectLegacyUntouched('{}');
  });

  it('survives a malformed blob without throwing or deleting it', () => {
    for (const bad of ['not json at all', '{"unclosed": ', '[1,2,3]', 'null', '42', '"a string"']) {
      seedLegacy(bad);
      expect(listLegacyScenes()).toEqual([]);
      // The corrupt value is still the user's data. Leave it for a future
      // build (or the user) to recover.
      expectLegacyUntouched(bad);
    }
  });

  it('keeps the good entries when one value is mangled', () => {
    const mixed = JSON.stringify({ good: '// code\n', broken: { nested: true }, alsoBroken: 7 });
    seedLegacy(mixed);
    expect(listLegacyScenes()).toEqual([{ name: 'good', code: '// code\n' }]);
    expectLegacyUntouched(mixed);
  });
});

// ─── migration notice dismissal ──────────────────────────────────────────────

describe('migration notice', () => {
  it('starts undismissed and stays dismissed once dismissed', () => {
    expect(legacyNoticeDismissed()).toBe(false);
    dismissLegacyNotice();
    expect(legacyNoticeDismissed()).toBe(true);
  });

  it('persists the dismissal under its own key, not a legacy one', () => {
    seedLegacy();
    dismissLegacyNotice();
    expect(store.getItem('gobo-legacy-notice-dismissed-v1')).toBe('1');
    expectLegacyUntouched();
  });

  it('reports undismissed when the dismissal could not be stored', () => {
    store.failWrites = true;
    dismissLegacyNotice();
    // Better to show the notice again than to hide the user's only route
    // to their old scenes.
    expect(legacyNoticeDismissed()).toBe(false);
  });
});
