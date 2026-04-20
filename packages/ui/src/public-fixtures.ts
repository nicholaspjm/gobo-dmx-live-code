/**
 * Bundled public fixture library — the `fixtures/*.json` folder at the
 * repo root, pulled into the app at build time via Vite's glob import.
 *
 * Every file is re-validated against `validateFixture` here even though
 * CI runs the same check on PRs. Belt + braces: if a broken file ever
 * makes it to `main`, the app drops it with a console warning rather
 * than crashing — and the UI still loads with whatever's still valid.
 */

import { defineFixture, validateFixture, type FixtureDef } from '@lumen/core';

export interface PublicFixture {
  id: string;
  def: FixtureDef;
}

// Vite's import.meta.glob reaches up out of packages/ui to the repo-root
// `fixtures/` directory. `eager: true` turns each file into a static
// import so there's no async fetch — everything ships in the bundle.
const bundled: Record<string, unknown> = import.meta.glob(
  '../../../fixtures/*.json',
  { eager: true, import: 'default' },
);

function loadAll(): PublicFixture[] {
  const out: PublicFixture[] = [];
  for (const [path, raw] of Object.entries(bundled)) {
    const envelope = raw as { lumenFixture?: number; id?: unknown; def?: unknown };
    if (!envelope || envelope.lumenFixture !== 1) {
      console.warn(`[lumen] skipping ${path}: not a lumen fixture file`);
      continue;
    }
    const result = validateFixture(envelope.id, envelope.def);
    if (!result.ok) {
      console.warn(`[lumen] skipping ${path}: ${result.error}`);
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
      console.warn(`[lumen] couldn't register public fixture "${id}":`, err);
    }
  }
}
