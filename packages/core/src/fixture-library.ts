/**
 * Fixture library — persistence + file IO for user-defined fixtures.
 *
 * Custom fixtures (everything declared via `defineFixture(id, def)`) live
 * in memory by default, cleared on every reload. The library layer lets
 * users pin a fixture to the browser so it's always available without
 * pasting the defineFixture call into every new sketch, and lets them
 * share a fixture with someone else as a small JSON file.
 *
 * Wire format (single fixture):
 *   {
 *     "lumenFixture": 1,          // schema version, bump if we ever reshape
 *     "id": "four-color-bar",     // short identifier used in fixture() calls
 *     "def": {                     // exactly the arg passed to defineFixture
 *       "name": "Four-Colour Moving Bar",
 *       "manufacturer": "Generic",
 *       "type": "generic",
 *       "channelCount": 38,
 *       "channels": [ { offset, name, type, pixelCount?, pixelLayout? }, … ]
 *     }
 *   }
 *
 * Storage: a single localStorage entry keyed by LIBRARY_KEY holds all
 * saved fixtures as { [id]: def }. Simple enough that a user can also
 * poke at it via DevTools if they want.
 */

import { defineFixture, type FixtureDef } from './fixtures.js';
import { validateFixture } from './fixture-validator.js';

const LIBRARY_KEY = 'lumen-fixtures-v1';

export interface LibraryEntry {
  id: string;
  def: FixtureDef;
}

// ─── Storage ─────────────────────────────────────────────────────────────────

function readRaw(): Record<string, FixtureDef> {
  try {
    const raw = localStorage.getItem(LIBRARY_KEY);
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
    // Full disk, private mode, etc — library is best-effort, just skip.
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
      console.warn(`[lumen] couldn't restore library fixture "${id}":`, err);
    }
  }
}

// ─── Import / Export (file + string) ─────────────────────────────────────────

/** Schema-tagged object ready to be stringified and handed to the user as
 *  a `.lumen-fixture.json` file. */
export interface ExportEnvelope {
  lumenFixture: number;
  id: string;
  def: FixtureDef;
}

export function toExportEnvelope(id: string, def: FixtureDef): ExportEnvelope {
  return { lumenFixture: 1, id, def };
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
 * Parse a .lumen-fixture.json string and validate the shape. Doesn't
 * touch storage — caller decides what to do with the result.
 *
 * The envelope (lumenFixture version + id + def) is checked here; the
 * inner fixture def is handed off to validateFixture() for the strict
 * schema / limits / no-collision-with-built-ins pass.
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
  if (typeof env.lumenFixture !== 'number') {
    return { ok: false, error: "Not a lumen fixture file (missing 'lumenFixture' version)." };
  }
  const result = validateFixture(env.id, env.def);
  if (!result.ok) {
    return { ok: false, error: result.error };
  }
  return { ok: true, id: result.id, def: result.def };
}
