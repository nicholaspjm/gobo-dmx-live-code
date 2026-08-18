/**
 * gobo main entry point
 *
 * Wires together:
 *   - @gobo/core (scheduler, DMX state, eval, WS client)
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
  getUniverseSnapshot,
  getActiveUniverses,
  SCREEN_UNIVERSE,
  getUniverseBuffer,
  evalCode,
  initStrudel,
  isStrudelReady,
  getStrudelError,
  connectBridge,
  onStatusChange,
  getOutputConfig,
  getDirectUrl,
  isDirectConnected,
  onDirectStatusChange,
  sendUniverseState,
  sendUsbDmx,
  isUsbConnected,
  getUsbDroppedFrames,
  connectUsbDmx,
  disconnectUsbDmx,
  isUsbDmxSupported,
  reconnectUsbDmx,
  onUsbStatusChange,
  restoreLibraryFixtures,
  getSimFixtures,
  getScreens,
  readScreen,
  type ScreenPanel,
  clearDefs,
  getQueryFailures,
  getQueryFailureGeneration,
  type QueryFailure,
  type SimFixture,
} from '@gobo/core';

import { createEditor } from './editor.js';
import {
  loadBuffer, saveBuffer, getBufferName, setBufferName,
  isUnsavedSinceFileSave, markSavedToFile,
  listLegacyScenes, legacyNoticeDismissed, dismissLegacyNotice,
} from './buffer.js';
import { downloadScene, openSceneFile, sceneFilename } from './scene-file.js';
import { encodeShareLink, decodeShareFromLocation, clearShareFromLocation } from './share.js';
import { getExample, type Example } from './examples.js';
import { initVisualizer, updateVisualizer } from './visualizer.js';
import { renderDocs } from './docs.js';
import { refreshViz } from './inline-viz.js';
import { mountLibraryPanel } from './library.js';
import { registerPublicFixtures } from './public-fixtures.js';
import { formatGoboCode } from './formatter.js';
import { getSettings, mountSettingsPanel, onSettingsChange } from './settings.js';
import { applyTheme } from './themes.js';
import {
  mountOutputsPanel,
  connectionSummary,
  needsConnectorUnlock,
  blockedOutputMessage,
  connectorFileName,
  hasSeenConnector,
  rememberConnector,
  RELEASES_URL,
} from './outputs.js';

// Apply the persisted theme before the editor mounts and before any
// CSS-variable-dependent code runs. Otherwise the page flashes the default
// ember palette while the editor constructs.
applyTheme(getSettings().theme);

// ─── DOM refs ────────────────────────────────────────────────────────────────

const editorEl = document.getElementById('editor')!;
const visualizerEl = document.getElementById('visualizer') as HTMLCanvasElement;
const visualizerLabelEl = document.getElementById('visualizer-label') as HTMLElement;
const evalStatusEl = document.getElementById('eval-status')!;
const bpmValEl = document.getElementById('bpm-val') as HTMLElement;
const bpmTapEl = document.getElementById('bpm-tap') as HTMLButtonElement;
const cycleFillEl = document.getElementById('cycle-fill')!;
const wsDotEl = document.getElementById('ws-dot')!;
const wsLabelEl = document.getElementById('ws-label')!;
const wsLockEl = document.getElementById('ws-lock') as HTMLElement;
const outputStatusEl = document.getElementById('output-status') as HTMLButtonElement;

// Scene bar: name plus save / open / share / examples.
const sceneNameEl = document.getElementById('scene-name') as HTMLElement;
const sceneDirtyEl = document.getElementById('scene-dirty') as HTMLElement;
const sceneSaveEl = document.getElementById('scene-save') as HTMLButtonElement;
const sceneOpenEl = document.getElementById('scene-open') as HTMLButtonElement;
const sceneShareEl = document.getElementById('scene-share') as HTMLButtonElement;



// "This code came from a link" banner.
const shareBannerEl = document.getElementById('share-banner') as HTMLElement;
const shareBannerTextEl = document.getElementById('share-banner-text') as HTMLElement;
const shareBannerDismissEl = document.getElementById('share-banner-dismiss') as HTMLButtonElement;

// One-time notice for scenes saved under the old multi-scene model.
const legacyNoticeEl = document.getElementById('legacy-notice') as HTMLElement;
const legacyListEl = document.getElementById('legacy-list') as HTMLElement;
const legacyCloseEl = document.getElementById('legacy-close') as HTMLButtonElement;
const legacyDismissEl = document.getElementById('legacy-dismiss') as HTMLButtonElement;
const legacyDownloadAllEl = document.getElementById('legacy-download-all') as HTMLButtonElement;

// "You need the connector" banner.
const connectorBannerEl = document.getElementById('connector-banner') as HTMLElement;
const connectorBannerTextEl = document.getElementById('connector-banner-text') as HTMLElement;
const connectorBannerLinkEl = document.getElementById('connector-banner-link') as HTMLAnchorElement;
const connectorBannerDismissEl = document.getElementById('connector-banner-dismiss') as HTMLButtonElement;
const connectorBannerMoreEl = document.getElementById('connector-banner-more') as HTMLButtonElement;

// ─── Eval ────────────────────────────────────────────────────────────────────

async function runEval(code: string): Promise<void> {
  // Format-on-run: if the setting is on, reformat the buffer before
  // evaluation. A failure (a syntax error mid-edit, say) falls through to
  // eval, which surfaces a clearer message than prettier's parse trace.
  // Same behaviour as Ctrl+Shift+F.
  let toRun = code;
  if (getSettings().formatOnRun) {
    const formatted = await formatBuffer({ silent: true });
    if (formatted !== null) toRun = formatted;
  }
  const result = evalCode(toRun);
  if (result.success) {
    // The scene may have picked a different output, so the connection light,
    // the lock badge and the outputs panel are resolved again before anything
    // is reported about this run.
    refreshOutputIndicator();
    const out = describeOutput();
    if (out && !out.delivered) {
      setStatus('error', `running, but ${out.text} was never reached. ${undeliveredHint()}`);
      if (!out.text.startsWith('direct')) showConnectorBanner(out.text);
    } else if (out) {
      setConnectorBannerOpen(false);
      setStatus('ok', `✓ running · ${out.text}`);
    } else {
      setStatus('ok', '✓ running');
    }
    if (!isRunning()) start();
    // The "this came from a link" warning is done once the user runs the code.
    setShareBannerOpen(false);
    // Rebuild inline editor visualizations to reflect any .viz() calls
    // in the new code. Widgets animate from the live universe buffer; this
    // call only (re)places them in the editor at the right lines. The
    // inlineViz setting opts out for big scenes or screen recordings.
    if (getSettings().inlineViz) refreshViz(editorView);
    else refreshViz(editorView, { disabled: true });
    // Rebuild the sim panel: one fixture-unit per SimFixture registered by
    // the new code.
    rebuildSimPanel();
    rebuildScreens();
    refreshVisualizerLabel();
    // Refresh the library panel: a new defineFixture call may have added or
    // replaced a custom fixture that the user can now save.
    _refreshLibraryAfterEval();
  } else {
    setStatus('error', result.error ?? 'unknown error');
  }
}

function runStop(): void {
  stop();
  // Stop-action setting decides whether to also zero the universe buffers.
  // 'blackout' wipes; 'freeze' leaves the last frame on outputs so the rig
  // holds its state until the next eval.
  //
  // The zeroing lives here rather than in clearDefs() so that an eval cannot
  // black the rig out as a side effect of clearing defs. clearDefs() stops
  // anything from being redriven, fill(0) darkens the buffers now (the
  // scheduler tick that would rewrite them is stopped), and sendUniverseState
  // pushes that frame to hardware.
  if (getSettings().stopAction === 'blackout') {
    clearDefs();
    for (const buf of getAllUniverses().values()) buf.fill(0);
    sendUniverseState(getAllUniverses());
    if (isUsbConnected()) sendUsbDmx(getUniverseBuffer(0));
    updateVisualizer(getUniverseSnapshot(visualizedUniverse()));
  }
  setStatus('', 'stopped · ctrl+enter to run');
}

// What is currently on the status bar. setStatus() is the only writer of
// evalStatusEl, so these mirror what is on screen. The tick loop compares
// against them to notice when an unrelated message has replaced a warning
// that is still true.
let _statusKind: '' | 'ok' | 'error' = '';
let _statusMsg = '';
let _statusAtMs = 0;

/**
 * Where DMX is going, for the run status line.
 *
 * artnet() and friends only queue a message for the bridge. With no bridge
 * running the scene still evaluates and the visualizer still animates, so
 * nothing on screen says the rig is receiving nothing. The status line names
 * the target on every run, and says when it was never reached.
 */
