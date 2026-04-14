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
  sendCodeTD,
} from '@lumen/core';

import { createEditor, getEditorCode } from './editor.js';
import { initVisualizer, updateVisualizer } from './visualizer.js';
import { renderDocs } from './docs.js';
import { refreshViz } from './inline-viz.js';

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
    // Push the exact code that just got evaluated to TD so its visual
    // is in sync with what's actually running (not the typing-debounced copy).
    sendCodeTD(code);
    // Rebuild inline editor visualizations to reflect any .viz() calls
    // in the new code. Widgets animate from the live universe buffer; this
    // call only (re)places them in the editor at the right lines.
    refreshViz(editorView);
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

// Debounced code-text streamer. Fires on keystrokes, paste, undo, etc.
// Throttled so we don't flood TD with a message per keypress — ~250ms
// feels "live" while keeping the wire quiet.
const CODE_STREAM_DEBOUNCE_MS = 250;
let _codeStreamTimer: ReturnType<typeof setTimeout> | null = null;
function onCodeChange(code: string): void {
  if (_codeStreamTimer) clearTimeout(_codeStreamTimer);
  _codeStreamTimer = setTimeout(() => {
    sendCodeTD(code);
    _codeStreamTimer = null;
  }, CODE_STREAM_DEBOUNCE_MS);
}

const editorView = createEditor(editorEl, runEval, runStop, onCodeChange);

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
  // When TD comes online (first connect or reconnect), push the
  // current editor contents so the text visual is populated immediately.
  if (connected) {
    sendCodeTD(getEditorCode(editorView));
  }
});

connectBridge();

// ─── Fixture simulation ──────────────────────────────────────────────────────
// Maps demo fixture channels to the little glowing elements in the sim panel.
// Layout matches the default init code in editor.ts:
//   ch1-4   = wash A RGBW
//   ch5-8   = wash B RGBW
//   ch9     = spot (single dimmer)
//   ch10-11 = strobe (dim + strobe rate)
//   ch12-41 = 10-pixel RGB strip

const simWashA  = document.getElementById('sim-wash-a') as HTMLElement;
const simWashB  = document.getElementById('sim-wash-b') as HTMLElement;
const simSpot   = document.getElementById('sim-spot')   as HTMLElement;
const simStrobe = document.getElementById('sim-strobe') as HTMLElement;
const simStrip  = document.getElementById('sim-strip')  as HTMLElement;

const SIM_STRIP_START_CH = 12; // 1-indexed DMX
const SIM_STRIP_PIXELS = 10;

// Build strip pixel elements once.
const stripPixelEls: HTMLElement[] = [];
for (let i = 0; i < SIM_STRIP_PIXELS; i++) {
  const p = document.createElement('div');
  p.className = 'fixture-strip-pixel';
  simStrip.appendChild(p);
  stripPixelEls.push(p);
}

/**
 * Single-dimmer globe — fixture has a fixed tint, the dimmer channel scales it.
 * Used for spot and strobe.
 */
function updateGlobeDim(
  el: HTMLElement,
  dimmer: number,   // 0-255
  r: number, g: number, b: number  // fixture's native tint, 0-255 each
): void {
  const d = dimmer / 255;
  if (d < 0.02) {
    el.style.background = '#1a1714';
    el.style.boxShadow = 'none';
    return;
  }
  const ri = Math.round(r * d);
  const gi = Math.round(g * d);
  const bi = Math.round(b * d);
  const glowR = Math.min(255, Math.round(ri * 1.5));
  const glowG = Math.min(255, Math.round(gi * 1.5));
  const glowB = Math.min(255, Math.round(bi * 1.5));
  el.style.background = `rgb(${ri},${gi},${bi})`;
  el.style.boxShadow = `0 0 ${Math.round(d * 24)}px ${Math.round(d * 12)}px rgba(${glowR},${glowG},${glowB},${(d * 0.7).toFixed(2)})`;
}

/**
 * RGBW globe — each channel directly contributes to the output, matching how
 * generic-rgbw actually behaves. White mixes equally into R/G/B. No master
 * dimmer, so a sine on .red() produces an undistorted sine on screen.
 * (The old logic multiplied by max(R,G,B,W), which double-scaled the waveform.)
 */
function updateGlobeRGBW(
  el: HTMLElement,
  r: number, g: number, b: number, w: number, // 0-255 each
): void {
  const rr = Math.min(255, r + w);
  const gg = Math.min(255, g + w);
  const bb = Math.min(255, b + w);
  const brightness = Math.max(rr, gg, bb) / 255;
  if (brightness < 0.02) {
    el.style.background = '#1a1714';
    el.style.boxShadow = 'none';
    return;
  }
  const glowR = Math.min(255, Math.round(rr * 1.5));
  const glowG = Math.min(255, Math.round(gg * 1.5));
  const glowB = Math.min(255, Math.round(bb * 1.5));
  el.style.background = `rgb(${rr},${gg},${bb})`;
  el.style.boxShadow = `0 0 ${Math.round(brightness * 24)}px ${Math.round(brightness * 12)}px rgba(${glowR},${glowG},${glowB},${(brightness * 0.7).toFixed(2)})`;
}

/** Small rectangular pixel in the strip sim. No master dimmer. */
function updateStripPixel(el: HTMLElement, r: number, g: number, b: number): void {
  const brightness = Math.max(r, g, b) / 255;
  if (brightness < 0.02) {
    el.style.background = '#1a1714';
    el.style.boxShadow = 'none';
    return;
  }
  el.style.background = `rgb(${r},${g},${b})`;
  el.style.boxShadow = `0 0 ${Math.round(brightness * 6)}px rgba(${r},${g},${b},${(brightness * 0.7).toFixed(2)})`;
}

setInterval(() => {
  const ch = getUniverse1Snapshot();
  // wash A: ch 1-4 RGBW
  updateGlobeRGBW(simWashA, ch[0], ch[1], ch[2], ch[3]);
  // wash B: ch 5-8 RGBW
  updateGlobeRGBW(simWashB, ch[4], ch[5], ch[6], ch[7]);
  // spot: ch 9, warm white tint
  updateGlobeDim(simSpot, ch[8], 255, 240, 210);
  // strobe: ch 10 dim (ch 11 strobe-rate isn't visualised)
  updateGlobeDim(simStrobe, ch[9], 255, 255, 255);
  // strip: ch 12..41 as 10 RGB pixels
  for (let i = 0; i < SIM_STRIP_PIXELS; i++) {
    const base = (SIM_STRIP_START_CH - 1) + i * 3; // 0-indexed into the buffer
    updateStripPixel(stripPixelEls[i], ch[base], ch[base + 1], ch[base + 2]);
  }
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
