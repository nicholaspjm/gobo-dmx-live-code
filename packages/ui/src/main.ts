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
  getSimFixtures,
  type SimFixture,
} from '@lumen/core';

import { createEditor, INITIAL_CODE } from './editor.js';
import {
  seedScenesIfEmpty, getActiveScene, setActiveScene, getSceneCode,
  saveSceneCode, getScenesView, createScene, deleteScene,
  resetSeedScene, listSeedScenes, touchScene,
} from './scenes.js';
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
    // Rebuild the sim panel — one fixture-unit per registered SimFixture
    // in the new code. Shows exactly what's in the active scene.
    rebuildSimPanel();
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

// ─── Editor + scenes ────────────────────────────────────────────────────────
// Scenes are named editor buffers persisted in localStorage. On first run
// we seed two: "default" (the hardcoded INITIAL_CODE) and "ultratonics 11"
// (a live-performance template). The active scene's code is loaded into
// the editor at boot; the buffer autosaves back to it on every change.

seedScenesIfEmpty(INITIAL_CODE);
const bootScene = getActiveScene();
const bootCode = getSceneCode(bootScene) ?? INITIAL_CODE;

// Debounced autosave — every edit writes to the current scene's slot.
// 500ms is plenty given localStorage writes are microseconds, and keeps
// us from thrashing on every keystroke of a long paste.
let _saveTimer: ReturnType<typeof setTimeout> | null = null;
function onEditorChange(code: string): void {
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    const name = getActiveScene();
    saveSceneCode(name, code);
    touchScene(name);
    _saveTimer = null;
  }, 500);
}

const editorView = createEditor(editorEl, runEval, runStop, onEditorChange, bootCode);

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
// Rebuilt from scratch after every successful eval. The core sim-fixture
// registry (populated by each fixture/rgbStrip/rgbwStrip call in the
// scene) tells us exactly what to draw — one fixture-unit element per
// entry. Hardcoded addresses are gone; whatever the scene creates, the
// panel reflects.

const simContainerEl = document.getElementById('fixture-lights') as HTMLElement;
const simEmptyEl     = document.getElementById('fixture-empty')  as HTMLElement;

interface RenderedSimFixture {
  core: SimFixture;
  unitEl: HTMLElement;
  /** The glowing bit (.fixture-globe for globes, .fixture-strip for strips). */
  mainEl: HTMLElement;
  /** Per-pixel elements when render.kind is a strip. Populated at build time. */
  pixelEls?: HTMLElement[];
}

let _renderedSim: RenderedSimFixture[] = [];

/** Wipe the sim panel and recreate one unit per registered sim fixture.
 *  Called after every successful evalCode(). */
function rebuildSimPanel(): void {
  simContainerEl.innerHTML = '';
  _renderedSim = [];

  const fixtures = getSimFixtures();
  simEmptyEl.classList.toggle('hidden', fixtures.length > 0);

  for (const fix of fixtures) {
    const unit = document.createElement('div');
    unit.className = 'fixture-unit';

    let mainEl: HTMLElement;
    let pixelEls: HTMLElement[] | undefined;

    if (fix.render.kind === 'strip-rgb' || fix.render.kind === 'strip-rgbw') {
      mainEl = document.createElement('div');
      mainEl.className = 'fixture-strip';
      pixelEls = [];
      for (let i = 0; i < fix.render.pixelCount; i++) {
        const p = document.createElement('div');
        p.className = 'fixture-strip-pixel';
        mainEl.appendChild(p);
        pixelEls.push(p);
      }
    } else {
      mainEl = document.createElement('div');
      mainEl.className = 'fixture-globe';
    }
    unit.appendChild(mainEl);

    const label = document.createElement('span');
    label.className = 'fixture-name';
    label.textContent = fix.label;
    unit.appendChild(label);

    simContainerEl.appendChild(unit);
    const rendered: RenderedSimFixture = { core: fix, unitEl: unit, mainEl, pixelEls };
    _renderedSim.push(rendered);
    bindTooltip(rendered);
  }
}