function describeOutput(): { text: string; delivered: boolean } | null {
  // Direct output bypasses the bridge entirely: the page holds the socket, so
  // its own connection state is what matters, not the bridge's.
  const direct = getDirectUrl();
  if (direct) return { text: `direct to ${direct}`, delivered: isDirectConnected() };

  const out = getOutputConfig();
  if (!out) return null;
  const c = out.config as {
    mode?: string;
    artnet?: { host?: string; port?: number };
    osc?: { host?: string; port?: number };
    sacn?: { universe?: number };
  };
  const mode = String(c.mode ?? 'unknown');
  let text = mode;
  if (mode === 'artnet') text = `art-net ${c.artnet?.host ?? '?'}:${c.artnet?.port ?? 6454}`;
  else if (mode === 'osc') text = `osc ${c.osc?.host ?? '?'}:${c.osc?.port ?? 9000}`;
  else if (mode === 'sacn') text = `sacn base universe ${c.sacn?.universe ?? 1}`;
  else if (mode === 'mock') text = 'mock (console only)';
  return { text, delivered: out.delivered };
}

function setStatus(kind: '' | 'ok' | 'error', msg: string): void {
  evalStatusEl.textContent = msg;
  evalStatusEl.className = kind;
  _statusKind = kind;
  _statusMsg = msg;
  _statusAtMs = performance.now();
}

/**
 * Format the current editor buffer via Prettier. Replaces the whole
 * document with the formatted result and restores the cursor to the line it
 * was on (approximate, but less jarring than snapping to the top).
 *
 * Returns the formatted string if changes were applied, or null if no change
 * was needed or the format failed. `silent: true` suppresses status-bar
 * updates so format-on-run doesn't overwrite the imminent eval status.
 */
async function formatBuffer(opts: { silent?: boolean } = {}): Promise<string | null> {
  const src = editorView.state.doc.toString();
  const lineBefore = editorView.state.doc.lineAt(editorView.state.selection.main.head).number;
  if (!opts.silent) setStatus('', 'formatting…');
  let formatted: string;
  try {
    formatted = await formatGoboCode(src);
  } catch (err) {
    if (!opts.silent) {
      const msg = (err as Error).message ?? 'format failed';
      setStatus('error', `format error: ${msg.split('\n')[0]}`);
    }
    return null;
  }
  if (formatted === src) {
    if (!opts.silent) setStatus('ok', 'already formatted');
    return null;
  }
  // Replace the document, cursor on the same line number when possible.
  const newLineCount = formatted.split('\n').length;
  const targetLine = Math.min(lineBefore, newLineCount);
  const linePos = formatted.split('\n').slice(0, targetLine - 1).join('\n').length + (targetLine > 1 ? 1 : 0);
  editorView.dispatch({
    changes: { from: 0, to: editorView.state.doc.length, insert: formatted },
    selection: { anchor: linePos },
  });
  if (!opts.silent) setStatus('ok', 'formatted');
  return formatted;
}

/** Manual Ctrl+Shift+F handler. Surfaces format errors and "already
 *  formatted" in the status bar. */
async function handleFormat(): Promise<void> {
  await formatBuffer();
}

document.addEventListener('keydown', (e) => {
  // Ctrl+S / Cmd+S saves the scene to a file. The working buffer autosaves on
  // its own, so the only save worth a keystroke is the durable one. Shift is
  // excluded: Ctrl+Shift+S used to mean "save as a new scene", and with no
  // other scenes to save as, it is left to the browser.
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 's' || e.key === 'S')) {
    e.preventDefault();
    handleSaveToFile();
    return;
  }
  // Ctrl+Shift+F formats the current buffer via prettier (lazy-loaded).
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'f' || e.key === 'F')) {
    e.preventDefault();
    handleFormat();
    return;
  }
  // Ctrl+Space is the global panic-stop alias. Inside the editor the
  // CodeMirror keymap catches it first (see editor.ts); this listener covers
  // focus on the sim panel, top bar and elsewhere.
  if ((e.ctrlKey || e.metaKey) && (e.key === ' ' || e.code === 'Space')) {
    e.preventDefault();
    runStop();
    return;
  }
});

// ─── Editor + working buffer ────────────────────────────────────────────────
// One document, autosaved to the browser so a refresh or a crash does not lose
// work. Durable copies are files (Save / Open) or share links.

const boot = loadBuffer();

/**
 * Whether the buffer holds edits that have never been written to a file.
 *
 * The "replace your work?" prompts consult this rather than localStorage. It
 * stays correct when autosave is off, where the persisted copy is stale and
 * would under-report unsaved work, and reading it costs nothing, so the guard
 * can run on every buffer-replacing action.
 *
 * Seeded from the persisted state, which is accurate at boot: the previous
 * session's last write is the buffer we just loaded.
 */
let _dirtySinceFileSave = isUnsavedSinceFileSave();

/** Paint the unsaved marker next to the scene name. */
function refreshDirtyDot(): void {
  sceneDirtyEl.classList.toggle('hidden', !_dirtySinceFileSave);
}

// Debounced autosave: every edit rewrites the working buffer. localStorage
// writes take microseconds, and 500ms avoids one per keystroke of a long paste.
let _saveTimer: ReturnType<typeof setTimeout> | null = null;
function onEditorChange(code: string): void {
  // Any edit differs from the last file, so the marker flips immediately
  // rather than waiting out the debounce.
  if (!_dirtySinceFileSave) {
    _dirtySinceFileSave = true;
    refreshDirtyDot();
  }
  if (_saveTimer) clearTimeout(_saveTimer);
  // Autosave can be disabled in settings; the browser copy is then left as it
  // stands and Save is the only way to secure work. The setting is read per
  // edit, so switching it back on takes effect from the next keystroke.
  if (!getSettings().autosave) return;
  _saveTimer = setTimeout(() => {
    _saveTimer = null;
    saveBuffer(code);
  }, 500);
}

const editorView = createEditor(editorEl, runEval, runStop, onEditorChange, boot.code);

/** Write the buffer now rather than at the end of the debounce. Used before
 *  anything that could end the session or that reads the persisted copy. */
function flushBuffer(): void {
  if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null; }
  saveBuffer(editorView.state.doc.toString());
}

// A tab closed or hidden inside the debounce window would lose the last
// half-second of typing. pagehide fires on close, navigation and mobile
// app-switching, where beforeunload is unreliable and blocks the
// back/forward cache.
window.addEventListener('pagehide', () => {
  if (getSettings().autosave) flushBuffer();
});

// ─── Visualizer ──────────────────────────────────────────────────────────────

