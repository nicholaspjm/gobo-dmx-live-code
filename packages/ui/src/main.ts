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
  setBPM,
  getCycleFraction,
  tick,
  getAllUniverses,
  getPrimaryUniverseSnapshot,
  getUniverseBuffer,
  evalCode,
  initStrudel,
  connectBridge,
  onStatusChange,
  sendUniverseState,
  updateAudioFrame,
  loadTrack,
  playTrack,
  pauseTrack,
  enableMic,
  disableMic,
  getTrackInfo,
  restoreLibraryFixtures,
} from '@lumen/core';

import { createEditor } from './editor.js';
import { initVisualizer, updateVisualizer } from './visualizer.js';
import { renderDocs } from './docs.js';
import { refreshViz } from './inline-viz.js';
import { mountLibraryPanel } from './library.js';
import { registerPublicFixtures } from './public-fixtures.js';

// ─── DOM refs ────────────────────────────────────────────────────────────────

const editorEl = document.getElementById('editor')!;
const visualizerEl = document.getElementById('visualizer') as HTMLCanvasElement;
const evalStatusEl = document.getElementById('eval-status')!;
const bpmValEl = document.getElementById('bpm-val') as HTMLElement;
const bpmTapEl = document.getElementById('bpm-tap') as HTMLButtonElement;
const cycleFillEl = document.getElementById('cycle-fill')!;
const wsDotEl = document.getElementById('ws-dot')!;
const wsLabelEl = document.getElementById('ws-label')!;

// ─── Eval ────────────────────────────────────────────────────────────────────

function runEval(code: string): void {
  const result = evalCode(code);
  if (result.success) {
    setStatus('ok', '✓ running');
    if (!isRunning()) start();
    // Rebuild inline editor visualizations to reflect any .viz() calls
    // in the new code. Widgets animate from the live universe buffer; this
    // call only (re)places them in the editor at the right lines.
    refreshViz(editorView);
    // Refresh the library panel too — a new defineFixture call might have
    // just added (or replaced) a custom fixture that the user can now save.
    _refreshLibraryAfterEval();
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

const editorView = createEditor(editorEl, runEval, runStop);

// ─── Visualizer ──────────────────────────────────────────────────────────────

initVisualizer(visualizerEl);

// ─── Scheduler tick ──────────────────────────────────────────────────────────

// Cap DMX output rate at ~60 Hz so 120/144/240 Hz displays don't flood
// the downstream over a USB DMX node or WiFi. On localhost this is
// irrelevant, but it's polite to network gear and enough to look smooth.
const SEND_INTERVAL_MS = 1000 / 60;
let _lastSendMs = 0;

onTick((cyclePos, _delta) => {
  // 0. Refresh audio band values before pattern eval so `audio.bass()` etc.
  //    see this frame's values. No-op unless a track is loaded or mic is on.
  updateAudioFrame();

  // 1. Resolve patterns → DMX channel values
  tick(cyclePos);

  // 2. Push to visualizer (gets the live primary-universe buffer)
  updateVisualizer(getPrimaryUniverseSnapshot());

  // 3. Send to bridge (time-throttled to ~60 Hz).
  const now = performance.now();
  if (now - _lastSendMs >= SEND_INTERVAL_MS) {
    _lastSendMs = now;
    sendUniverseState(getAllUniverses());
  }
});

// ─── Status bar updates ──────────────────────────────────────────────────────

// Update cycle bar continuously; BPM display updates too EXCEPT while the
// user is actively editing it (see bpm-edit section below).
let _bpmEditing = false;

setInterval(() => {
  if (!_bpmEditing) bpmValEl.textContent = String(getBPM());
  cycleFillEl.style.width = `${(getCycleFraction() * 100).toFixed(1)}%`;
}, 100);

// ─── BPM inline edit ─────────────────────────────────────────────────────────
// The top-bar BPM span is contenteditable — click it, type a number, hit
// Enter (or blur) to commit. Escape cancels and restores the live value.
// We clamp to the scheduler's 1..400 range; anything invalid reverts.

function commitBpmEdit(): void {
  const raw = (bpmValEl.textContent ?? '').trim();
  const v = parseInt(raw, 10);
  if (Number.isFinite(v) && v >= 1 && v <= 400) {
    setBPM(v);
  }
  // Always snap the text to the authoritative value — handles both
  // successful commits (normalized int) and invalid input (reverted).
  bpmValEl.textContent = String(getBPM());
}

bpmValEl.addEventListener('focus', () => {
  _bpmEditing = true;
  // Select all so typing replaces the current value (matches typical
  // "click a field, type a number" UX).
  const range = document.createRange();
  range.selectNodeContents(bpmValEl);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
});

bpmValEl.addEventListener('blur', () => {
  _bpmEditing = false;
  commitBpmEdit();
});

bpmValEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    bpmValEl.blur();      // triggers commit
  } else if (e.key === 'Escape') {
    e.preventDefault();
    bpmValEl.textContent = String(getBPM());  // revert first
    bpmValEl.blur();
  }
});

