#!/usr/bin/env node
/**
 * Set gobo's version everywhere it is written, in one step.
 *
 *   npm run bump -- 0.5.4
 *
 * Every package is released together on one tag, and the version lives in
 * eight places: the five package.json files, the lockfile's copies of them,
 * APP_VERSION in core and CONNECTOR_VERSION in the bridge. The two constants
 * exist because neither build can read a package.json at runtime (see the
 * comments beside them), and tests fail if any of the eight disagree. Editing
 * them by hand is how a release goes out half-bumped.
 *
 * It changes the files and nothing else: no commit, no tag. The changelog
 * section is still written by hand, because what goes in it is the point.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const next = process.argv[2];

if (!next || !/^\d+\.\d+\.\d+$/.test(next)) {
  console.error('usage: npm run bump -- <x.y.z>');
  process.exit(1);
}

const PACKAGES = ['.', 'packages/core', 'packages/ui', 'packages/bridge', 'packages/desktop'];

const current = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
if (current === next) {
  console.error(`already ${next}`);
  process.exit(1);
}

const changed = [];

function edit(rel, fn) {
  const path = join(root, rel);
  const before = readFileSync(path, 'utf8');
  const after = fn(before);
  if (after === before) {
    console.error(`${rel}: nothing to change, which means it was not at ${current}. Stopping.`);
    process.exit(1);
  }
  writeFileSync(path, after);
  changed.push(rel);
}

// package.json files: only the top-level "version", so a dependency that
// happens to share the number is left alone.
for (const dir of PACKAGES) {
  edit(join(dir, 'package.json'), (text) => {
    const pkg = JSON.parse(text);
    if (pkg.version !== current) return text;
    pkg.version = next;
    return `${JSON.stringify(pkg, null, 2)}\n`;
  });
}

// The lockfile's entries for this repository's own packages, and nothing else.
edit('package-lock.json', (text) => {
  const lock = JSON.parse(text);
  if (lock.version === current) lock.version = next;
  for (const dir of PACKAGES) {
    const key = dir === '.' ? '' : dir;
    if (lock.packages?.[key]?.version === current) lock.packages[key].version = next;
  }
  return `${JSON.stringify(lock, null, 2)}\n`;
});

edit('packages/core/src/connector-version.ts', (text) =>
  text.replace(`export const APP_VERSION = '${current}';`, `export const APP_VERSION = '${next}';`));
edit('packages/bridge/src/version.ts', (text) =>
  text.replace(`export const CONNECTOR_VERSION = '${current}';`, `export const CONNECTOR_VERSION = '${next}';`));

console.log(`${current} → ${next} in:\n  ${changed.join('\n  ')}`);
console.log('Next: a CHANGELOG section for it, npm test, commit, then tag v' + next + '.');