/**
 * Which universe the 512-channel level strip shows.
 *
 * It was pinned to universe 0, so a scene addressing anything else drew an
 * empty strip and looked broken while the rig ran correctly. It now follows
 * the lowest universe the scene actually drives, falling back to 0 when
 * nothing is running so the strip keeps its shape.
 *
 * Screen lights are skipped: they render themselves as panels, and their
 * universe is an implementation detail nobody patched a fixture to.
 */
function visualizedUniverse(): number {
  const active = getActiveUniverses().filter((u) => u !== SCREEN_UNIVERSE);
  return active.length > 0 ? active[0] : 0;
}

/** Keep the strip's label honest about which universe is on screen. */
function refreshVisualizerLabel(): void {
  const u = visualizedUniverse();
  const others = getActiveUniverses().filter((x) => x !== SCREEN_UNIVERSE && x !== u);
  visualizerLabelEl.textContent = others.length > 0
    ? `universe ${u} (+${others.length} more)`
    : `universe ${u}`;
}

initVisualizer(visualizerEl);

// ─── Scheduler tick ──────────────────────────────────────────────────────────

// Cap DMX output rate so 120/144/240 Hz displays don't flood a USB DMX node or
// a WiFi link. Configurable via settings.sendRate: default 60 Hz, lower for
// wireless rigs, higher for local dev. Read fresh each tick so it can change
// live without re-evaluating.
let _lastSendMs = 0;

// Patterns run user code on every query, so a scene can start throwing long
// after evalCode() reported success. tick() contains that: the offending
// channel reads 0 and the frame still ships. Without a warning the bar would
// go on showing a green "✓ running" over a partly-dark rig.
//
// Polled rather than subscribed: one integer compare per frame, no callback
// re-entering the tick loop, and the snapshot is built only when the set of
// failing channels changes.
let _lastQueryFailureGen = getQueryFailureGeneration();

// The warning the bar should be carrying while channels are still failing, or
// null when nothing is failing.
//
// The core generation moves only when a new channel starts failing or the set
// is reset, so writing the warning once at that moment is not enough to keep
// it: any unrelated setStatus (a save, a rename) erases it, and with the
// failing set unchanged the generation never moves again. Holding the message
// here makes the warning a state rather than an event, so the tick loop can
// put it back once something else takes the bar.
let _queryFailureMsg: string | null = null;

// How long an unrelated message stays readable before the warning takes the bar
// back. Both bounds matter. Reclaiming on the next frame would flash "saved"
// for ~16ms and look like the save failed. Waiting much longer leaves a dark
// channel unreported for most of a song. 1.5s reads a confirmation and no more.
const QUERY_FAILURE_RECLAIM_MS = 1500;

function formatQueryFailures(failures: QueryFailure[]): string {
  const first = failures[0];
  const rest = failures.length - 1;
  const more = rest > 0 ? ` (+${rest} more channel${rest > 1 ? 's' : ''})` : '';
  // First line only: a pattern throwing a stack trace would blow out the top
  // bar. The console has the full error.
  const msg = first.message.split('\n')[0];
  return `pattern error · uni ${first.universe} ch ${first.channel} dark${more} · ${msg}`;
}

