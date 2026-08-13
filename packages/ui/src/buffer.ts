/**
 * The working buffer — one editor document, autosaved to the browser.
 *
 * This replaces the old multi-scene model (scenes.ts): a dropdown of named
 * buffers that the user had to remember to switch, plus a protected
 * "default" they could not overwrite. gobo behaves like a text editor
 * instead. There is exactly one document open. It is saved to localStorage
 * on every keystroke so a crash mid-set costs nothing, and durable copies
 * live in files (scene-file.ts) or in a share link (share.ts), not in a
 * pile of browser keys nobody can back up.
 *
 * Storage keys are new (gobo-buffer-*). The old scene keys are read here
 * for the one-time migration notice and are NEVER written — see
 * listLegacyScenes() below, which explains why that matters.
 */

import { EXAMPLES } from './examples.js';

const BUFFER_KEY = 'gobo-buffer-v1';
const NAME_KEY = 'gobo-buffer-name-v1';
/** Snapshot of the buffer at the last moment it was known to be safe to
 *  discard — see isUnsavedSinceFileSave(). */
const FILE_REF_KEY = 'gobo-buffer-file-ref-v1';
const LEGACY_NOTICE_KEY = 'gobo-legacy-notice-dismissed-v1';

/** Fallback name when a buffer exists but has no name recorded. */
const UNTITLED = 'untitled';

// ─── Storage helpers ─────────────────────────────────────────────────────────

/** Read a key, treating any failure as "absent". localStorage throws
 *  outright in some privacy configurations, and a boot that dies on a
 *  storage read would take the whole editor with it. */
function readKey(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Write a key, swallowing failures. Called on every keystroke, so a full
 *  quota or private-browsing mode must degrade to "this session is
 *  in-memory only" rather than throwing into the editor's change handler
 *  (same posture the old scenes.ts took). */
function writeKey(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Quota exhausted or storage disabled. Nothing to do but carry on —
    // the buffer still lives in the editor, and Save to file still works.
  }
}

// ─── The buffer ──────────────────────────────────────────────────────────────

/**
 * Load the working buffer. On a browser that has never run gobo there is
 * nothing to load, so the buffer is seeded from the first bundled example
 * and written straight back — that way the very next load is an ordinary
 * load, and the seed is not re-applied over anything the user has typed.
 */
export function loadBuffer(): { code: string; name: string } {
  const stored = readKey(BUFFER_KEY);
  if (stored !== null) return { code: stored, name: getBufferName() };

  const seed = EXAMPLES[0];
  writeKey(BUFFER_KEY, seed.code);
  writeKey(NAME_KEY, seed.label);
  // Pristine example code is not the user's work, so record it as the
  // reference point: a freshly seeded buffer is not "unsaved changes" and
  // must not trigger the overwrite prompt on the first share link opened.
  writeKey(FILE_REF_KEY, seed.code);
  return { code: seed.code, name: seed.label };
}

/**
 * Persist the buffer. Called from the editor's change handler on every
 * edit, so it does the minimum: one write, plus a second only when the
 * caller is also renaming. Deliberately no debounce or dirty-check here —
 * an extra localStorage write is cheaper than a lost set, and skipping
 * writes based on a cached value would let a second tab's write win.
 */
export function saveBuffer(code: string, name?: string): void {
  writeKey(BUFFER_KEY, code);
  if (name !== undefined) writeKey(NAME_KEY, name);
}

export function getBufferName(): string {
  const name = readKey(NAME_KEY);
  return name !== null && name.trim() !== '' ? name : UNTITLED;
}

export function setBufferName(name: string): void {
  writeKey(NAME_KEY, name);
}

/**
 * True when the buffer differs from the last copy the user secured — the
 * last file they saved, or the pristine example a new buffer was seeded
 * from. This is the guard behind "you have unsaved work, replace it?"
 * before a share link or an example overwrites the buffer, so it errs
 * towards true: with no reference point recorded at all (storage was
 * unwritable when we tried, or the key was cleared), any non-empty buffer
 * counts as unsaved rather than silently discardable.
 *
 * It compares the full text rather than tracking a dirty flag, so editing
 * something and then undoing it back correctly reads as "no changes".
 */
export function isUnsavedSinceFileSave(): boolean {
  const code = readKey(BUFFER_KEY) ?? '';
  const ref = readKey(FILE_REF_KEY);
  if (ref === null) return code.trim() !== '';
  return code !== ref;
}

/**
 * Record that the buffer as it now stands has been written to a file.
 * Call this only after the download actually happened; calling it early
 * would tell the user their work is safe when it is not.
 */
export function markSavedToFile(): void {
  writeKey(FILE_REF_KEY, readKey(BUFFER_KEY) ?? '');
}

// ─── Legacy scenes (READ-ONLY) ───────────────────────────────────────────────

/** The pre-buffer scene store. Listed here so the keys are named in one
 *  place — and so the read-only rule below is impossible to miss. */
const LEGACY_SCENES_KEY = 'gobo-scenes-v1';
/** Same store under the pre-rename name. scenes.ts used to copy this
 *  forward on import; once that module is gone nothing does, so read it
 *  as a fallback. Read only — the copy is not ours to make either. */
const LEGACY_SCENES_KEY_PRERENAME = 'lumen-scenes-v1';

/**
 * The user's scenes from the old model, for the one-time migration notice.
 *
 * !!! READ-ONLY. NEVER WRITE OR DELETE THESE KEYS. !!!
 *
 * gobo-scenes-v1 (and its lumen-* predecessor, and the sibling
 * gobo-active-scene-v1 / gobo-scene-meta-v1) hold work that exists in
 * exactly one place: this browser. There is no server, no export, no undo.
 * If the new buffer code has a bug, those keys are the only thing standing
 * between the user and losing months of rehearsal — including a live
 * performance template. So they are left exactly as they are, forever.
 * Do not "clean up" after the migration notice is dismissed; the notice
 * being dismissed is not evidence the user saved anything.
 *
 * Returns [] for absent, empty, or malformed data — a broken blob must
 * show up as "nothing to migrate" in the notice, never as a boot failure.
 */
export function listLegacyScenes(): Array<{ name: string; code: string }> {
  const raw = readKey(LEGACY_SCENES_KEY) ?? readKey(LEGACY_SCENES_KEY_PRERENAME);
  if (raw === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  // Must be a plain object of name → code. Arrays and primitives parse
  // fine as JSON but are not a scene map.
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
  const out: Array<{ name: string; code: string }> = [];
  for (const [name, code] of Object.entries(parsed as Record<string, unknown>)) {
    // Skip entries whose value was mangled rather than dropping the whole
    // set — one bad key should not hide the rest of the user's scenes.
    if (typeof code === 'string') out.push({ name, code });
  }
  // Sorted so the notice lists the same scenes in the same order every
  // time it is rendered; object key order is not something to rely on.
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

/** Whether the user has already dealt with the migration notice. Stored
 *  under a new key so the dismissal itself never touches legacy data. */
export function legacyNoticeDismissed(): boolean {
  return readKey(LEGACY_NOTICE_KEY) === '1';
}

/** Dismiss the migration notice permanently. Does not remove, alter, or
 *  even read the legacy scenes — dismissing is about the notice, not the
 *  data, which stays put (see listLegacyScenes). */
export function dismissLegacyNotice(): void {
  writeKey(LEGACY_NOTICE_KEY, '1');
}