/** Single-dimmer globe — fixed white tint scaled by the dimmer value. */
function updateGlobeDim(el: HTMLElement, dimmer: number): void {
  const d = dimmer / 255;
  if (d < 0.02) {
    el.style.background = '#1a1714';
    el.style.boxShadow = 'none';
    return;
  }
  const c = Math.round(255 * d);
  const glow = Math.min(255, Math.round(c * 1.5));
  el.style.background = `rgb(${c},${c},${c})`;
  el.style.boxShadow = `0 0 ${Math.round(d * 24)}px ${Math.round(d * 12)}px rgba(${glow},${glow},${glow},${(d * 0.7).toFixed(2)})`;
}

/** RGBW globe — W mixes additively into R/G/B, optional master dim scales
 *  the whole output (used for moving-head-style fixtures with a dim channel). */
function updateGlobeRGBW(
  el: HTMLElement,
  r: number, g: number, b: number, w: number,
  dimScale = 1,
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
  const glowR = Math.min(255, Math.round(rr * 1.5));
  const glowG = Math.min(255, Math.round(gg * 1.5));
  const glowB = Math.min(255, Math.round(bb * 1.5));
  el.style.background = `rgb(${rr},${gg},${bb})`;
  el.style.boxShadow = `0 0 ${Math.round(brightness * 24)}px ${Math.round(brightness * 12)}px rgba(${glowR},${glowG},${glowB},${(brightness * 0.7).toFixed(2)})`;
}

/** One pixel in a strip — simple RGB render, caller pre-mixes W if needed. */
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

// ~30fps driver loop — reads universe buffers and paints each rendered
// sim fixture according to its render kind.
setInterval(() => {
  for (const r of _renderedSim) {
    const buf = getUniverseBuffer(r.core.universe);
    const base = r.core.startChannel - 1; // 0-indexed
    const render = r.core.render;

    if (render.kind === 'globe-rgbw') {
      const dimScale = render.dim !== undefined
        ? (buf[base + render.dim] ?? 0) / 255
        : 1;
      updateGlobeRGBW(
        r.mainEl,
        render.r !== undefined ? (buf[base + render.r] ?? 0) : 0,
        render.g !== undefined ? (buf[base + render.g] ?? 0) : 0,
        render.b !== undefined ? (buf[base + render.b] ?? 0) : 0,
        render.w !== undefined ? (buf[base + render.w] ?? 0) : 0,
        dimScale,
      );
    } else if (render.kind === 'globe-dim') {
      updateGlobeDim(r.mainEl, buf[base + render.dim] ?? 0);
    } else if (render.kind === 'strip-rgb') {
      const pixels = r.pixelEls ?? [];
      for (let i = 0; i < render.pixelCount; i++) {
        const pb = base + i * 3;
        updateStripPixel(pixels[i], buf[pb] ?? 0, buf[pb + 1] ?? 0, buf[pb + 2] ?? 0);
      }
    } else if (render.kind === 'strip-rgbw') {
      const pixels = r.pixelEls ?? [];
      for (let i = 0; i < render.pixelCount; i++) {
        const pb = base + i * 4;
        const rv = buf[pb] ?? 0;
        const gv = buf[pb + 1] ?? 0;
        const bv = buf[pb + 2] ?? 0;
        const wv = buf[pb + 3] ?? 0;
        // Mix W additively into RGB for the on-screen pixel — same approach
        // the old barPixel renderer used.
        updateStripPixel(
          pixels[i],
          Math.min(255, rv + wv),
          Math.min(255, gv + wv),
          Math.min(255, bv + wv),
        );
      }
    }
  }
}, 33);

// ─── Fixture sim tooltips ────────────────────────────────────────────────────
// Hover any unit in the sim panel → tooltip with name, type, universe,
// channel range, and live DMX values. Data comes straight from the
// SimFixture registry, so whatever the scene creates gets a matching
// tooltip automatically. Bound per-fixture at rebuild time so the
// elements line up after the panel is wiped + rebuilt.

const tooltipEl = document.getElementById('fixture-tooltip') as HTMLElement;
let _hoveredSim: RenderedSimFixture | null = null;

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Render the tooltip body for a sim fixture based on its render kind.
 *  Globes expose their named channels as percentages; strips surface
 *  the first pixel's raw values so you can see what's going in. */