onTick((cyclePos, _delta) => {
  // 1. Resolve patterns → DMX channel values
  tick(cyclePos);

  // 2. Surface any channel whose pattern threw during that resolve, and keep
  //    it surfaced for as long as it is true. One integer compare per frame in
  //    the steady state, plus two string compares and a clock read on frames
  //    where a warning is live but overwritten. The DOM is written only when
  //    the failure set changes or the warning is reclaimed, never once per
  //    tick.
  const failureGen = getQueryFailureGeneration();
  if (failureGen !== _lastQueryFailureGen) {
    _lastQueryFailureGen = failureGen;
    const failures = getQueryFailures();
    // An empty set means the generation moved because the live scene was
    // replaced or dropped (re-eval, clearDefs). The failing defs are gone, so
    // the warning goes with them and runEval() keeps the status it just set.
    _queryFailureMsg = failures.length > 0 ? formatQueryFailures(failures) : null;
    if (_queryFailureMsg !== null) setStatus('error', _queryFailureMsg);
  } else if (
    _queryFailureMsg !== null
    && _statusMsg !== _queryFailureMsg
    && _statusKind !== 'error'
    && performance.now() - _statusAtMs >= QUERY_FAILURE_RECLAIM_MS
  ) {
    // Something unrelated took the bar while those channels are still dark.
    // Reclaim it once that message has had its moment, but never over another
    // error: stomping an eval or format error the user has not read yet would
    // hide one problem behind another. (The clock is read last, so it costs
    // nothing on frames where no warning is pending.)
    setStatus('error', _queryFailureMsg);
  }

  // 3. Push to the level strip, following whichever universe the scene drives.
  updateVisualizer(getUniverseSnapshot(visualizedUniverse()));

  // 4. Send to bridge (time-throttled to the configured send rate).
  const sendIntervalMs = 1000 / getSettings().sendRate;
  const now = performance.now();
  if (now - _lastSendMs >= sendIntervalMs) {
    _lastSendMs = now;
    sendUniverseState(getAllUniverses());
    // A USB DMX interface carries one universe, so it gets the primary one.
    // Anything on another universe is a network output's job. Sent on the same
    // throttle: the interface tops out near 40Hz and drops what it cannot take.
    if (isUsbConnected()) sendUsbDmx(getUniverseBuffer(0));
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
// The top-bar BPM span is contenteditable: click it, type a number, press
// Enter or blur to commit. Escape cancels and restores the live value.
// Clamped to the scheduler's 1..400 range; anything invalid reverts.

function commitBpmEdit(): void {
  const raw = (bpmValEl.textContent ?? '').trim();
  const v = parseInt(raw, 10);
  if (Number.isFinite(v) && v >= 1 && v <= 400) {
    setBPM(v);
  }
  // Snap the text to the authoritative value: the normalized int on a
  // successful commit, the previous value on invalid input.
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
// Click the `tap` button or press T (outside the editor and other inputs) to
// tap along with the beat. From the second tap on, a rolling buffer of
// timestamps is averaged and the resulting BPM pushed into the scheduler.
// A 2-second gap without a tap resets the buffer so a new tempo starts clean.

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
    // Average of consecutive intervals: more forgiving of one miss-tap than
    // comparing first to last.
    let sum = 0;
    for (let i = 1; i < _taps.length; i++) sum += _taps[i] - _taps[i - 1];
    const avgMs = sum / (_taps.length - 1);
    const bpm = Math.round(60000 / avgMs);
    if (bpm >= 1 && bpm <= 400) setBPM(bpm);
  }

  // 100ms flash on the button as feedback for the tap.
  bpmTapEl.classList.add('flash');
  setTimeout(() => bpmTapEl.classList.remove('flash'), 100);
}

bpmTapEl.addEventListener('click', tap);

// Global T hotkey, suppressed whenever focus is somewhere text is typed
// (editor, BPM field, search input) so it doesn't collide with text entry.
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

// Assigned when the outputs panel is mounted further down. Declared here so the
// connection listeners registered just below can reach it once it exists, and
// see null rather than a temporal-dead-zone error if anything fires earlier.
let _outputsPanel: ReturnType<typeof mountOutputsPanel> | null = null;

/**
 * Repaint the connection light from every link at once.
 *
 * The bridge, direct output and a USB interface are independent, and a scene
 * can be using two of them. Each listener used to write the label from its own
 * socket alone, so a rig being driven over USB read "disconnected". One
 * resolver, called by all three, is the only way that label stays true.
 *
 * Also drives the lock badge and the outputs panel, so a connection appearing
 * updates every place that reports on it.
 */
function refreshOutputIndicator(): void {
  const summary = connectionSummary();
  wsDotEl.className = summary.state === 'connected'
    ? 'ws-dot connected'
    : summary.state === 'disconnected' ? 'ws-dot disconnected' : 'ws-dot';
  wsLabelEl.textContent = summary.label;
  outputStatusEl.title = summary.title;
  wsLockEl.hidden = !needsConnectorUnlock();
  _outputsPanel?.refresh();
}

onStatusChange(refreshOutputIndicator);
onUsbStatusChange(refreshOutputIndicator);

/**
 * Direct output opens its socket asynchronously, so the status written the
 * instant an eval finishes always says "not reached". Correct it when the
 * socket actually settles, otherwise a working setup reads as broken.
 */
onDirectStatusChange(() => {
  refreshOutputIndicator();
  if (!isRunning()) return;
  const out = describeOutput();
  if (!out) return;
  if (out.delivered) setStatus('ok', `✓ running · ${out.text}`);
  else setStatus('error', `running, but ${out.text} was never reached. Is the receiver listening?`);
});

connectBridge();

// ─── Fixture simulation ──────────────────────────────────────────────────────
// Rebuilt from scratch after every successful eval. The core sim-fixture
// registry (populated by each fixture/rgbStrip/rgbwStrip call in the scene)
// says what to draw: one fixture-unit element per entry. No addresses are
// hardcoded here; the panel follows whatever the scene creates.

const simContainerEl = document.getElementById('fixture-lights') as HTMLElement;
const simEmptyEl     = document.getElementById('fixture-empty')  as HTMLElement;

interface RenderedSimFixture {
  core: SimFixture;
  unitEl: HTMLElement;
  /** The glowing bit (.fixture-globe for globes, .fixture-strip for strips). */
  mainEl: HTMLElement;
  /** Per-pixel elements when render.kind is a strip. Populated at build time. */
  pixelEls?: HTMLElement[];
  /** XY indicator + dot when the fixture has movement channels. */
  xyEl?: HTMLElement;
  xyDotEl?: HTMLElement;
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

    if (fix.render.kind === 'strip-rgb' || fix.render.kind === 'strip-rgbw' || fix.render.kind === 'strip-mono') {
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

    // Optional XY indicator: a small grid with a dot tracking the fixture's
    // movement channels. Built only when the SimFixture has movement hints;
    // otherwise the slot stays empty and the layout matches a static fixture.
    let xyEl: HTMLElement | undefined;
    let xyDotEl: HTMLElement | undefined;
    if (fix.movement) {
      xyEl = document.createElement('div');
      xyEl.className = 'fixture-xy';
      // Crosshair guides (horizontal and vertical). Decoration only, with no
      // class hooks, so the renderer never has to find them.
      const hRule = document.createElement('div');
      hRule.className = 'fixture-xy-rule fixture-xy-rule-h';
      const vRule = document.createElement('div');
      vRule.className = 'fixture-xy-rule fixture-xy-rule-v';
      xyDotEl = document.createElement('div');
      xyDotEl.className = 'fixture-xy-dot';
      xyEl.append(hRule, vRule, xyDotEl);
      unit.appendChild(xyEl);
    }

    const label = document.createElement('span');
    label.className = 'fixture-name';
    label.textContent = fix.label;
    unit.appendChild(label);

    simContainerEl.appendChild(unit);
    const rendered: RenderedSimFixture = { core: fix, unitEl: unit, mainEl, pixelEls, xyEl, xyDotEl };
    _renderedSim.push(rendered);
    bindTooltip(rendered);
  }
}

/** Single-dimmer globe: fixed white tint scaled by the dimmer value. */
function updateGlobeDim(el: HTMLElement, dimmer: number): void {
  const d = dimmer / 255;
  if (d < 0.02) {
    // Clear the inline background so the CSS rule's `var(--bg)` takes over and
    // follows the active theme instead of a hardcoded ember tone.
    el.style.background = '';
    el.style.boxShadow = 'none';
    return;
  }
  const c = Math.round(255 * d);
  const glow = Math.min(255, Math.round(c * 1.5));
  el.style.background = `rgb(${c},${c},${c})`;
  el.style.boxShadow = `0 0 ${Math.round(d * 24)}px ${Math.round(d * 12)}px rgba(${glow},${glow},${glow},${(d * 0.7).toFixed(2)})`;
}

/** RGBW globe: W mixes additively into R/G/B, and an optional master dim
 *  scales the whole output (moving-head-style fixtures with a dim channel). */
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
    el.style.background = '';
    el.style.boxShadow = 'none';
    return;
  }
  const glowR = Math.min(255, Math.round(rr * 1.5));
  const glowG = Math.min(255, Math.round(gg * 1.5));
  const glowB = Math.min(255, Math.round(bb * 1.5));
  el.style.background = `rgb(${rr},${gg},${bb})`;
  el.style.boxShadow = `0 0 ${Math.round(brightness * 24)}px ${Math.round(brightness * 12)}px rgba(${glowR},${glowG},${glowB},${(brightness * 0.7).toFixed(2)})`;
}

/** One pixel in a strip. Plain RGB render; the caller pre-mixes W if needed. */
function updateStripPixel(el: HTMLElement, r: number, g: number, b: number): void {
  const brightness = Math.max(r, g, b) / 255;
  if (brightness < 0.02) {
    el.style.background = '';
    el.style.boxShadow = 'none';
    return;
  }
  el.style.background = `rgb(${r},${g},${b})`;
  el.style.boxShadow = `0 0 ${Math.round(brightness * 6)}px rgba(${r},${g},${b},${(brightness * 0.7).toFixed(2)})`;
}

/**
 * Reposition the XY indicator dot from the fixture's movement channels.
 *
 *   pan        → x axis (0=left, 1=right)
 *   tilt       → y axis (0=top, 1=bottom)
 *   direction  → x axis (if pan absent). Bars carry direction but no
 *                pan/tilt, so the x axis shows their travel.
 *
 * Absent axes anchor to centre (0.5). The dot moves within the XY box via
 * `left` / `top` percentages, so it scales with whatever size CSS gives
 * the grid.
 */
function applyMovement(r: RenderedSimFixture): void {
  const m = r.core.movement;
  const dot = r.xyDotEl;
  if (!m || !dot) return;
  const buf = getUniverseBuffer(r.core.universe);
  const read = (ch: number | undefined, fallback = 0.5): number => {
    if (ch === undefined) return fallback;
    return (buf[ch - 1] ?? 0) / 255;
  };
  // Prefer pan for x; fall back to direction for fixtures that only
  // expose `direction` (like the demo bar).
  const x = m.pan !== undefined ? read(m.pan)
          : m.direction !== undefined ? read(m.direction)
          : 0.5;
  const y = m.tilt !== undefined ? read(m.tilt) : 0.5;
  dot.style.left = `${(x * 100).toFixed(1)}%`;
  dot.style.top  = `${(y * 100).toFixed(1)}%`;
}

// ─── Screen lights ───────────────────────────────────────────────────────────
//
// A screen() in the scene claims a panel here and is painted from its DMX
// values, so what you see is what a fixture patched to those channels would
// receive. Rebuilt when the scene changes, painted on the same 30fps loop as
// the sim.

const screenWrapEl = document.getElementById('screen-wrap') as HTMLElement;
const screenLightsEl = document.getElementById('screen-lights') as HTMLElement;

/** A declared panel and the cell elements painting it. */
interface RenderedScreen {
  panel: ScreenPanel;
  cells: HTMLElement[];
}
let _renderedScreens: RenderedScreen[] = [];