// ─── Tap tempo ───────────────────────────────────────────────────────────────
// Click the `tap` button or press T (outside the editor / other inputs) to
// tap along with the beat. After the second tap we keep a rolling buffer of
// timestamps, average the intervals, and push the BPM into the scheduler.
// A 2-second gap without a tap resets the buffer so you don't pollute a new
// tempo with stale data.

const TAP_GAP_RESET_MS = 2000;
const TAP_BUFFER = 8;
let _taps: number[] = [];

function tap(): void {
  const now = performance.now();
  if (_taps.length > 0 && now - _taps[_taps.length - 1] > TAP_GAP_RESET_MS) {
    _taps = [];
  }
  _taps.push(now);
  if (_taps.length > TAP_BUFFER) _taps.shift();

  if (_taps.length >= 2) {
    // Average of consecutive intervals — more forgiving to a single
    // miss-tap than comparing first-to-last.
    let sum = 0;
    for (let i = 1; i < _taps.length; i++) sum += _taps[i] - _taps[i - 1];
    const avgMs = sum / (_taps.length - 1);
    const bpm = Math.round(60000 / avgMs);
    if (bpm >= 1 && bpm <= 400) setBPM(bpm);
  }

  // Visual feedback — a 100ms flash on the button so you can feel the tap.
  bpmTapEl.classList.add('flash');
  setTimeout(() => bpmTapEl.classList.remove('flash'), 100);
}

bpmTapEl.addEventListener('click', tap);

// Global T hotkey — suppressed whenever focus is somewhere you'd actually
// be typing (editor, BPM field, search, audio file input, etc.) so it
// doesn't collide with normal text entry.
document.addEventListener('keydown', (e) => {
  if (e.key !== 't' && e.key !== 'T') return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const active = document.activeElement as HTMLElement | null;
  if (active?.closest(
    '.cm-editor, input, textarea, [contenteditable="true"], [contenteditable="plaintext-only"]',
  )) return;
  e.preventDefault();
  tap();
});

// ─── Bridge connection ───────────────────────────────────────────────────────

onStatusChange((connected) => {
  wsDotEl.className = connected ? 'ws-dot connected' : 'ws-dot disconnected';
  wsLabelEl.textContent = connected ? 'bridge' : 'disconnected';
});

connectBridge();

// ─── Fixture simulation ──────────────────────────────────────────────────────
// Maps demo fixture channels to the little glowing elements in the sim panel.
// Layout matches the default init code in editor.ts:
//   uni 0, ch 1-4   = wash RGBW
//   uni 0, ch 5-6   = strobe (dim + strobe rate)
//   uni 0, ch 7-36  = 10-pixel RGB strip
//   uni 1, ch 1-38  = four-colour moving bar (RGBW pixel segment at ch 7+)

const simWash   = document.getElementById('sim-wash')   as HTMLElement;
const simStrobe = document.getElementById('sim-strobe') as HTMLElement;
const simStrip  = document.getElementById('sim-strip')  as HTMLElement;
const simBar    = document.getElementById('sim-bar')    as HTMLElement;

const SIM_STRIP_START_CH = 7; // 1-indexed DMX
const SIM_STRIP_PIXELS = 10;

// Four-colour moving bar sim — universe 1, RGBW pixels start at ch7.
// (ch1 direction, ch2 speed, ch3 effect, ch4 effectSpeed, ch5 dim, ch6 strobe,
//  ch7-38 = 8 RGBW pixels × 4 channels.)
const SIM_BAR_UNIVERSE = 1;
const SIM_BAR_DIM_CH = 5;            // 1-indexed
const SIM_BAR_PIXEL_START_CH = 7;    // 1-indexed
const SIM_BAR_PIXELS = 8;
const SIM_BAR_STRIDE = 4;            // RGBW

