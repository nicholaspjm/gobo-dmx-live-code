#!/usr/bin/env node
/**
 * Start gobo: one command, one process, browser opens itself.
 *
 * A browser cannot open a UDP socket, so something native has to run for
 * Art-Net or sACN to reach a rig. This makes that thing the only thing you
 * start: it serves the app and speaks UDP from the same process, on one port,
 * so the page's WebSocket is same-origin and there is no second thing to
 * forget.
 *
 *   npm start                    build if needed, serve, open a browser
 *   npm start -- --no-open       same, without opening a browser
 *   npm start -- --rebuild       force a fresh UI build first
 *
 * For development use `npm run dev` instead, which runs Vite with hot reload
 * and the bridge alongside it.
 */

import { existsSync, statSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const uiDist = join(root, 'dist');
const bridgeEntry = join(root, 'packages', 'bridge', 'dist', 'index.js');

const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log(`gobo

  npm start                  build if needed, serve the app, open a browser
  npm start -- --no-open     do not open a browser
  npm start -- --rebuild     rebuild the UI first

Development with hot reload: npm run dev
`);
  process.exit(0);
}

function run(label, cmd, cmdArgs) {
  console.log(`[gobo] ${label}`);
  // npm is a .cmd shim on Windows. Naming it directly avoids shell: true,
  // which Node deprecates for arg-escaping reasons and which prints a warning
  // in the middle of the startup output.
  const exe = process.platform === 'win32' && cmd === 'npm' ? 'npm.cmd' : cmd;
  const r = spawnSync(exe, cmdArgs, { cwd: root, stdio: 'inherit' });
  if (r.status !== 0) {
    console.error(`[gobo] ${label} failed. Try running it directly to see why: ${cmd} ${cmdArgs.join(' ')}`);
    process.exit(1);
  }
}

/** Newest mtime under a directory, so a stale build can be noticed. */
function newestMtime(dir, skip = new Set(['node_modules', 'dist', '.git'])) {
  let newest = 0;
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      if (skip.has(entry.name)) continue;
      const p = join(d, entry.name);
      if (entry.isDirectory()) walk(p);
      else newest = Math.max(newest, statSync(p).mtimeMs);
    }
  };
  try { walk(dir); } catch { /* unreadable tree, fall through to building */ }
  return newest;
}

const uiBuilt = existsSync(join(uiDist, 'index.html'));
const uiStale = uiBuilt
  && newestMtime(join(root, 'packages', 'ui')) > statSync(join(uiDist, 'index.html')).mtimeMs;

if (args.includes('--rebuild') || !uiBuilt || uiStale) {
  run(uiBuilt ? 'UI changed since the last build, rebuilding' : 'building the app', 'npm', ['run', 'build']);
}

const bridgeBuilt = existsSync(bridgeEntry);
const bridgeStale = bridgeBuilt
  && newestMtime(join(root, 'packages', 'bridge')) > statSync(bridgeEntry).mtimeMs;

if (args.includes('--rebuild') || !bridgeBuilt || bridgeStale) {
  run(bridgeBuilt ? 'bridge changed since the last build, rebuilding' : 'building the bridge', 'npm', ['run', 'bridge:build']);
}

// Hand the bridge its flags, then run it in THIS process rather than spawning
// a child, so there is exactly one process to start and to stop.
process.argv = [
  process.argv[0],
  bridgeEntry,
  '--ui', uiDist,
  ...(args.includes('--no-open') ? [] : ['--open']),
];

console.log('[gobo] starting');
await import(pathToFileURL(bridgeEntry).href);