function renderTooltip(r: RenderedSimFixture): void {
  const { label, type, universe, startChannel, channelCount, render } = r.core;
  const buf = getUniverseBuffer(universe);
  const base = startChannel - 1;

  const rows: string[] = [];
  let note = '';

  if (render.kind === 'globe-rgbw') {
    const push = (name: string, off?: number): void => {
      if (off === undefined) return;
      const v = buf[base + off] ?? 0;
      rows.push(
        `<div class="tt-row"><span class="tt-key">${name}</span><span class="tt-val">${Math.round((v / 255) * 100)}%</span></div>`,
      );
    };
    push('red',   render.r);
    push('green', render.g);
    push('blue',  render.b);
    push('white', render.w);
    push('dim',   render.dim);
  } else if (render.kind === 'globe-dim') {
    const v = buf[base + render.dim] ?? 0;
    rows.push(
      `<div class="tt-row"><span class="tt-key">dim</span><span class="tt-val">${Math.round((v / 255) * 100)}%</span></div>`,
    );
  } else {
    // Strip — first-pixel preview.
    const stride = render.kind === 'strip-rgbw' ? 4 : 3;
    const names = render.kind === 'strip-rgbw' ? ['r', 'g', 'b', 'w'] : ['r', 'g', 'b'];
    for (let j = 0; j < stride; j++) {
      const v = buf[base + j] ?? 0;
      rows.push(
        `<div class="tt-row"><span class="tt-key">px0.${names[j]}</span><span class="tt-val">${v}</span></div>`,
      );
    }
    note = `${render.pixelCount} pixels × ${render.kind === 'strip-rgbw' ? 'RGBW' : 'RGB'}`;
  }

  const chRange = channelCount > 1
    ? `ch ${startChannel}-${startChannel + channelCount - 1}`
    : `ch ${startChannel}`;

  tooltipEl.innerHTML =
    `<div class="tt-name">${escapeHtml(label)}</div>` +
    `<div class="tt-meta">${escapeHtml(type)} · uni ${universe} · ${chRange}</div>` +
    (note ? `<div class="tt-meta">${escapeHtml(note)}</div>` : '') +
    `<div class="tt-divider"></div>` +
    rows.join('');
}

function positionTooltip(rect: DOMRect): void {
  // Anchor above the fixture by default; if there's no room up top, drop
  // it below. Clamp horizontally to the viewport so long labels don't
  // push the card offscreen.
  const tt = tooltipEl.getBoundingClientRect();
  const margin = 10;
  const topPref = rect.top - tt.height - margin;
  const top = topPref < 8 ? rect.bottom + margin : topPref;
  let left = rect.left + rect.width / 2 - tt.width / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - tt.width - 8));
  tooltipEl.style.top = `${top}px`;
  tooltipEl.style.left = `${left}px`;
}

function bindTooltip(rendered: RenderedSimFixture): void {
  rendered.mainEl.addEventListener('mouseenter', () => {
    _hoveredSim = rendered;
    renderTooltip(rendered);
    tooltipEl.classList.add('open');
    requestAnimationFrame(() => positionTooltip(rendered.mainEl.getBoundingClientRect()));
  });
  rendered.mainEl.addEventListener('mouseleave', () => {
    if (_hoveredSim === rendered) {
      _hoveredSim = null;
      tooltipEl.classList.remove('open');
    }
  });
}

// Live-refresh values while hovered (10 Hz, cheap).
setInterval(() => {
  if (_hoveredSim) renderTooltip(_hoveredSim);
}, 100);

// ─── Scene picker ────────────────────────────────────────────────────────────
// Dropdown + new / delete buttons in the top bar. Each change writes the
// current buffer to the currently-active scene, then loads the target
// scene's source into the editor. The `default` scene can't be deleted.

const sceneSelectEl = document.getElementById('scene-select') as HTMLSelectElement;
const sceneNewEl    = document.getElementById('scene-new')    as HTMLButtonElement;
const sceneResetEl  = document.getElementById('scene-reset')  as HTMLButtonElement;
const sceneDelEl    = document.getElementById('scene-delete') as HTMLButtonElement;