// Build strip pixel elements once.
const stripPixelEls: HTMLElement[] = [];
for (let i = 0; i < SIM_STRIP_PIXELS; i++) {
  const p = document.createElement('div');
  p.className = 'fixture-strip-pixel';
  simStrip.appendChild(p);
  stripPixelEls.push(p);
}

const barPixelEls: HTMLElement[] = [];
for (let i = 0; i < SIM_BAR_PIXELS; i++) {
  const p = document.createElement('div');
  p.className = 'fixture-strip-pixel';
  simBar.appendChild(p);
  barPixelEls.push(p);
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

/**
 * RGBW pixel for the bar sim. White adds to R/G/B additively, and the bar's
 * master dimmer (ch5) scales the whole output so you see the fixture go
 * dark if dim() is dropped to 0.
 */
function updateBarPixel(
  el: HTMLElement,
  r: number, g: number, b: number, w: number,
  dimScale: number, // 0..1
): void {
  const rr = Math.min(255, Math.round((r + w) * dimScale));
  const gg = Math.min(255, Math.round((g + w) * dimScale));
  const bb = Math.min(255, Math.round((b + w) * dimScale));
  const brightness = Math.max(rr, gg, bb) / 255;
  if (brightness < 0.02) {
    el.style.background = '#1a1714';
    el.style.boxShadow = 'none';
    return;
  }
  el.style.background = `rgb(${rr},${gg},${bb})`;
  el.style.boxShadow = `0 0 ${Math.round(brightness * 6)}px rgba(${rr},${gg},${bb},${(brightness * 0.7).toFixed(2)})`;
}

setInterval(() => {
  const ch = getPrimaryUniverseSnapshot();
  // wash: ch 1-4 RGBW
  updateGlobeRGBW(simWash, ch[0], ch[1], ch[2], ch[3]);
  // strobe: ch 5 dim (ch 6 strobe-rate isn't visualised)
  updateGlobeDim(simStrobe, ch[4], 255, 255, 255);
  // strip: ch 7..36 as 10 RGB pixels
  for (let i = 0; i < SIM_STRIP_PIXELS; i++) {
    const base = (SIM_STRIP_START_CH - 1) + i * 3; // 0-indexed into the buffer
    updateStripPixel(stripPixelEls[i], ch[base], ch[base + 1], ch[base + 2]);
  }

  // four-colour moving bar on universe 1 — 8 RGBW pixels, master dim at ch5.
  const barCh = getUniverseBuffer(SIM_BAR_UNIVERSE);
  const dimScale = (barCh[SIM_BAR_DIM_CH - 1] ?? 0) / 255;
  for (let i = 0; i < SIM_BAR_PIXELS; i++) {
    const base = (SIM_BAR_PIXEL_START_CH - 1) + i * SIM_BAR_STRIDE;
    updateBarPixel(
      barPixelEls[i],
      barCh[base] ?? 0,
      barCh[base + 1] ?? 0,
      barCh[base + 2] ?? 0,
      barCh[base + 3] ?? 0,
      dimScale,
    );
  }
}, 33); // ~30fps

// ─── Fixture sim tooltips ────────────────────────────────────────────────────
// Hover over any fixture in the sim panel to see its name, type, universe,
// channel range, and live DMX values. The metadata is hand-curated here
// because the sim panel itself is hand-wired above — we don't introspect
// the fixture registry (which only exists inside the eval sandbox).

interface SimTooltipChannel {
  name: string;
  /** 1-based DMX channel address, absolute within the fixture's universe. */
  ch: number;
  /** When present, the value in the tooltip is rendered as `val (hint)` —
   *  e.g. dim gets '48%', strobe gets '0%'. */
  format?: 'pct' | 'raw';
}

interface SimTooltipFixture {
  el: HTMLElement;
  name: string;
  type: string;
  universe: number;
  /** Human range shown in the tooltip header, e.g. 'ch 1-4'. */
  chRange: string;
  channels: SimTooltipChannel[];
  /** Extra note shown under meta, e.g. '10 pixels × RGB'. */
  note?: string;
}

const simTooltipFixtures: SimTooltipFixture[] = [
  {
    el: simWash, name: 'wash', type: 'generic-rgbw',
    universe: 0, chRange: 'ch 1-4',
    channels: [
      { name: 'red',   ch: 1, format: 'pct' },
      { name: 'green', ch: 2, format: 'pct' },
      { name: 'blue',  ch: 3, format: 'pct' },
      { name: 'white', ch: 4, format: 'pct' },
    ],
  },
  {
    el: simStrobe, name: 'strobe', type: 'strobe-basic',
    universe: 0, chRange: 'ch 5-6',
    channels: [
      { name: 'dim',    ch: 5, format: 'pct' },
      { name: 'strobe', ch: 6, format: 'pct' },
    ],
  },
  {
    el: simStrip, name: 'strip', type: 'rgbStrip',
    universe: 0, chRange: 'ch 7-36',
    note: `${SIM_STRIP_PIXELS} pixels × RGB`,
    // For strips we surface the first pixel only — the rest is noise at
    // tooltip scale. Channel count hint is in the note above.
    channels: [
      { name: 'px0.r', ch: SIM_STRIP_START_CH + 0, format: 'raw' },
      { name: 'px0.g', ch: SIM_STRIP_START_CH + 1, format: 'raw' },
      { name: 'px0.b', ch: SIM_STRIP_START_CH + 2, format: 'raw' },
    ],
  },
  {
    el: simBar, name: 'four-colour bar', type: 'four-color-bar (custom)',
    universe: 1, chRange: 'ch 1-38',
    note: `${SIM_BAR_PIXELS} pixels × RGBW · effect/strobe/dim chs`,
    channels: [
      { name: 'direction',   ch: 1, format: 'raw' },
      { name: 'speed',       ch: 2, format: 'raw' },
      { name: 'effect',      ch: 3, format: 'raw' },
      { name: 'effectSpeed', ch: 4, format: 'raw' },
      { name: 'dim',         ch: 5, format: 'pct' },
      { name: 'strobe',      ch: 6, format: 'pct' },
    ],
  },
];

const tooltipEl = document.getElementById('fixture-tooltip') as HTMLElement;
let _hoveredFixture: SimTooltipFixture | null = null;

/** Format a 0..255 DMX value for the tooltip. */
function formatDmx(raw: number, mode: 'pct' | 'raw' = 'raw'): string {
  if (mode === 'pct') return `${Math.round((raw / 255) * 100)}%`;
  return String(raw);
}

/** Build the tooltip body for a fixture. */
function renderTooltip(f: SimTooltipFixture): void {
  const buf = getUniverseBuffer(f.universe);
  const rows = f.channels.map((c) => {
    const val = buf[c.ch - 1] ?? 0;
    return `<div class="tt-row"><span class="tt-key">${c.name}</span><span class="tt-val">${formatDmx(val, c.format)}</span></div>`;
  }).join('');
  tooltipEl.innerHTML =
    `<div class="tt-name">${f.name}</div>` +
    `<div class="tt-meta">${f.type} · uni ${f.universe} · ${f.chRange}</div>` +
    (f.note ? `<div class="tt-meta">${f.note}</div>` : '') +
    `<div class="tt-divider"></div>` +
    rows;
}

function positionTooltip(rect: DOMRect): void {
  // Anchor above the fixture by default; if there's no room up top, drop
  // it below. Clamp horizontally to the viewport so long fixture names
  // don't push the card offscreen.
  const tt = tooltipEl.getBoundingClientRect();
  const margin = 10;
  const topPref = rect.top - tt.height - margin;
  const top = topPref < 8 ? rect.bottom + margin : topPref;
  let left = rect.left + rect.width / 2 - tt.width / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - tt.width - 8));
  tooltipEl.style.top = `${top}px`;
  tooltipEl.style.left = `${left}px`;
}

