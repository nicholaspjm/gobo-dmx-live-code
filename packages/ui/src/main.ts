/**
 * lumen — main entry point
 *
 * Wires together:
 *   - @lumen/core (scheduler, DMX state, eval, WS client)
 *   - CodeMirror editor
 *   - Canvas visualizer
 *   - Top-bar status updates
 */

import {
  start,
  stop,
  isRunning,
  onTick,
  getBPM,
  getCycleFraction,
  tick,
  getAllUniverses,
  getUniverse1Snapshot,
  evalCode,
  initStrudel,
  connectBridge,
  onStatusChange,
  sendUniverseState,
} from '@lumen/core';

import { createEditor } from './editor.js';
import { initVisualizer, updateVisualizer } from './visualizer.js';

// ─── DOM refs ────────────────────────────────────────────────────────────────

const editorEl = document.getElementById('editor')!;
const visualizerEl = document.getElementById('visualizer') as HTMLCanvasElement;
const evalStatusEl = document.getElementById('eval-status')!;
const bpmValEl = document.getElementById('bpm-val')!;
const cycleFillEl = document.getElementById('cycle-fill')!;
const wsDotEl = document.getElementById('ws-dot')!;
const wsLabelEl = document.getElementById('ws-label')!;

// ─── Eval ────────────────────────────────────────────────────────────────────

function runEval(code: string): void {
  const result = evalCode(code);
  if (result.success) {
    setStatus('ok', '✓ running');
    if (!isRunning()) start();
  } else {
    setStatus('error', result.error ?? 'unknown error');
  }
}

function runStop(): void {
  stop();
  setStatus('', 'stopped — ctrl+enter to run');
}

function setStatus(kind: '' | 'ok' | 'error', msg: string): void {
  evalStatusEl.textContent = msg;
  evalStatusEl.className = kind;
}

// ─── Editor ──────────────────────────────────────────────────────────────────

createEditor(editorEl, runEval, runStop);

// ─── Visualizer ──────────────────────────────────────────────────────────────

initVisualizer(visualizerEl);

// ─── Scheduler tick ──────────────────────────────────────────────────────────

// Throttle bridge sends: every ~3 ticks ≈ 15hz is plenty for DMX
let _sendCounter = 0;
const SEND_EVERY = 3;

onTick((cyclePos, _delta) => {
  // 1. Resolve patterns → DMX channel values
  tick(cyclePos);

  // 2. Push to visualizer (gets the live universe-1 buffer)
  updateVisualizer(getUniverse1Snapshot());

  // 3. Send to bridge (throttled)
  _sendCounter++;
  if (_sendCounter >= SEND_EVERY) {
    _sendCounter = 0;
    sendUniverseState(getAllUniverses());
  }
});

// ─── Status bar updates ───────────────────────────────────────────────────────

// Update BPM display and cycle bar at ~10 fps
setInterval(() => {
  bpmValEl.textContent = String(getBPM());
  cycleFillEl.style.width = `${(getCycleFraction() * 100).toFixed(1)}%`;
}, 100);

// ─── Bridge connection ───────────────────────────────────────────────────────

onStatusChange((connected) => {
  wsDotEl.className = `ws-dot ${connected ? 'connected' : 'disconnected'}`;
  wsLabelEl.textContent = connected ? 'bridge' : 'disconnected';
});

connectBridge();

// ─── Fixture simulation globes ───────────────────────────────────────────────
// Maps demo fixture channels to the little glowing circles in the sim panel.
// ch1-4 = wash A RGBW, ch5-8 = wash B RGBW
// ch9 = spot, ch10-11 = strobe

const simWashA = document.getElementById('sim-wash-a') as HTMLElement;
const simWashB = document.getElementById('sim-wash-b') as HTMLElement;
const simSpot  = document.getElementById('sim-spot')   as HTMLElement;
const simStrobe = document.getElementById('sim-strobe') as HTMLElement;

function updateGlobe(
  el: HTMLElement,
  dimmer: number,   // 0-255
  r: number, g: number, b: number  // 0-255 each
): void {
  const d = dimmer / 255;  // 0-1
  const ri = Math.round(r * d);
  const gi = Math.round(g * d);
  const bi = Math.round(b * d);
  const brightness = d;
  const glowR = Math.round(ri * 1.5);
  const glowG = Math.round(gi * 1.5);
  const glowB = Math.round(bi * 1.5);
  if (brightness < 0.02) {
    el.style.background = '#1a1714';
    el.style.boxShadow = 'none';
  } else {
    el.style.background = `rgb(${ri},${gi},${bi})`;
    el.style.boxShadow = `0 0 ${Math.round(brightness * 24)}px ${Math.round(brightness * 12)}px rgba(${glowR},${glowG},${glowB},${(brightness * 0.7).toFixed(2)})`;
  }
}

setInterval(() => {
  const ch = getUniverse1Snapshot();
  // wash A: ch1-4 RGBW (dimmer = max of channels)
  const waDim = Math.max(ch[0], ch[1], ch[2], ch[3]);
  updateGlobe(simWashA, waDim, Math.min(255, ch[0] + ch[3]), Math.min(255, ch[1] + ch[3]), Math.min(255, ch[2] + ch[3]));
  // wash B: ch5-8 RGBW
  const wbDim = Math.max(ch[4], ch[5], ch[6], ch[7]);
  updateGlobe(simWashB, wbDim, Math.min(255, ch[4] + ch[7]), Math.min(255, ch[5] + ch[7]), Math.min(255, ch[6] + ch[7]));
  // spot: ch9, white light
  updateGlobe(simSpot, ch[8], 255, 240, 210);
  // strobe: ch10 dim, white flash
  updateGlobe(simStrobe, ch[9], 255, 255, 255);
}, 33); // ~30fps

// ─── Init ────────────────────────────────────────────────────────────────────

initStrudel().then(() => {
  console.log('[lumen] ready');
  setStatus('', 'ctrl+enter to run  ·  ctrl+. to stop');
});
