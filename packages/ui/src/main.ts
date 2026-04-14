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
  onTDStatusChange,
  sendUniverseState,
  sendUniverseStateTD,
} from '@lumen/core';

import { createEditor } from './editor.js';
import { initVisualizer, updateVisualizer } from './visualizer.js';
import { renderDocs } from './docs.js';

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

// Cap DMX output rate at ~60 Hz so 120/144/240 Hz displays don't flood
// the downstream over a USB DMX node or WiFi. On localhost this is
// irrelevant, but it's polite to network gear and enough to look smooth.
const SEND_INTERVAL_MS = 1000 / 60;
let _lastSendMs = 0;

onTick((cyclePos, _delta) => {
  // 1. Resolve patterns → DMX channel values
  tick(cyclePos);

  // 2. Push to visualizer (gets the live universe-1 buffer)
  updateVisualizer(getUniverse1Snapshot());

  // 3. Send to bridge or direct-to-TD (time-throttled to ~60 Hz).
  // Each sender internally checks the current output target and no-ops
  // if it isn't the active one, so only one actually transmits.
  const now = performance.now();
  if (now - _lastSendMs >= SEND_INTERVAL_MS) {
    _lastSendMs = now;
    const universes = getAllUniverses();
    sendUniverseState(universes);
    sendUniverseStateTD(universes);
  }
});

// ─── Status bar updates ───────────────────────────────────────────────────────

// Update BPM display and cycle bar at ~10 fps
setInterval(() => {
  bpmValEl.textContent = String(getBPM());
  cycleFillEl.style.width = `${(getCycleFraction() * 100).toFixed(1)}%`;
}, 100);

// ─── Bridge connection ───────────────────────────────────────────────────────

// Combined status: either 'bridge' or 'td' can be connected (or neither).
// We show whichever is live — TD takes precedence when both happen to be up,
// since calling td() is an explicit opt-in to direct output.
let _bridgeLive = false;
let _tdLive = false;

function refreshWsUi(): void {
  if (_tdLive) {
    wsDotEl.className = 'ws-dot connected';
    wsLabelEl.textContent = 'td';
  } else if (_bridgeLive) {
    wsDotEl.className = 'ws-dot connected';
    wsLabelEl.textContent = 'bridge';
  } else {
    wsDotEl.className = 'ws-dot disconnected';
    wsLabelEl.textContent = 'disconnected';
  }
}

onStatusChange((connected) => {
  _bridgeLive = connected;
  refreshWsUi();
});

onTDStatusChange((connected) => {
  _tdLive = connected;
  refreshWsUi();
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

// ─── Docs panel ──────────────────────────────────────────────────────────────

const docsToggleEl = document.getElementById('docs-toggle') as HTMLButtonElement;
const docsCloseEl = document.getElementById('docs-close') as HTMLButtonElement;
const docsPanelEl = document.getElementById('docs-panel') as HTMLElement;
const docsBodyEl = document.getElementById('docs-body') as HTMLElement;

renderDocs(docsBodyEl);

function setDocsOpen(open: boolean): void {
  docsPanelEl.classList.toggle('open', open);
  docsPanelEl.setAttribute('aria-hidden', open ? 'false' : 'true');
  docsToggleEl.classList.toggle('active', open);
}

docsToggleEl.addEventListener('click', () => {
  setDocsOpen(!docsPanelEl.classList.contains('open'));
});
docsCloseEl.addEventListener('click', () => setDocsOpen(false));

// Close on Escape for accessibility
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && docsPanelEl.classList.contains('open')) {
    setDocsOpen(false);
  }
});

// ─── Init ────────────────────────────────────────────────────────────────────

initStrudel().then(() => {
  console.log('[lumen] ready');
  setStatus('', 'ctrl+enter to run  ·  ctrl+. to stop');
});