for (const f of simTooltipFixtures) {
  f.el.addEventListener('mouseenter', () => {
    _hoveredFixture = f;
    renderTooltip(f);
    tooltipEl.classList.add('open');
    // Position after the browser has laid out the freshly-populated content.
    requestAnimationFrame(() => positionTooltip(f.el.getBoundingClientRect()));
  });
  f.el.addEventListener('mouseleave', () => {
    if (_hoveredFixture === f) {
      _hoveredFixture = null;
      tooltipEl.classList.remove('open');
    }
  });
}

// Live-refresh the tooltip values while hovered. Piggy-backs on a modest
// 10 Hz tick — plenty fast to look live, cheap to run.
setInterval(() => {
  if (_hoveredFixture) renderTooltip(_hoveredFixture);
}, 100);

// ─── Audio transport ─────────────────────────────────────────────────────────
// Wire the buttons in the audio bar. Kept deliberately small — this is an
// optional feature, so it's a file picker, a play/pause toggle, and a mic
// toggle. No scrubber, no waveform strip — patterns get their reactive data
// through the `audio` object in the eval context regardless.

const audioFileEl  = document.getElementById('audio-file')  as HTMLInputElement;
const audioLoadEl  = document.getElementById('audio-load')  as HTMLButtonElement;
const audioPlayEl  = document.getElementById('audio-play')  as HTMLButtonElement;
const audioMicEl   = document.getElementById('audio-mic')   as HTMLButtonElement;
const audioInfoEl  = document.getElementById('audio-info')  as HTMLElement;