/** Rebuild the screen panels from whatever the current scene declared. */
function rebuildScreens(): void {
  _renderedScreens = [];
  screenLightsEl.innerHTML = '';
  const panels = getScreens();
  // Hidden rather than empty, so a scene with no screen() costs no layout.
  screenWrapEl.hidden = panels.length === 0;
  if (panels.length === 0) return;

  for (const panel of panels) {
    const el = document.createElement('div');
    el.className = 'screen-panel';
    el.style.gridTemplateColumns = `repeat(${panel.width}, 1fr)`;
    el.style.gridTemplateRows = `repeat(${panel.height}, 1fr)`;

    const cells: HTMLElement[] = [];
    for (let i = 0; i < panel.pixelCount; i++) {
      const cell = document.createElement('div');
      cell.className = 'screen-cell';
      el.appendChild(cell);
      cells.push(cell);
    }

    const label = document.createElement('span');
    label.className = 'screen-panel-label';
    label.textContent = panel.label;
    el.appendChild(label);

    screenLightsEl.appendChild(el);
    _renderedScreens.push({ panel, cells });
  }
}

/** Paint every screen panel from the current buffer. */
function paintScreens(): void {
  for (const r of _renderedScreens) {
    const colours = readScreen(r.panel);
    for (let i = 0; i < r.cells.length; i++) {
      const [red, green, blue] = colours[i] ?? [0, 0, 0];
      r.cells[i].style.background = `rgb(${red}, ${green}, ${blue})`;
    }
  }
}

// ~30fps driver loop. Reads universe buffers, paints each rendered sim fixture
// according to its render kind, then applies movement.
setInterval(() => {
  paintScreens();
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
        // Mix W additively into RGB for the on-screen pixel, as the old
        // barPixel renderer did.
        updateStripPixel(
          pixels[i],
          Math.min(255, rv + wv),
          Math.min(255, gv + wv),
          Math.min(255, bv + wv),
        );
      }
    } else if (render.kind === 'strip-mono') {
      // One channel per cell, so the level IS the colour. Drawn white because
      // that is what a segmented strobe strip actually emits.
      const pixels = r.pixelEls ?? [];
      for (let i = 0; i < render.pixelCount; i++) {
        const v = buf[base + i] ?? 0;
        updateStripPixel(pixels[i], v, v, v);
      }
    }

    applyMovement(r);
  }
}, 33);

// ─── Fixture sim tooltips ────────────────────────────────────────────────────
// Hover any unit in the sim panel → tooltip with name, type, universe,
// channel range and live DMX values. Data comes from the SimFixture registry,
// so whatever the scene creates gets a tooltip. Bound per fixture at rebuild
// time so the elements line up after the panel is wiped and rebuilt.

const tooltipEl = document.getElementById('fixture-tooltip') as HTMLElement;
let _hoveredSim: RenderedSimFixture | null = null;

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Render the tooltip body for a sim fixture based on its render kind.
 *  Globes expose their named channels as percentages; strips show the first
 *  pixel's raw values. */
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
    // Strip: first-pixel preview.
    const layout = render.kind === 'strip-rgbw'
      ? { stride: 4, names: ['r', 'g', 'b', 'w'], label: 'RGBW' }
      : render.kind === 'strip-mono'
        ? { stride: 1, names: ['level'], label: 'single channel' }
        : { stride: 3, names: ['r', 'g', 'b'], label: 'RGB' };
    for (let j = 0; j < layout.stride; j++) {
      const v = buf[base + j] ?? 0;
      rows.push(
        `<div class="tt-row"><span class="tt-key">px0.${layout.names[j]}</span><span class="tt-val">${v}</span></div>`,
      );
    }
    note = `${render.pixelCount} ${render.kind === 'strip-mono' ? 'cells' : 'pixels'} × ${layout.label}`;
  }

  const chRange = channelCount > 1
    ? `ch ${startChannel}-${startChannel + channelCount - 1}`
    : `ch ${startChannel}`;

  // What this fixture answers to, and the call that patched it. Knowing a
  // light is there is not the same as knowing what it responds to, and the
  // alternative is reading the docs for something already on screen.
  const { fixtureId, commands } = r.core;
  const patchLine = fixtureId !== undefined
    ? `<div class="tt-call">fixture(${startChannel}, '${escapeHtml(fixtureId)}'${universe !== 0 ? `, ${universe}` : ''})</div>`
    : '';
  const commandList = commands && commands.length > 0
    ? `<div class="tt-divider"></div>` +
      `<div class="tt-section">responds to</div>` +
      `<div class="tt-commands">${commands.map((c) => `<span class="tt-cmd">${escapeHtml(c)}</span>`).join('')}</div>`
    : '';

  tooltipEl.innerHTML =
    `<div class="tt-name">${escapeHtml(label)}</div>` +
    `<div class="tt-meta">${escapeHtml(type)} · uni ${universe} · ${chRange}</div>` +
    (note ? `<div class="tt-meta">${escapeHtml(note)}</div>` : '') +
    patchLine +
    `<div class="tt-divider"></div>` +
    rows.join('') +
    commandList;
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
    // Honour settings.simTooltips at hover time, not bind time, so toggling
    // the setting takes effect without rebuilding the panel.
    if (!getSettings().simTooltips) return;
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

// ─── Scene bar ───────────────────────────────────────────────────────────────
// Name (click to rename), save to file, open file, share link, examples.
// There is no scene list any more: the browser holds one working buffer and
// everything durable is a file or a link.

/**
 * Scene names are shown on one top-bar line and feed the filename on save, so
 * any name adopted from outside is flattened to a single line and capped. A
 * share link's name is attacker-controlled and otherwise unbounded: it could
 * be a megabyte of newlines.
 *
 * 80 is the same ceiling scene-file.ts puts on a name it reads back out of a
 * file, so a name that survives the bar survives a save/open round trip. (The
 * filename is trimmed further there, to the filesystem's rules.)
 */
const MAX_NAME_LEN = 80;

/** Fallback when a name normalises to nothing at all. */
const UNTITLED_NAME = 'untitled';

function normalizeSceneName(raw: string): string {
  // Control codes are replaced by code point rather than with a regex class:
  // they are invisible in this source, so a mangled escape would silently
  // stop sanitising and nobody would see it.
  let out = '';
  for (const ch of raw) {
    const code = ch.codePointAt(0) ?? 0;
    out += code < 0x20 || code === 0x7f ? ' ' : ch;
  }
  out = out.replace(/\s+/g, ' ').trim();
  if (out.length > MAX_NAME_LEN) out = out.slice(0, MAX_NAME_LEN).trim();
  return out || UNTITLED_NAME;
}

/** Shorten a name for a status line or a dialog. Separate from the cap above:
 *  a legal name can still be too long to read in a one-line status message. */
function short(name: string): string {
  return name.length > 32 ? `${name.slice(0, 31)}…` : name;
}

/**
 * Shorten a filename for a status line WITHOUT losing its extension.
 *
 * The extension is the part that answers "what did save just write?", so the
 * ellipsis eats the middle of the name rather than the tail of the string.
 * `short()` on a long name would leave a status line that never says `.js`.
 */
function shortFilename(filename: string): string {
  const dot = filename.lastIndexOf('.');
  // dot > 0, not >= 0: a leading dot is part of the name, not an extension.
  if (dot <= 0) return short(filename);
  const base = filename.slice(0, dot);
  return base.length > 31 ? `${base.slice(0, 30)}…${filename.slice(dot)}` : filename;
}

/** Write the stored name into the top bar. textContent, never innerHTML: the
 *  name may have come from a share link. */
function renderSceneName(): void {
  sceneNameEl.textContent = getBufferName();
}

// ─── Inline rename ───────────────────────────────────────────────────────────
// The name span is contenteditable: click, type, Enter or blur to commit,
// Escape to revert. Same gesture as the BPM readout, and no modal.

function commitNameEdit(): void {
  setBufferName(normalizeSceneName(sceneNameEl.textContent ?? ''));
  // Snap back to the stored value: normalisation may have rewritten what was
  // typed, and an emptied field reverts to a name rather than to nothing.
  renderSceneName();
}

