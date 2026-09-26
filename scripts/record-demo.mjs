#!/usr/bin/env node
/**
 * Record docs/media/demo.gif, docs/media/screenshot.png and the link preview,
 * packages/ui/public/og.png, from the real app.
 *
 * The README's GIF is the first thing anyone sees of gobo, and the last one
 * went a whole release showing a top bar that no longer existed, because
 * recording it was a manual job nobody remembered to redo. This makes it one
 * command, run against the build that is about to ship.
 *
 * What it records is the point of the tool rather than a tour of it: a scene
 * running, an edit typed into it, ctrl+enter, and the lights answering. The
 * edit is typed a character at a time through the real editor, so what the
 * GIF shows is what happens: the autocomplete, the brackets closing, the flash
 * on run.
 *
 *   npm run build && npm run bridge:build
 *   node scripts/record-demo.mjs
 *
 * Needs Google Chrome (or CHROME=/path/to/chrome) and ffmpeg on the PATH. It
 * starts the connector on 3001 to serve the build, so nothing else may be on
 * that port, and it stops everything it started when it finishes. Nothing is
 * left running.
 */

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, 'package.json'));
const { WebSocket } = require('ws');

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEBUG_PORT = 9223;
const APP = 'http://localhost:3001/';
const WIDTH = 900;
const HEIGHT = 563;
const FPS = 12.5;

/**
 * The scene. Short enough to be read at GIF size, and every line of it doing
 * something visible: the wash on mini-notation, the strip chasing, the strobe
 * on the offbeat. The edit swaps the strip's rainbow for a red and amber chase,
 * which is the one change in it that reads from across a room.
 */
const SCENE = `// gobo · write it, ctrl+enter, the rig follows
setBPM(124)

const wash  = fixture(1, 'rgbw').viz('color')
const strip = rgbStrip(5, 16).viz('strip')
const strb  = fixture(60, 'strobe').viz('meter')

wash.red(mini('1 - - -  - - 1 -').glow())
wash.blue('- 1 - -  1 - - 1')

strip.color(amber)
strip.each(mini('1 - - -').fadeOut(2))

strb.dim(mini('- - - -  - - 1 1').settle(0.25).flash())
`;

// A colour swap on the chase: the one change in the scene that reads from
// across a room, and it shows the level running over whatever colour is set.
const EDIT_FROM = 'amber';
const EDIT_TO = 'cyan';

if (!existsSync(join(root, 'dist', 'index.html')) || !existsSync(join(root, 'packages', 'bridge', 'dist', 'index.js'))) {
  console.error('[record] build first: npm run build && npm run bridge:build');
  process.exit(1);
}
if (!existsSync(CHROME)) {
  console.error(`[record] no Chrome at ${CHROME}; set CHROME to its path`);
  process.exit(1);
}

const started = [];
const profile = mkdtempSync(join(tmpdir(), 'gobo-record-'));
const frameDir = mkdtempSync(join(tmpdir(), 'gobo-frames-'));

function stopAll() {
  for (const child of started) {
    try { child.kill(); } catch { /* already gone */ }
  }
}
process.on('exit', stopAll);
process.on('SIGINT', () => { stopAll(); process.exit(130); });

// ─── The connector, serving the build ────────────────────────────────────────

const bridge = spawn(process.execPath, [join(root, 'packages', 'bridge', 'dist', 'index.js'), '--ui', join(root, 'dist')], {
  stdio: ['ignore', 'pipe', 'pipe'],
});
started.push(bridge);
await new Promise((ready, fail) => {
  const timer = setTimeout(() => fail(new Error('the connector did not start; is something else on port 3001?')), 8000);
  bridge.stdout.on('data', (d) => {
    if (String(d).includes('WebSocket server on')) { clearTimeout(timer); ready(); }
  });
  bridge.on('exit', (code) => { clearTimeout(timer); fail(new Error(`the connector exited (${code}); is something else on port 3001?`)); });
});

