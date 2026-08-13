#!/usr/bin/env node
/**
 * CI gate for public fixture contributions.
 *
 * Walks `fixtures/*.json`, runs each through the shared validator, and
 * exits non-zero on any failure. Run by the validate-fixtures GitHub
 * Action on every PR that touches a file under `fixtures/`.
 *
 * tsx compiles the validator on the fly so this script can import the
 * TypeScript source directly. The logic checked here is the same logic the
 * app runs, with no separate build step.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateFixture } from '../packages/core/src/fixture-validator.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const fixturesDir = join(here, '..', 'fixtures');

const files = readdirSync(fixturesDir)
  .filter((f) => f.endsWith('.json'))
  .sort();

if (files.length === 0) {
  console.log('No fixtures to validate.');
  process.exit(0);
}

let hadError = false;
const seenIds = new Set();

for (const file of files) {
  const rel = relative(process.cwd(), join(fixturesDir, file));
  let raw;
  try {
    raw = readFileSync(join(fixturesDir, file), 'utf-8');
  } catch (err) {
    console.error(`✗ ${rel}: can't read file (${err.message})`);
    hadError = true;
    continue;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error(`✗ ${rel}: invalid JSON (${err.message})`);
    hadError = true;
    continue;
  }

  // "goboFixture" is the current schema-version field. "lumenFixture" is the
  // pre-rename spelling, accepted as a deprecated alias so fixture files
  // exported by older builds keep validating and importing unchanged.
  const schemaVersion =
    parsed && typeof parsed === 'object' ? (parsed.goboFixture ?? parsed.lumenFixture) : undefined;

  if (schemaVersion !== 1) {
    console.error(`✗ ${rel}: missing or wrong "goboFixture" version (expected 1)`);
    hadError = true;
    continue;
  }

  const expectedFilename = `${parsed.id}.json`;
  if (file !== expectedFilename) {
    console.error(
      `✗ ${rel}: filename "${file}" doesn't match id "${parsed.id}" ` +
      `(expected ${expectedFilename})`,
    );
    hadError = true;
    continue;
  }

  const result = validateFixture(parsed.id, parsed.def);
  if (!result.ok) {
    console.error(`✗ ${rel}: ${result.error}`);
    hadError = true;
    continue;
  }

  if (seenIds.has(result.id)) {
    console.error(`✗ ${rel}: duplicate fixture id "${result.id}"`);
    hadError = true;
    continue;
  }
  seenIds.add(result.id);

  console.log(`✓ ${rel}  (${result.def.name})`);
}

if (hadError) {
  console.error(`\nValidation failed for one or more fixture files.`);
  process.exit(1);
}
console.log(`\nValidated ${files.length} fixture(s).`);