sceneNameEl.addEventListener('focus', () => {
  // Select all so typing replaces the name, matching the BPM field.
  const range = document.createRange();
  range.selectNodeContents(sceneNameEl);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
});

sceneNameEl.addEventListener('blur', commitNameEdit);

sceneNameEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    // A name is one line; Enter commits instead of inserting a break.
    e.preventDefault();
    sceneNameEl.blur();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    renderSceneName();   // revert before the blur handler can commit
    sceneNameEl.blur();
  }
});

// ─── Replacing the buffer ────────────────────────────────────────────────────

/** Replace the editor's document, cursor back at the top. */
function loadCodeIntoEditor(code: string): void {
  // Drop any pending autosave for the outgoing text; it would write the old
  // contents over the new ones a few hundred milliseconds from now.
  if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null; }
  const current = editorView.state.doc;
  editorView.dispatch({
    changes: { from: 0, to: current.length, insert: code },
    selection: { anchor: 0 },
    scrollIntoView: true,
  });
}

/**
 * Ask before throwing away work that exists nowhere else.
 *
 * Returns true when it is safe to proceed. Called by every path that replaces
 * the whole buffer: a share link, an opened file, an example.
 */
function confirmReplace(headline: string): boolean {
  if (!_dirtySinceFileSave) return true;
  return confirm(
    `${headline}\n\n` +
    `"${short(getBufferName())}" has changes you have not saved to a file. ` +
    'Replacing it will lose them.\n\n' +
    'OK to replace · Cancel to keep it (then use Save first).',
  );
}

/**
 * Swap the whole buffer for something else: an example, an opened file, a
 * shared scene. Always lands stopped, so new code runs only when the operator
 * asks for it.
 *
 * `dirty` says whether the incoming text exists in a file of the user's.
 */
function replaceBuffer(name: string, code: string, opts: { dirty: boolean }): void {
  const clean = normalizeSceneName(name);
  loadCodeIntoEditor(code);
  setBufferName(clean);
  // Persist immediately, and regardless of the autosave setting: the name
  // has just been stored, so leaving the code alone would pair a new name
  // with the previous scene's source in the browser copy.
  saveBuffer(code, clean);
  renderSceneName();
  // After the dispatch above, whose change event set the flag true.
  _dirtySinceFileSave = opts.dirty;
  refreshDirtyDot();
  runStop();
}

// ─── Save to file ────────────────────────────────────────────────────────────

function handleSaveToFile(): void {
  const code = editorView.state.doc.toString();
  const name = getBufferName();
  // Persist before recording the save point: markSavedToFile() takes its
  // reference from the stored buffer, so a stale one would tell the next
  // session that this work is secured when it is not. This write happens even
  // with autosave off, because the user asked for a save.
  flushBuffer();
  downloadScene(name, code);
  // downloadScene hands the file to the browser and hears nothing back; there
  // is no event for "the user kept it", so the handover is the only save point
  // available.
  markSavedToFile();
  _dirtySinceFileSave = false;
  refreshDirtyDot();
  // Names the file rather than the scene: the sanitiser may have rewritten the
  // name to something the filesystem accepts ("50/50" lands as "50 50.js"),
  // and that is what appears in the downloads folder and on reopen.
  setStatus('ok', `saved ${shortFilename(sceneFilename(name))} to your downloads`);
}

sceneSaveEl.addEventListener('click', handleSaveToFile);

// ─── Open a file ─────────────────────────────────────────────────────────────

async function handleOpenFile(): Promise<void> {
  let opened: { name: string; code: string } | null;
  try {
    opened = await openSceneFile();
  } catch (err) {
    // A file was chosen but is not a scene we can read. The message from
    // scene-file.ts is written to be shown as-is.
    setStatus('error', (err as Error).message || 'could not open that file');
    return;
  }
  if (opened === null) return;   // picker dismissed; say nothing
  if (!confirmReplace(`Open "${short(opened.name)}"?`)) {
    setStatus('', 'open cancelled · nothing replaced');
    return;
  }
  // Not dirty: the editor now holds what is in that file.
  replaceBuffer(opened.name, opened.code, { dirty: false });
  // The buffer matches a file on disk, so record it as the reference point;
  // otherwise a reload would report unsaved work that is already in the file
  // it was read from.
  markSavedToFile();
  setStatus('', `opened "${short(opened.name)}" · ctrl+enter to run`);
}

sceneOpenEl.addEventListener('click', () => { void handleOpenFile(); });

// ─── Share link ──────────────────────────────────────────────────────────────

/**
 * Length past which a link starts being risky to paste around. Browsers handle
 * far longer URLs, but chat clients, mail gateways and QR codes truncate
 * somewhere around here (see the note in share.ts). A truncated link fails at
 * the other end, not this one, so the status line says the length out loud.
 */
const LONG_LINK_CHARS = 2000;

/** Copy text to the clipboard. False when the browser refuses: no permission,
 *  or a page that is not a secure context. */