// ─── Chrome ──────────────────────────────────────────────────────────────────

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${DEBUG_PORT}`,
  `--user-data-dir=${profile}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--hide-scrollbars',
  '--mute-audio',
  `--window-size=${WIDTH},${HEIGHT}`,
  'about:blank',
], { stdio: 'ignore' });
started.push(chrome);

async function pageTarget() {
  for (let i = 0; i < 50; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* not up yet */ }
    await sleep(200);
  }
  throw new Error('Chrome did not open a debugging port');
}

const cdp = new WebSocket(await pageTarget());
await new Promise((open) => cdp.once('open', open));

let nextId = 0;
const pending = new Map();
const listeners = new Map();
cdp.on('message', (raw) => {
  const msg = JSON.parse(String(raw));
  if (msg.id !== undefined) {
    const p = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) p?.fail(new Error(`${msg.error.message}`));
    else p?.done(msg.result);
    return;
  }
  for (const fn of listeners.get(msg.method) ?? []) fn(msg.params);
});
function send(method, params = {}) {
  const id = ++nextId;
  cdp.send(JSON.stringify({ id, method, params }));
  return new Promise((done, fail) => pending.set(id, { done, fail }));
}
function on(method, fn) {
  if (!listeners.has(method)) listeners.set(method, []);
  listeners.get(method).push(fn);
}
async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  return r.result?.value;
}

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false });

// The scene goes in before the app boots, on every load. Setting it from the
// page after load does not stick: the page writes its own buffer back on the
// way out, over whatever was put there.
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `try {
    localStorage.setItem('gobo-buffer-v1', ${JSON.stringify(SCENE)});
    localStorage.setItem('gobo-buffer-file-ref-v1', ${JSON.stringify(SCENE)});
    localStorage.setItem('gobo-seen-connector-v1', '1');
  } catch {}`,
});

const loaded = new Promise((done) => on('Page.loadEventFired', done));
await send('Page.navigate', { url: APP });
await loaded;

for (let i = 0; i < 60; i++) {
  const status = await evaluate(`document.getElementById('eval-status')?.textContent ?? ''`);
  if (status.includes('ctrl+enter to run')) break;
  await sleep(250);
}

// ─── Input ───────────────────────────────────────────────────────────────────

async function rectOf(expression) {
  return evaluate(`(() => { const r = (${expression}); if (!r) return null; const b = r.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; })()`);
}
async function click(x, y) {
  for (const type of ['mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
  }
}
async function key(keyName, code, keyCode, modifiers = 0) {
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: keyName, code, windowsVirtualKeyCode: keyCode, modifiers });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: keyName, code, windowsVirtualKeyCode: keyCode, modifiers });
}
async function type(text, perChar) {
  for (const ch of text) {
    await send('Input.insertText', { text: ch });
    await sleep(perChar);
  }
}
async function status() {
  return evaluate(`document.getElementById('eval-status')?.textContent ?? ''`);
}

// Run it with the button, which is the new thing on the bar worth showing.
const run = await rectOf(`document.getElementById('transport-run')`);
await click(run.x + run.w / 2, run.y + run.h / 2);
await sleep(600);
console.log(`[record] first run: ${await status()}`);

// ─── Record ──────────────────────────────────────────────────────────────────

const frames = [];
on('Page.screencastFrame', (p) => {
  frames.push({ ts: p.metadata.timestamp, data: p.data });
  void send('Page.screencastFrameAck', { sessionId: p.sessionId });
});
await send('Page.startScreencast', { format: 'png', maxWidth: WIDTH, maxHeight: HEIGHT, everyNthFrame: 1 });
const t0 = Date.now() / 1000;

await sleep(3200);

