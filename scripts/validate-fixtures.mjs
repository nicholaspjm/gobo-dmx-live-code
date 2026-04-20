#!/usr/bin/env node
/**
 * CI gate for public fixture contributions.
 *
 * Walks `fixtures/*.json`, runs each through the shared validator, and
 * exits non-zero on any failure. Run by the validate-fixtures GitHub
 * Action on every PR that touches a file under `fixtures/`.
 *
 * We compile the validator on the fly via tsx so the script can import
 * the TypeScript source directly — keeps the checked logic identical to
 * the one the app uses at runtime without a separate build step.
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

  if (!parsed || typeof parsed !== 'object' || parsed.lumenFixture !== 1) {
    console.error(`✗ ${rel}: missing or wrong "lumenFixture" version (expected 1)`);
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
