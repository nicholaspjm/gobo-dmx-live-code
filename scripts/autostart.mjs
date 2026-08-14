#!/usr/bin/env node
/**
 * Run the bridge automatically at login.
 *
 * A web page cannot start a process, so "open the page and it works" has to be
 * arranged the other way round: have the bridge already running. This installs
 * a per-user login item that starts it in the background. After that, both the
 * hosted build and http://localhost:3001 have output working with nothing to
 * launch.
 *
 *   npm run autostart              install for the current user
 *   npm run autostart -- --status  is it installed, is it running
 *   npm run autostart -- --remove  uninstall
 *   npm run autostart -- --dry-run print what would be written, write nothing
 *
 * Per-user only. Nothing here needs administrator rights, touches the registry,
 * or installs a system service.
 */

import { writeFileSync, existsSync, unlinkSync, mkdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir, platform } from 'node:os';
import { spawnSync, spawn } from 'node:child_process';
import { connect } from 'node:net';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const bridgeEntry = join(root, 'packages', 'bridge', 'dist', 'index.js');
const uiDist = join(root, 'dist');
const PORT = 3001;

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');

if (args.includes('--help')) {
  console.log(`gobo autostart

  npm run autostart              start the bridge at login (current user)
  npm run autostart -- --status  show whether it is installed and running
  npm run autostart -- --remove  remove it
  npm run autostart -- --dry-run show what would be written
`);
  process.exit(0);
}

// ─── Where the login item lives, per platform ────────────────────────────────

function target() {
  const home = homedir();
  switch (platform()) {
    case 'win32':
      return {
        // A .vbs wrapper because a .cmd flashes a console window at every
        // login. WScript.Shell with mode 0 starts it with no window at all.
        path: join(home, 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'gobo-bridge.vbs'),
        body: [
          "' Starts the gobo bridge at login, with no visible window.",
          "' Delete this file, or run: npm run autostart -- --remove",
          'Set sh = CreateObject("WScript.Shell")',
          `sh.Run "node ""${bridgeEntry}"" --ui ""${uiDist}""", 0, False`,
          '',
        ].join('\r\n'),
        note: 'Startup folder',
      };
    case 'darwin':
      return {
        path: join(home, 'Library', 'LaunchAgents', 'dev.gobo.bridge.plist'),
        body: `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>dev.gobo.bridge</string>
  <key>ProgramArguments</key>
  <array>
    <string>${process.execPath}</string>
    <string>${bridgeEntry}</string>
    <string>--ui</string>
    <string>${uiDist}</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><false/>
</dict>
</plist>
`,
        note: 'LaunchAgent',
        after: (p) => `Load it now with: launchctl load ${p}`,
      };
    default:
      return {
        path: join(home, '.config', 'systemd', 'user', 'gobo-bridge.service'),
        body: `[Unit]
Description=gobo bridge

[Service]
ExecStart=${process.execPath} ${bridgeEntry} --ui ${uiDist}
Restart=on-failure

[Install]
WantedBy=default.target
`,
        note: 'systemd user unit',
        after: () => 'Enable it with: systemctl --user enable --now gobo-bridge',
      };
  }
}

// ─── Status ──────────────────────────────────────────────────────────────────

function bridgeRunning() {
  return new Promise((resolve) => {
    const c = connect({ port: PORT, host: '127.0.0.1' });
    const done = (v) => { try { c.destroy(); } catch {} resolve(v); };
    c.on('connect', () => done(true));
    c.on('error', () => done(false));
    setTimeout(() => done(false), 1000);
  });
}

const t = target();

if (args.includes('--status')) {
  const installed = existsSync(t.path);
  console.log(`login item  ${installed ? 'installed' : 'not installed'}  (${t.path})`);
  console.log(`bridge      ${(await bridgeRunning()) ? `running on ${PORT}` : 'not running'}`);
  process.exit(0);
}

if (args.includes('--remove')) {
  if (!existsSync(t.path)) {
    console.log('nothing to remove');
  } else if (dryRun) {
    console.log(`would delete ${t.path}`);
  } else {
    unlinkSync(t.path);
    console.log(`removed ${t.path}`);
    console.log('A bridge already running stays up until you close it or log out.');
  }
  process.exit(0);
}

// ─── Install ─────────────────────────────────────────────────────────────────

if (!existsSync(bridgeEntry)) {
  console.log('[gobo] building the bridge first');
  // Invoke tsc directly: Node refuses to spawn npm's .cmd shim on Windows
  // without a shell, and a shell brings its own deprecation warning.
  const tsc = join(root, 'node_modules', 'typescript', 'bin', 'tsc');
  const r = spawnSync(process.execPath, [tsc, '-p', join(root, 'packages', 'bridge', 'tsconfig.json')], { cwd: root, stdio: 'inherit' });
  if (r.error || r.status !== 0) {
    console.error('[gobo] bridge build failed, nothing installed');
    process.exit(1);
  }
}
if (!existsSync(join(uiDist, 'index.html'))) {
  console.log('[gobo] note: the app is not built, so http://localhost:3001 will 404 until you run npm run build.');
  console.log('       Output still works from the hosted site, which is the usual reason to use this.');
}

if (dryRun) {
  console.log(`would write ${t.path}\n`);
  console.log(t.body);
  process.exit(0);
}

mkdirSync(dirname(t.path), { recursive: true });
writeFileSync(t.path, t.body, 'utf8');
console.log(`installed ${t.note}: ${t.path}`);

if (t.after) console.log(t.after(t.path));

if (!(await bridgeRunning())) {
  console.log('[gobo] starting it now so you do not have to log out first');
  const child = spawn(process.execPath, [bridgeEntry, '--ui', uiDist], { detached: true, stdio: 'ignore' });
  child.unref();
  await new Promise((r) => setTimeout(r, 1200));
}
console.log(`bridge ${(await bridgeRunning()) ? 'is running' : 'did not start, run npm start to see why'}`);
console.log('Remove it any time with: npm run autostart -- --remove');