// Put the caret at the end of the call to replace, delete it, type the new one.
const target = await rectOf(`(() => {
  const walker = document.createTreeWalker(document.querySelector('.cm-content'), NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const i = n.textContent.indexOf('amber');
    if (i === -1) continue;
    const line = n.parentElement.closest('.cm-line');
    const range = document.createRange();
    range.selectNodeContents(line);
    return range;
  }
  return null;
})()`);
if (!target) throw new Error('could not find the line to edit');
await click(target.x + target.w + 2, target.y + target.h / 2);
await key('End', 'End', 35);
// Back over the closing bracket, so the colour is what gets deleted.
await key('ArrowLeft', 'ArrowLeft', 37);
await sleep(350);
for (let i = 0; i < EDIT_FROM.length; i++) {
  await key('Backspace', 'Backspace', 8);
  await sleep(45);
}
await sleep(250);
// Typed as a person would, closing brackets and all: the editor's own
// bracket-closing steps over the ones typed after it.
await type(EDIT_TO, 85);
await sleep(500);
// A colour name leaves the completion list open; close it before the run so
// the picture is of the code, not of the popup.
await key('Escape', 'Escape', 27);
await sleep(300);
await key('Enter', 'Enter', 13, 2);
await sleep(300);
console.log(`[record] after the edit: ${await status()}`);
await sleep(4200);

await send('Page.stopScreencast');
const t1 = Date.now() / 1000;

// ─── The still ───────────────────────────────────────────────────────────────
// A larger 2x frame of the same scene for anywhere a still is wanted.

await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false });
await sleep(1200);
const still = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(join(root, 'docs', 'media', 'screenshot.png'), Buffer.from(still.data, 'base64'));

// ─── The link preview ────────────────────────────────────────────────────────
// What a chat app shows when someone pastes the link, and the image to upload
// as the repository's social preview. 1280 by 640 is GitHub's own recommended
// size, and close enough to the 1.91:1 the Open Graph cards use. Captured at 2x
// and scaled down, so the code in it is sharp rather than aliased.

await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 640, deviceScaleFactor: 2, mobile: false });
await sleep(1200);
const preview = await send('Page.captureScreenshot', { format: 'png' });
const previewRaw = join(frameDir, 'og-2x.png');
writeFileSync(previewRaw, Buffer.from(preview.data, 'base64'));

cdp.close();
stopAll();

// ─── Assemble ────────────────────────────────────────────────────────────────
// Screencast frames arrive when the page repaints, not on a clock. Resample to
// a fixed rate by taking, at each tick, the newest frame not after it.

if (frames.length === 0) throw new Error('no frames arrived');
frames.sort((a, b) => a.ts - b.ts);
const start = frames[0].ts;
const duration = Math.min(t1 - t0, frames[frames.length - 1].ts - start + 0.5);
const count = Math.floor(duration * FPS);
let j = 0;
for (let i = 0; i < count; i++) {
  const t = start + i / FPS;
  while (j + 1 < frames.length && frames[j + 1].ts <= t) j++;
  writeFileSync(join(frameDir, `f${String(i).padStart(4, '0')}.png`), Buffer.from(frames[j].data, 'base64'));
}
console.log(`[record] ${frames.length} frames captured, ${count} written at ${FPS} fps`);

const out = join(root, 'docs', 'media', 'demo.gif');
mkdirSync(dirname(out), { recursive: true });
await new Promise((done, fail) => {
  const ff = spawn('ffmpeg', [
    '-loglevel', 'error', '-y',
    '-framerate', String(FPS),
    '-i', join(frameDir, 'f%04d.png'),
    '-vf', 'split[a][b];[a]palettegen=max_colors=160:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle',
    '-loop', '0',
    out,
  ], { stdio: 'inherit' });
  ff.on('exit', (code) => (code === 0 ? done() : fail(new Error(`ffmpeg exited ${code}`))));
});

const og = join(root, 'packages', 'ui', 'public', 'og.png');
await new Promise((done, fail) => {
  const ff = spawn('ffmpeg', ['-loglevel', 'error', '-y', '-i', previewRaw, '-vf', 'scale=1280:640:flags=lanczos', og], { stdio: 'inherit' });
  ff.on('exit', (code) => (code === 0 ? done() : fail(new Error(`ffmpeg exited ${code}`))));
});
console.log(`[record] ${og}: ${(statSync(og).size / 1024).toFixed(0)} kB`);

rmSync(frameDir, { recursive: true, force: true });
rmSync(profile, { recursive: true, force: true });
console.log(`[record] ${out}: ${(statSync(out).size / 1024).toFixed(0)} kB`);