function formatTime(sec: number): string {
  if (!Number.isFinite(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function refreshAudioUi(): void {
  const info = getTrackInfo();
  if (info.source === 'mic') {
    audioPlayEl.disabled = true;
    audioPlayEl.textContent = '▶';
    audioMicEl.classList.add('active');
    audioInfoEl.textContent = 'mic live';
    return;
  }
  audioMicEl.classList.remove('active');
  if (info.source === 'file') {
    audioPlayEl.disabled = false;
    audioPlayEl.textContent = info.isPlaying ? '❚❚' : '▶';
    const bpmStr = info.bpm ? ` · bpm ${info.bpm}` : '';
    audioInfoEl.textContent =
      `${info.name} · ${formatTime(info.position)} / ${formatTime(info.duration)}${bpmStr}`;
    return;
  }
  audioPlayEl.disabled = true;
  audioPlayEl.textContent = '▶';
  audioInfoEl.textContent = 'no track';
}

audioLoadEl.addEventListener('click', () => audioFileEl.click());

audioFileEl.addEventListener('change', async () => {
  const file = audioFileEl.files?.[0];
  if (!file) return;
  audioInfoEl.textContent = `analysing ${file.name}…`;
  try {
    await loadTrack(file);
  } catch (err) {
    audioInfoEl.textContent = `load failed: ${(err as Error).message}`;
    return;
  }
  refreshAudioUi();
  // Reset the input so picking the same file again still fires 'change'.
  audioFileEl.value = '';
});

audioPlayEl.addEventListener('click', async () => {
  const info = getTrackInfo();
  if (info.source !== 'file') return;
  if (info.isPlaying) pauseTrack();
  else await playTrack();
  refreshAudioUi();
});

audioMicEl.addEventListener('click', async () => {
  const info = getTrackInfo();
  if (info.source === 'mic') {
    disableMic();
  } else {
    await enableMic();
  }
  refreshAudioUi();
});

// Keep the info text current while a track plays (cheap — just one tick/sec).
setInterval(refreshAudioUi, 500);

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

// ─── Fixture library panel ───────────────────────────────────────────────────

const libraryPanel = mountLibraryPanel({
  panelEl:  document.getElementById('library-panel')  as HTMLElement,
  bodyEl:   document.getElementById('library-body')   as HTMLElement,
  toggleEl: document.getElementById('library-toggle') as HTMLButtonElement,
  closeEl:  document.getElementById('library-close')  as HTMLButtonElement,
});

// After every successful eval, any new defineFixture() calls land in the
// runtime registry. Refresh the library panel so those show up in the
// "Defined this session" section as save-able.
const _refreshLibraryAfterEval = (): void => libraryPanel.refresh();

// ─── Init ────────────────────────────────────────────────────────────────────

// Register the bundled public-library fixtures so `fixture(1, 'any-public-id')`
// works without clicking "add" first. Public fixtures go in first; the user's
// localStorage library is restored next so a user-pinned version of a public
// id (if any) wins.
registerPublicFixtures();
restoreLibraryFixtures();

initStrudel().then(() => {
  console.log('[lumen] ready');
  setStatus('', 'ctrl+enter to run  ·  ctrl+. to stop');
});