async function copyText(text: string): Promise<boolean> {
  try {
    if (!navigator.clipboard?.writeText) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

async function handleShare(): Promise<void> {
  const code = editorView.state.doc.toString();
  const name = getBufferName();
  let url: string;
  try {
    url = await encodeShareLink(code, name);
  } catch (err) {
    setStatus('error', `couldn't build a share link: ${(err as Error).message}`);
    return;
  }

  if (await copyText(url)) {
    setStatus('ok', url.length > LONG_LINK_CHARS
      ? `share link copied · ${url.length} characters · some apps truncate links this long, use save for a big set`
      : `share link copied · ${url.length} characters`);
    return;
  }
  // When the clipboard is unavailable, show the link somewhere the user can
  // select it by hand.
  window.prompt('Copy this share link:', url);
  setStatus('', 'clipboard unavailable · the link was shown so you can copy it');
}

sceneShareEl.addEventListener('click', () => { void handleShare(); });

// ─── Bundled examples ────────────────────────────────────────────────────────
// The demos that ship with gobo. They are source, not saved state: loading one
// fills the working buffer and from that moment it is the user's buffer.
//
// They are listed under the docs panel's examples tab rather than a menu of
// their own, so the scenes sit next to the reference that explains them. The
// panel announces a click; deciding what that does to the buffer is here.

/** Load a bundled scene into the working buffer, warning about unsaved work. */
function loadExample(ex: Example): void {
  if (!confirmReplace(`Load the "${ex.label}" example?`)) {
    setStatus('', 'example not loaded · nothing replaced');
    return;
  }
  // Not dirty: untouched example text is ours, not the user's work, so the
  // next replace has nothing to warn about. buffer.ts seeds a brand-new
  // browser from EXAMPLES[0] on the same reasoning.
  replaceBuffer(ex.label, ex.code, { dirty: false });
  setStatus('', `example: ${ex.label} · ctrl+enter to run`);
}



// ─── Shared-scene banner ─────────────────────────────────────────────────────
// Scene code is evaluated with full page privileges (SECURITY.md,
// packages/core/src/eval.ts), so a scene that arrived in a link can read what
// is saved on this origin and repoint DMX output. It is never auto-run, and
// this banner stays up until the user runs it or dismisses it.

function setShareBannerOpen(open: boolean): void {
  shareBannerEl.classList.toggle('open', open);
  shareBannerEl.setAttribute('aria-hidden', open ? 'false' : 'true');
}

function showSharedSceneBanner(name: string): void {
  // Assembled from text nodes rather than a template string: `name` came out
  // of someone else's link and must reach the DOM as text, never as markup.
  shareBannerTextEl.textContent = '';
  const nameEl = document.createElement('span');
  nameEl.className = 'share-banner-name';
  nameEl.textContent = short(normalizeSceneName(name));
  shareBannerTextEl.append(
    document.createTextNode('This scene ('),
    nameEl,
    document.createTextNode(
      ') came from a shared link. Running it gives someone else\'s code full access to '
      + 'this page and to your DMX output. Nothing is running yet: read it, then press '
      + 'ctrl+enter if you trust it.',
    ),
  );
  setShareBannerOpen(true);
}

shareBannerDismissEl.addEventListener('click', () => setShareBannerOpen(false));

/**
 * Load a scene out of the URL hash, if there is one. Runs once at boot.
 *
 * Never auto-runs the code, and never replaces unsaved work without asking.
 */
async function handleSharedSceneOnBoot(): Promise<void> {
  const shared = await decodeShareFromLocation();
  if (shared === null) return;
  // Strip the payload before deciding anything: whichever way this goes, a
  // refresh must not ask the same question again, and the scene is in hand.
  clearShareFromLocation();

  if (!confirmReplace(`Open the shared scene "${short(normalizeSceneName(shared.name))}"?`)) {
    setStatus('', 'shared scene not loaded · your work is untouched');
    return;
  }
  // Dirty: a scene from a link exists in no file of the user's, so whatever
  // would replace it next still has to ask.
  replaceBuffer(shared.name, shared.code, { dirty: true });
  showSharedSceneBanner(shared.name);
  setStatus('', 'shared scene loaded · read it, then ctrl+enter to run');
}

// ─── Legacy scenes notice ────────────────────────────────────────────────────
// Scenes saved under the old multi-scene model. The old keys are only read
// (see listLegacyScenes), never written or cleared. The panel offers to take
// copies out as files; dismissing it changes nothing but whether the panel
// appears again.

function closeLegacyNotice(): void {
  legacyNoticeEl.classList.remove('open');
  legacyNoticeEl.setAttribute('aria-hidden', 'true');
  dismissLegacyNotice();
}

function mountLegacyNotice(): void {
  const scenes = listLegacyScenes();
  if (scenes.length === 0 || legacyNoticeDismissed()) return;

  for (const scene of scenes) {
    const row = document.createElement('div');
    row.className = 'legacy-row';

    const name = document.createElement('span');
    name.className = 'legacy-row-name';
    name.textContent = scene.name;   // user data, possibly odd: text only
    name.title = scene.name;

    const size = document.createElement('span');
    size.className = 'legacy-row-size';
    size.textContent = `${Math.max(1, Math.round(scene.code.length / 1024))} kB`;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'scene-action';
    btn.textContent = 'download';
    btn.addEventListener('click', () => {
      downloadScene(scene.name, scene.code);
      setStatus('ok', `downloaded ${shortFilename(sceneFilename(scene.name))}`);
    });

    row.append(name, size, btn);
    legacyListEl.appendChild(row);
  }

  legacyDownloadAllEl.addEventListener('click', () => {
    // Spaced out rather than fired in a burst: browsers treat several
    // downloads from one gesture as "multiple downloads" and may drop all but
    // the first, so each file gets its own turn.
    scenes.forEach((scene, i) => {
      setTimeout(() => downloadScene(scene.name, scene.code), i * 400);
    });
    setStatus('ok', `downloading ${scenes.length} old scene${scenes.length === 1 ? '' : 's'} as .js files · your browser may ask to allow multiple files`);
  });

  legacyCloseEl.addEventListener('click', closeLegacyNotice);
  legacyDismissEl.addEventListener('click', closeLegacyNotice);

  legacyNoticeEl.classList.add('open');
  legacyNoticeEl.setAttribute('aria-hidden', 'false');
}

renderSceneName();
refreshDirtyDot();

// ─── Sliding panels (docs / library / settings) ──────────────────────────────
// Three independent panels, one visible at a time: opening "library" over an
// already-open "docs" would stack them. Each panel registers its close fn
// here; opening one calls closeOtherPanels(self) to shut the others first.

type PanelCloser = (open: boolean) => void;
const _panelClosers = new Map<string, PanelCloser>();
function closeOtherPanels(except: string): void {
  for (const [key, fn] of _panelClosers) {
    if (key !== except) fn(false);
  }
}

// Docs panel
const docsToggleEl = document.getElementById('docs-toggle') as HTMLButtonElement;
const docsCloseEl  = document.getElementById('docs-close')  as HTMLButtonElement;
const docsPanelEl  = document.getElementById('docs-panel')  as HTMLElement;
const docsBodyEl   = document.getElementById('docs-body')   as HTMLElement;

renderDocs(docsBodyEl);

// The docs panel raises this when one of its example rows is clicked. It
// carries the id rather than the scene itself, so an unknown id fails visibly
// here instead of quietly loading the wrong thing.
docsBodyEl.addEventListener('gobo:load-example', (ev) => {
  const id = (ev as CustomEvent<string>).detail;
  const ex = getExample(id);
  if (!ex) {
    setStatus('error', `no bundled example called "${id}"`);
    return;
  }
  loadExample(ex);
});

function setDocsOpen(open: boolean): void {
  docsPanelEl.classList.toggle('open', open);
  docsPanelEl.setAttribute('aria-hidden', open ? 'false' : 'true');
  docsToggleEl.classList.toggle('active', open);
  if (open) closeOtherPanels('docs');
}
_panelClosers.set('docs', setDocsOpen);

docsToggleEl.addEventListener('click', () => {
  setDocsOpen(!docsPanelEl.classList.contains('open'));
});
docsCloseEl.addEventListener('click', () => setDocsOpen(false));

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && docsPanelEl.classList.contains('open')) {
    setDocsOpen(false);
  }
});

// Fixture library panel. Closes docs and settings when it opens.
const libraryPanel = mountLibraryPanel({
  panelEl:  document.getElementById('library-panel')  as HTMLElement,
  bodyEl:   document.getElementById('library-body')   as HTMLElement,
  toggleEl: document.getElementById('library-toggle') as HTMLButtonElement,
  closeEl:  document.getElementById('library-close')  as HTMLButtonElement,
  onOpen:   () => closeOtherPanels('library'),
});
_panelClosers.set('library', libraryPanel.setOpen);

// Settings panel. Closes docs and library when it opens.
const settingsPanel = mountSettingsPanel({
  panelEl:  document.getElementById('settings-panel')  as HTMLElement,
  bodyEl:   document.getElementById('settings-body')   as HTMLElement,
  toggleEl: document.getElementById('settings-toggle') as HTMLButtonElement,
  closeEl:  document.getElementById('settings-close')  as HTMLButtonElement,
  onOpen:   () => closeOtherPanels('settings'),
});
_panelClosers.set('settings', settingsPanel.setOpen);

// Outputs panel. Opened by the connection light rather than by a button of its
// own: the light already answers half this question, and the top bar has no
// room for a fourteenth word. Mounted last, and the reference is kept in
// _outputsPanel so the connection listeners can repaint it.
_outputsPanel = mountOutputsPanel({
  panelEl:  document.getElementById('outputs-panel') as HTMLElement,
  bodyEl:   document.getElementById('outputs-body')  as HTMLElement,
  toggleEl: outputStatusEl,
  closeEl:  document.getElementById('outputs-close') as HTMLButtonElement,
  // Choosing a serial port needs a user gesture, and a click on the panel row
  // is one, so the row can share the top-bar button's handler.
  onUsbRequest: () => { void handleUsbButton(); },
  onOpen:   () => closeOtherPanels('outputs'),
});
_panelClosers.set('outputs', _outputsPanel.setOpen);

// Re-apply the theme whenever the setting changes. Other settings are read at
// the point of use and need no subscription; themes need one because they
// write CSS variables onto :root to take effect.
onSettingsChange((s) => applyTheme(s.theme));

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

