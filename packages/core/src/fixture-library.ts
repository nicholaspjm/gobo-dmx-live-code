/**
 * Fixture library: persistence and file IO for user-defined fixtures.
 *
 * Custom fixtures (everything declared via `defineFixture(id, def)`) live in
 * memory by default, cleared on every reload. The library layer pins a fixture
 * to the browser so it is available without pasting the defineFixture call into
 * every new sketch, and exports it as a small JSON file to share.
 *
 * Wire format (single fixture):
 *   {
 *     "goboFixture": 1,           // schema version, bump if we ever reshape
 *     "id": "four-color-bar",     // short identifier used in fixture() calls
 *     "def": {                     // the arg passed to defineFixture, verbatim
 *       "name": "Four-Colour Moving Bar",
 *       "manufacturer": "Generic",
 *       "type": "generic",
 *       "channelCount": 38,
 *       "channels": [ { offset, name, type, pixelCount?, pixelLayout? }, … ]
 *     }
 *   }
 *
 * Storage: a single localStorage entry keyed by LIBRARY_KEY holds all
 * saved fixtures as { [id]: def }, readable in DevTools.
 */

import { defineFixture, type FixtureDef } from './fixtures.js';
import { validateFixture } from './fixture-validator.js';

const LIBRARY_KEY = 'gobo-fixtures-v1';

/**
 * Storage key from when the project was called "lumen". Libraries saved under
 * that name still sit under this key in users' browsers. readRaw() adopts it
 * the first time the current key comes back empty, so an upgraded install
 * keeps its library.
 *
 * Keep this while any browser may still hold the old entry. Removing it
 * orphans those fixtures with no way to recover them.
 */
const LEGACY_LIBRARY_KEY = 'lumen-fixtures-v1';

export interface LibraryEntry {
  id: string;
  def: FixtureDef;
}

// ─── Storage ─────────────────────────────────────────────────────────────────

function readRaw(): Record<string, FixtureDef> {
  try {
    let raw = localStorage.getItem(LIBRARY_KEY);
    if (raw === null) {
      // Nothing under the current key. Fall back to the legacy one and copy it
      // across, so the migration happens once and the user never sees it.
      // The legacy entry is left in place so an older build still works for
      // anyone who rolls back.
      const legacy = localStorage.getItem(LEGACY_LIBRARY_KEY);
      if (legacy === null) return {};
      raw = legacy;
      try {
        localStorage.setItem(LIBRARY_KEY, legacy);
      } catch {
        // Quota / private mode. The adopted value is still returned below;
        // the copy is retried on the next read.
      }
    }
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as Record<string, FixtureDef>;
  } catch {
    return {};
  }
}

function writeRaw(lib: Record<string, FixtureDef>): void {
  try {
    localStorage.setItem(LIBRARY_KEY, JSON.stringify(lib));
  } catch {
    // Full disk, private mode, and so on. The library is best-effort; skip.
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/** Return every saved fixture as an array, sorted by id. */
export function getLibraryFixtures(): LibraryEntry[] {
  const lib = readRaw();
  return Object.entries(lib)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, def]) => ({ id, def }));
}

/** Pin a fixture (id + def) into the library. Overwrites any existing
 *  entry with the same id. */
export function saveToLibrary(id: string, def: FixtureDef): void {
  const lib = readRaw();
  lib[id] = def;
  writeRaw(lib);
}

/** Remove a fixture from the library. No-op if id isn't saved. */
export function removeFromLibrary(id: string): void {
  const lib = readRaw();
  if (id in lib) {
    delete lib[id];
    writeRaw(lib);
  }
}

/** True if a fixture with this id is currently in the library. */
export function isInLibrary(id: string): boolean {
  return id in readRaw();
}

/**
 * Call once on startup. Registers every saved fixture so user code can
 * fixture(...) them without re-defining. User-written defineFixture(...)
 * calls in the session still win because they run after this.
 */
export function restoreLibraryFixtures(): void {
  const lib = readRaw();
  for (const [id, def] of Object.entries(lib)) {
    try {
      defineFixture(id, def);
    } catch (err) {
      console.warn(`[gobo] couldn't restore library fixture "${id}":`, err);
    }
  }
}

// ─── Import / Export (file + string) ─────────────────────────────────────────

/** Schema-tagged object ready to be stringified and handed to the user as
 *  a `.gobo-fixture.json` file. */
export interface ExportEnvelope {
  goboFixture: number;
  id: string;
  def: FixtureDef;
}

/**
 * Schema-version field from when the project was called "lumen". Files
 * exported under that name carry `lumenFixture`, and users still have them in
 * folders and share them, so parseImportString() accepts it as a deprecated
 * alias. Exports write `goboFixture` only.
 *
 * @deprecated Import-only alias for `goboFixture`; do not write it.
 */
const LEGACY_SCHEMA_FIELD = 'lumenFixture';

export function toExportEnvelope(id: string, def: FixtureDef): ExportEnvelope {
  return { goboFixture: 1, id, def };
}

export function toExportString(id: string, def: FixtureDef): string {
  return JSON.stringify(toExportEnvelope(id, def), null, 2);
}

export interface ImportResult {
  ok: boolean;
  id?: string;
  def?: FixtureDef;
  error?: string;
}

/**
 * Parse a .gobo-fixture.json string and validate the shape. Does not touch
 * storage; the caller decides what to do with the result.
 *
 * The envelope (goboFixture version + id + def) is checked here; the
 * inner fixture def is handed off to validateFixture() for the strict
 * schema / limits / no-collision-with-built-ins pass.
 *
 * The deprecated `lumenFixture` field is accepted in place of
 * `goboFixture` so files exported as "lumen" still import.
 */
export function parseImportString(raw: string): ImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'File is not valid JSON.' };
  }
  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, error: 'Expected a JSON object.' };
  }
  const env = parsed as Record<string, unknown>;
  const version =
    typeof env.goboFixture === 'number' ? env.goboFixture : env[LEGACY_SCHEMA_FIELD];
  if (typeof version !== 'number') {
    return { ok: false, error: "Not a gobo fixture file (missing 'goboFixture' version)." };
  }
  const result = validateFixture(env.id, env.def);
  if (!result.ok) {
    return { ok: false, error: result.error };
  }
  return { ok: true, id: result.id, def: result.def };
}
