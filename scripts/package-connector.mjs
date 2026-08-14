#!/usr/bin/env node
/**
 * Build the gobo connector: the bridge as one executable file.
 *
 * A browser cannot open a UDP socket, so reaching an Art-Net node always needs
 * something native. This makes that something a single file a visitor
 * downloads and runs, with no repository, no Node install and no terminal.
 * After it is running, the hosted build drives their rig.
 *
 *   npm run package
 *
 * Node's Single Executable Applications feature does the work: bundle to one
 * CommonJS file, generate a blob, copy the node binary, inject the blob. Only
 * builds for the platform it runs on, so the release workflow runs it on
 * Windows, macOS and Linux.
 */

import { mkdirSync, copyFileSync, writeFileSync, rmSync, existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { platform } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const work = join(root, '.package-work');
const out = join(root, 'release');

const NAMES = { win32: 'gobo-connector-windows.exe', darwin: 'gobo-connector-macos', linux: 'gobo-connector-linux' };
const exeName = NAMES[platform()] ?? `gobo-connector-${platform()}`;

rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
mkdirSync(out, { recursive: true });

// 1. Bundle the bridge and its one dependency into a single CommonJS file.
//    SEA only accepts CommonJS, and ws would otherwise need node_modules
//    beside the executable.
//
//    import.meta.url has no meaning in CommonJS. The bridge only uses it to
//    find its config file, and the packaged build resolves that from
//    process.execPath instead, so pointing it at the executable keeps the
//    expression valid without changing behaviour.
//    Through esbuild's JS API rather than its bin: on Linux and macOS that
//    path is the native Go executable, so running it with node parses an ELF
//    header as JavaScript and dies with a SyntaxError.
console.log('[package] bundling');
await build({
  entryPoints: [join(root, 'packages', 'bridge', 'src', 'index.ts')],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: join(work, 'bundle.cjs'),
  define: { 'import.meta.url': '__GOBO_EXEC_URL__' },
  banner: { js: 'const __GOBO_EXEC_URL__ = require("url").pathToFileURL(process.execPath).href;' },
  logLevel: 'info',
});

// 2. Blob.
console.log('[package] generating the SEA blob');
writeFileSync(join(work, 'sea-config.json'), JSON.stringify({
  main: join(work, 'bundle.cjs'),
  output: join(work, 'sea-prep.blob'),
  disableExperimentalSEAWarning: true,
}, null, 2));
execFileSync(process.execPath, ['--experimental-sea-config', join(work, 'sea-config.json')], { stdio: 'inherit' });

// 3. Copy the running node binary, then inject.
const target = join(out, exeName);
console.log(`[package] building ${exeName}`);
copyFileSync(process.execPath, target);

const postject = join(root, 'node_modules', 'postject', 'dist', 'cli.js');
const injectArgs = [
  postject, target, 'NODE_SEA_BLOB', join(work, 'sea-prep.blob'),
  '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
];
// macOS binaries are signed, and injecting invalidates it, so the section has
// to be named and the binary re-signed afterwards.
if (platform() === 'darwin') injectArgs.push('--macho-segment-name', 'NODE_SEA');
execFileSync(process.execPath, injectArgs, { stdio: 'inherit' });

if (platform() === 'darwin') {
  try {
    execFileSync('codesign', ['--sign', '-', target], { stdio: 'inherit' });
  } catch {
    console.warn('[package] ad-hoc codesign failed; macOS will refuse to run this binary');
  }
}

rmSync(work, { recursive: true, force: true });
const mb = (statSync(target).size / 1024 / 1024).toFixed(1);
console.log(`[package] ${target} (${mb} MB)`);

if (!existsSync(target)) process.exit(1);