// Resolve the connection light once at boot. The markup ships reading
// "disconnected", which is wrong before a scene has chosen any output at all.
refreshOutputIndicator();

// Defensive: ensure the scheduler is in the stopped state on boot. Vite's
// HMR can keep the worker / animation loop alive across reloads in dev,
// which makes the page look like it's "already playing" before the user
// hits Ctrl+Enter. Calling stop() unconditionally is a no-op on a cold
// load and a real reset under HMR.
runStop();

// One-time offer to export the old multi-scene saves as files. Reads the
// legacy keys; never writes or clears them.
mountLegacyNotice();

// A scene may have arrived in the URL hash. Handled after the editor and the
// stop above exist, so the incoming code lands in a halted app. It is loaded
// for the user to read, never started for them.
void handleSharedSceneOnBoot();

initStrudel().then(() => {
  // No pattern engine means no waveforms, and evalCode() refuses every run
  // rather than resolving scenes to something else. Say so in the status bar
  // and leave it there.
  if (!isStrudelReady()) {
    setStatus('error', `pattern engine failed to load: ${getStrudelError() ?? 'unknown error'}`);
    return;
  }
  console.log('[gobo] ready');
  // Don't stomp what the shared-scene flow put here. These two resolve in
  // whichever order the network decides, and its message, that the code on
  // screen came from a link, says more than the generic hint.
  if (!shareBannerEl.classList.contains('open')) {
    setStatus('', 'ctrl+enter to run  ·  ctrl+space / ctrl+. to stop');
  }
});

// ─── USB DMX ─────────────────────────────────────────────────────────────────
//
// The one output that needs nothing installed: WebSerial talks to an Enttec
// DMX USB Pro style interface directly. Choosing the device needs a user
// gesture, so a scene cannot do it and something has to be clicked; that
// something is the usb row in the outputs panel, alongside the other five
// outputs, rather than a button of its own in the top bar.

onUsbStatusChange(() => {
  // The panel draws the connected state from isUsbConnected(), so a change
  // only has to make it repaint.
  _outputsPanel?.refresh();
});

// Reopen an interface this origin has already been granted, without asking
// again. Browsers remember the grant but not the open port, so a reload used
// to leave a plugged-in box disconnected until someone clicked through the
// chooser a second time. Nothing is prompted here: getPorts() only ever
// returns devices the user has already picked, so this is silent when there
// are none, and silent when it fails.
void reconnectUsbDmx().then((reconnected) => {
  if (reconnected) setStatus('ok', 'usb interface reconnected');
});

/** Connect or disconnect the interface. Called by the outputs panel's usb
 *  row, which is why it is a named function rather than an inline handler. */
async function handleUsbButton(): Promise<void> {
  if (isUsbConnected()) {
    await disconnectUsbDmx();
    setStatus('', 'usb interface disconnected');
    return;
  }
  if (!isUsbDmxSupported()) {
    setStatus('error', 'this browser has no WebSerial. Chrome and Edge support it, Firefox and Safari do not');
    return;
  }
  try {
    await connectUsbDmx();
    setStatus('ok', 'usb interface connected · add usb() to your scene and press ctrl+enter');
  } catch (err) {
    // Cancelling the chooser is the common case and is not an error.
    const msg = err instanceof Error ? err.message : String(err);
    if (/No port selected|cancell?ed/i.test(msg)) setStatus('', 'no interface chosen');
    else setStatus('error', `could not open the interface: ${msg}`);
  }
}


// ─── Connector prompt ────────────────────────────────────────────────────────
//
// A browser cannot open a UDP socket, so Art-Net and sACN need a native helper.
// Someone running from a checkout has one command for that. Someone who just
// opened the hosted site has no repository to run anything from, and telling
// them to run npm is worse than useless, so they get the download instead.

// RELEASES_URL, connectorFileName(), hasSeenConnector() and rememberConnector()
// come from outputs.ts, which the panel reads from too, so the banner and the
// panel cannot drift apart on what to offer or whom to offer it to.

/**
 * How long to let the socket finish connecting before calling it a failure.
 *
 * Pressing ctrl+enter as the page loads beats the WebSocket to it, so declaring
 * "nothing is listening" straight away would flash a download prompt at someone
 * whose connector is running perfectly well.
 */
const CONNECT_GRACE_MS = 2500;
let _connectorPromptTimer: ReturnType<typeof setTimeout> | null = null;

/** True when this page came from a local dev server or a local connector. */
function servedLocally(): boolean {
  // location.hostname wraps an IPv6 literal in brackets, so ::1 arrives as
  // "[::1]" and a bare equality check misses it.
  const h = window.location.hostname.replace(/^\[|\]$/g, '');
  return h === 'localhost' || h === '127.0.0.1' || h === '::1';
}

function undeliveredHint(): string {
  const out = describeOutput();
  if (out?.text.startsWith('direct')) return 'Is the receiver listening?';
  if (out?.text.startsWith('usb')) return 'Open the outputs panel from the connection light and pick the interface.';
  // A hosted visitor has no checkout to run anything from, so point them at the
  // outputs panel by name: it says what does work here as well as what to get.
  return servedLocally()
    ? 'Start it with: npm start'
    : 'Click the connection light for the outputs panel, which says what works here.';
}

function setConnectorBannerOpen(open: boolean): void {
  connectorBannerEl.classList.toggle('open', open);
  connectorBannerEl.setAttribute('aria-hidden', open ? 'false' : 'true');
}

function showConnectorBanner(target: string): void {
  // Wait out the grace period, and say nothing if the bridge turns up meanwhile.
  if (_connectorPromptTimer) clearTimeout(_connectorPromptTimer);
  _connectorPromptTimer = setTimeout(() => {
    _connectorPromptTimer = null;
    const out = describeOutput();
    if (!out || out.delivered) return;
    renderConnectorBanner(target);
  }, CONNECT_GRACE_MS);
}

function renderConnectorBanner(target: string): void {
  connectorBannerLinkEl.href = RELEASES_URL;

  if (hasSeenConnector()) {
    // They have one. The download is not the missing piece; running it is.
    connectorBannerTextEl.textContent =
      `Nothing is listening for DMX, so ${target} is going nowhere. The connector has run on this `
      + 'machine before, so start it again. It normally starts itself when you log in.';
    connectorBannerLinkEl.hidden = true;
    setConnectorBannerOpen(true);
    return;
  }
  connectorBannerLinkEl.hidden = false;

  if (servedLocally()) {
    connectorBannerTextEl.textContent =
      `Nothing is listening for DMX, so ${target} is going nowhere. Run npm start, `
      + 'which serves this page and sends the output from one process. Or download the connector.';
  } else {
    // Same sentence the outputs panel would give for this output, so the
    // banner and the panel cannot end up telling two stories.
    connectorBannerTextEl.textContent =
      `${blockedOutputMessage(target)} The file to download is ${connectorFileName()}.`;
  }
  setConnectorBannerOpen(true);
}

connectorBannerDismissEl.addEventListener('click', () => setConnectorBannerOpen(false));

// The banner says one output is blocked. This opens the panel that says which
// outputs are not, which is the more useful answer for anyone unwilling to
// install anything.
connectorBannerMoreEl.addEventListener('click', () => _outputsPanel?.setOpen(true));

// Once something is listening, the banner has served its purpose.
onStatusChange((connected) => {
  if (!connected) return;
  // Seeing one is proof they have it, so never offer the download again.
  rememberConnector();
  if (_connectorPromptTimer) {
    clearTimeout(_connectorPromptTimer);
    _connectorPromptTimer = null;
  }
  setConnectorBannerOpen(false);
});
onUsbStatusChange((connected) => { if (connected) setConnectorBannerOpen(false); });
