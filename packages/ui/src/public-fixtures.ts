/**
 * Bundled public fixture library: the `fixtures/*.json` folder at the repo
 * root, pulled into the app at build time via Vite's glob import.
 *
 * Every file is re-validated against `validateFixture` here even though CI
 * runs the same check on PRs. If a broken file ever reaches `main`, the app
 * drops it with a console warning and loads with the fixtures that remain.
 */

import { defineFixture, validateFixture, type FixtureDef } from '@gobo/core';

export interface PublicFixture {
  id: string;
  def: FixtureDef;
}

// Vite's import.meta.glob reaches up out of packages/ui to the repo-root
// `fixtures/` directory. `eager: true` turns each file into a static
// import, so everything ships in the bundle with no async fetch.
const bundled: Record<string, unknown> = import.meta.glob(
  '../../../fixtures/*.json',
  { eager: true, import: 'default' },
);

function loadAll(): PublicFixture[] {
  const out: PublicFixture[] = [];
  for (const [path, raw] of Object.entries(bundled)) {
    const envelope = raw as {
      goboFixture?: number;
      /** @deprecated Pre-rename name for `goboFixture`. Still read so
       *  fixture files exported (or contributed) before the rename keep
       *  loading. See the version check below. */
      lumenFixture?: number;
      id?: unknown;
      def?: unknown;
    };
    // Accept either spelling of the schema version. `goboFixture` is the
    // current field; `lumenFixture` is its deprecated alias, kept because
    // files users exported before the rename are already out there and
    // must not stop working.
    const schemaVersion = envelope?.goboFixture ?? envelope?.lumenFixture;
    if (!envelope || schemaVersion !== 1) {
      console.warn(`[gobo] skipping ${path}: not a gobo fixture file`);
      continue;
    }
    const result = validateFixture(envelope.id, envelope.def);
    if (!result.ok) {
      console.warn(`[gobo] skipping ${path}: ${result.error}`);
      continue;
    }
    out.push({ id: result.id, def: result.def });
  }
  // Sort by id so the panel list is stable between reloads.
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

const PUBLIC_FIXTURES = loadAll();

/** Read the (immutable for this session) list of bundled public fixtures. */
export function getPublicFixtures(): readonly PublicFixture[] {
  return PUBLIC_FIXTURES;
}

/**
 * Register every public fixture so `fixture(1, 'their-id')` works out of
 * the box without the user needing to click anything. Called once on
 * startup from main.ts. User-defined fixtures declared in their own code
 * still override these since defineFixture runs at eval time, after this.
 */
export function registerPublicFixtures(): void {
  for (const { id, def } of PUBLIC_FIXTURES) {
    try {
      defineFixture(id, def);
    } catch (err) {
      console.warn(`[gobo] couldn't register public fixture "${id}":`, err);
    }
  }
}
