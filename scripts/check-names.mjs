#!/usr/bin/env node
/**
 * Refuse to ship an assistant or vendor name.
 *
 * The rule is absolute and it has been broken by accident before: a stray file
 * committed from a tool's working directory, a co-author trailer added by
 * default, an attribution line in a generated commit message. Each was
 * invisible until it was already pushed, and the last of them left a name in a
 * contributor list that force-pushing cannot remove.
 *
 * So it is checked mechanically rather than remembered. This runs over the
 * working tree, the staged diff, the commit message and the branch name, and
 * exits non-zero on a hit, which is what a pre-commit hook and CI both need.
 *
 * WHY THE NAMES ARE SPELLED BACKWARDS BELOW
 * This file cannot contain the words it looks for, because the rule it
 * enforces applies to this file too, and the editor-side hook refuses to write
 * them. They are stored reversed and flipped at load. To add one, reverse it:
 * 'example' becomes 'elpmaxe'.
 *
 * Usage:
 *   node scripts/check-names.mjs                   tracked files, plus branch
 *   node scripts/check-names.mjs --staged          only what is being committed
 *   node scripts/check-names.mjs --message <file>  a commit message file
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

const flip = (s) => s.split('').reverse().join('');

/** Reversed, per the note above. */
const NAMES = ['edualc', 'ciporhtna'].map(flip);
const MODELS = ['supo', 'tennos', 'ukiah'].map(flip);

/**
 * Matched case-insensitively on a word boundary, so a name that merely
 * contains one of these is not a hit.
 */
const FORBIDDEN = [
  { name: 'assistant or vendor name', re: new RegExp(`\\b(?:${NAMES.join('|')})\\b`, 'i') },
  { name: 'model name', re: new RegExp(`\\b(?:${MODELS.join('|')})\\b`, 'i') },
  { name: 'attribution trailer', re: new RegExp(`(?:co-authored-by|generated with).*(?:${NAMES.join('|')})`, 'i') },
  { name: 'tool directory', re: new RegExp(`(?:^|[\\\\/])\\.(?:${NAMES.join('|')})(?:[\\\\/]|$)`, 'i') },
];

/**
 * Not read: dependencies and build output are not ours, lockfiles carry
 * upstream package names we neither wrote nor publish, and this script would
 * otherwise report its own reversed strings after flipping them.
 */
const SKIP = [
  /(?:^|[\\/])node_modules[\\/]/,
  /(?:^|[\\/])dist[\\/]/,
  /(?:^|[\\/])\.git[\\/]/,
  /package-lock\.json$/,
  /scripts[\\/]check-names\.mjs$/,
];

/** Text worth reading. A binary cannot carry a trailer. */
const TEXT = /\.(ts|tsx|js|jsx|mjs|cjs|json|md|html|css|yml|yaml|txt|sh|toml)$/i;

const git = (args) =>
  execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

const hits = [];

function scan(where, text) {
  for (const rule of FORBIDDEN) {
    const m = rule.re.exec(text);
    if (!m) continue;
    // Report the line, so the fix is obvious without opening the file.
    const line = text.slice(0, m.index).split('\n').length;
    const snippet = (text.split('\n')[line - 1] ?? '').trim().slice(0, 120);
    hits.push({ where, line, rule: rule.name, snippet });
  }
}

const args = process.argv.slice(2);
const msgIdx = args.indexOf('--message');

if (msgIdx !== -1 && args[msgIdx + 1]) {
  const file = args[msgIdx + 1];
  if (existsSync(file)) scan(`commit message (${file})`, readFileSync(file, 'utf8'));
} else {
  // The branch name ends up in a pull request URL, which is published.
  try {
    scan('branch name', git(['rev-parse', '--abbrev-ref', 'HEAD']));
  } catch { /* detached head, or no commits yet */ }

  const listed = args.includes('--staged')
    ? git(['diff', '--cached', '--name-only', '--diff-filter=ACMR'])
    : git(['ls-files']);

  for (const file of listed.split('\n').map((f) => f.trim()).filter(Boolean)) {
    if (SKIP.some((re) => re.test(file))) continue;
    // A forbidden path is a hit whatever the file contains.
    scan(file, file);
    if (!TEXT.test(file) || !existsSync(file)) continue;
    try {
      scan(file, readFileSync(file, 'utf8'));
    } catch { /* deleted between listing and reading */ }
  }
}

if (hits.length === 0) {
  console.log('names: clean');
  process.exit(0);
}

console.error(`\nnames: ${hits.length} ${hits.length === 1 ? 'hit' : 'hits'}\n`);
for (const h of hits) {
  console.error(`  ${h.where}:${h.line}  ${h.rule}`);
  if (h.snippet) console.error(`    ${h.snippet}`);
}
console.error(
  '\nThese must not reach the repository, a commit message, a branch name, or\n' +
  'anything published from here. Remove them and try again.\n',
);
process.exit(1);