function refreshSceneDropdown(): void {
  const active = getActiveScene();
  const view = getScenesView();
  // Render "default" / "recent" / "other" as separate <optgroup>s so the
  // dropdown reads like a file picker. Groups with no entries are
  // skipped so a fresh install doesn't show empty headers.
  const esc = (s: string): string =>
    s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const renderOpt = (n: string): string =>
    `<option value="${esc(n)}"${n === active ? ' selected' : ''}>${esc(n)}</option>`;
  const groups: string[] = [];
  if (view.default.length) {
    groups.push(`<optgroup label="default">${view.default.map(renderOpt).join('')}</optgroup>`);
  }
  if (view.recent.length) {
    groups.push(`<optgroup label="recent">${view.recent.map(renderOpt).join('')}</optgroup>`);
  }
  if (view.other.length) {
    groups.push(`<optgroup label="other">${view.other.map(renderOpt).join('')}</optgroup>`);
  }
  sceneSelectEl.innerHTML = groups.join('');
  // Delete button disabled for the default scene — it's the safety net.
  sceneDelEl.disabled = active === 'default';
  // Reset button only applies to scenes with a bundled seed template.
  sceneResetEl.disabled = !listSeedScenes().includes(active);
}

/** Replace the editor's document with the given code, preserving the
 *  scroll and cursor at position 0. Autosave is bypassed for this
 *  replacement by temporarily marking the change as system-driven. */
function loadCodeIntoEditor(code: string): void {
  // Pause autosave for this swap — otherwise the load itself would
  // trigger a save that overwrites the INCOMING scene with its own
  // contents (harmless, but churns localStorage).
  if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null; }
  const current = editorView.state.doc;
  editorView.dispatch({
    changes: { from: 0, to: current.length, insert: code },
    selection: { anchor: 0 },
    scrollIntoView: true,
  });
}

/**
 * Switch to `next`: save the outgoing buffer, load the new code into
 * the editor, stamp the access timestamp, and — the important bit for
 * live performance — re-evaluate immediately. Without the eval the
 * sim panel / lights stay on the previous scene's output until the
 * user presses Ctrl+Enter, which is surprising every time.
 */
function switchToScene(next: string, status: string): void {
  saveSceneCode(getActiveScene(), editorView.state.doc.toString());
  setActiveScene(next);
  touchScene(next);
  const code = getSceneCode(next) ?? '';
  loadCodeIntoEditor(code);
  refreshSceneDropdown();
  setStatus('', status);
  // Re-eval the freshly-loaded scene so lights + sim reflect it
  // immediately. If the scheduler was stopped, this re-starts it; if
  // the scene is empty or broken, runEval falls through to the error
  // status as usual.
  if (code.trim().length > 0) runEval(code);
}

sceneSelectEl.addEventListener('change', () => {
  const next = sceneSelectEl.value;
  if (next === getActiveScene()) return;
  switchToScene(next, `scene: ${next}`);
});

sceneNewEl.addEventListener('click', () => {
  const name = prompt('Name for the new scene:')?.trim();
  if (!name) return;
  if (getSceneCode(name) !== null) {
    alert(`A scene named "${name}" already exists.`);
    return;
  }
  // Flush current buffer to its scene first so we don't lose edits.
  saveSceneCode(getActiveScene(), editorView.state.doc.toString());
  createScene(name, `// ${name}\n\nartnet('2.0.0.100')\n`);
  switchToScene(name, `new scene: ${name}`);
});

sceneDelEl.addEventListener('click', () => {
  const current = getActiveScene();
  if (current === 'default') return;
  if (!confirm(`Delete scene "${current}"? This can't be undone.`)) return;
  deleteScene(current);
  switchToScene('default', `scene: default`);
});

sceneResetEl.addEventListener('click', () => {
  const current = getActiveScene();
  if (!listSeedScenes().includes(current)) return;
  if (!confirm(`Replace "${current}" with its built-in template? Any edits you made will be lost.`)) return;
  resetSeedScene(current);
  const code = getSceneCode(current) ?? '';
  loadCodeIntoEditor(code);
  touchScene(current);
  refreshSceneDropdown();
  setStatus('', `scene reset: ${current}`);
  if (code.trim().length > 0) runEval(code);
});

// Stamp the boot-active scene so it appears in the "recent" group
// from the first render.
touchScene(getActiveScene());

refreshSceneDropdown();

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
