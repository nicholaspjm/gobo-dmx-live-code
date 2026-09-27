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
  resetPhase,
  onTick,
  getBPM,
  setBPM,
  getCycleFraction,
  tick,
  getAllUniverses,
  getUniverseSnapshot,
  setLocationCollection,
  getCues,
  getSelectedCue,
  isCueDrivenByPattern,
  selectCue,
  restoreCue,
  selectCueIndex,
  onCueChange,
  getActiveUniverses,
  SCREEN_UNIVERSE,
  getUniverseBuffer,
  evalCode,
  initStrudel,
  isStrudelReady,
  getStrudelError,
  connectBridge,
  retryBridgeNow,
  getConnectorInfo,
  APP_VERSION,
  onStatusChange,
  getOutputConfig,
  getConnectorNetworks,
  getDirectUrl,
  isDirectConnected,
  onDirectStatusChange,
  sendUniverseState,
  sendUsbDmx,
  getUsbUniverse,
  isUsbConnected,
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
import { spliceEdits, paragraphAt, type Hunk } from './splice.js';
import { showPending } from './pending-marks.js';
import { showErrorLine } from './error-mark.js';
import type { EditorView } from '@codemirror/view';
import type { ChangeSet } from '@codemirror/state';
import {
  loadBuffer, saveBuffer,
  isUnsavedSinceFileSave,
  listLegacyScenes, legacyNoticeDismissed, dismissLegacyNotice,
} from './buffer.js';
// Only the legacy-scene notice writes files: it offers scenes saved under the
// pre-0.3 model as downloads, the only way to recover them.
import { downloadScene, sceneFilename } from './scene-file.js';
import { mountPanel, type PanelHost } from './panel.js';
import {
  BLOCKED_BY_BROWSER,
  browserBlocksConnector,
  getLocalAccess,
  onLocalAccessChange,
  servedLocally,
  watchLocalAccess,
} from './browser-access.js';
import { browserName, reportUrl, routeName, systemName, type Environment } from './report.js';
import { encodeShareLink, decodeShareFromLocation, clearShareFromLocation } from './share.js';
import { getExample, type Example } from './examples.js';
import { initVisualizer, updateVisualizer } from './visualizer.js';
import { OPEN_PANEL_EVENT, renderDocs } from './docs.js';
import { refreshViz } from './inline-viz.js';
import { mountLibraryPanel } from './library.js';
import { registerPublicFixtures } from './public-fixtures.js';
import { formatGoboCode } from './formatter.js';
import { getSettings, mountSettingsPanel, onSettingsChange } from './settings.js';
import type { EditorPrefs } from './editor.js';
import { captureConsole, mountConsolePanel } from './console-log.js';
import { tagLocations } from './mini-locations.js';
import { applyTheme } from './themes.js';
import { locateSyntaxError } from './syntax-line.js';
import { lightNamesByAddress } from './declared-lights.js';
import { mountAppUpdate } from './app-update.js';
import { patchInsertLine } from './patch-builder.js';
import {
  mountOutputsPanel,
  connectionSummary,
  needsConnectorUnlock,
  blockedOutputMessage,
  connectorFileName,
  connectorDownloadUrl,
  hasSeenConnector,
  rememberConnector,
  RELEASES_URL,
  currentOutputId,
  isDesktopBuild,
} from './outputs.js';
import { artnetTargetProblem, isLoopbackHost } from './artnet-target.js';

// First, so a failure during start-up is already in the log panel when
// someone opens it.
captureConsole();

// The engine only notes which source ranges are live when something is going
// to draw them, and the editor is that something.
setLocationCollection(true);

// Apply the persisted theme before the editor mounts and before any
// CSS-variable-dependent code runs, so the page does not flash the default
// ember palette while the editor constructs.
applyTheme(getSettings().theme, { black: getSettings().blackBackground });

/**
 * Editor type size, as a variable the stylesheet reads.
 *
 * Set on the document rather than the editor, so the gutter, the inline
 * widgets and the tooltips scale with the code.
 */
function applyFontSize(px: number): void {
  document.documentElement.style.setProperty('--editor-font-size', `${px}px`);
}
applyFontSize(getSettings().fontSize);

/**
 * Turn every transition and animation in the app off, or back on.
 *
 * One class on <html> rather than a rule per component, so components added
 * later are covered too.
 */
function applyAnimations(on: boolean): void {
  document.documentElement.classList.toggle('no-animations', !on);
}
applyAnimations(getSettings().animations);

// ─── DOM refs ────────────────────────────────────────────────────────────────

const editorEl = document.getElementById('editor')!;
const editorWrapEl = document.querySelector('.editor-wrap') as HTMLElement;
const visualizerEl = document.getElementById('visualizer') as HTMLCanvasElement;
const visualizerLabelEl = document.getElementById('visualizer-label') as HTMLElement;
const evalStatusEl = document.getElementById('eval-status')!;
const bpmValEl = document.getElementById('bpm-val') as HTMLElement;
const bpmTapEl = document.getElementById('bpm-tap') as HTMLButtonElement;
const bpmHalveEl = document.getElementById('bpm-halve') as HTMLButtonElement;
const bpmDoubleEl = document.getElementById('bpm-double') as HTMLButtonElement;
const bpmResyncEl = document.getElementById('bpm-resync') as HTMLButtonElement;
const cycleFillEl = document.getElementById('cycle-fill')!;
const wsDotEl = document.getElementById('ws-dot')!;
const wsLabelEl = document.getElementById('ws-label')!;
const wsLockEl = document.getElementById('ws-lock') as HTMLElement;
const outputStatusEl = document.getElementById('output-status') as HTMLButtonElement;


// Scene bar: the share button. Copying the code as text is inside the share
// dialog.
//
// There is no save or open. A scene is text, kept in whatever editor you
// already use or passed on as a link. There is no unsaved-changes dot either:
// with no files, it would be lit on every buffer ever typed into.
const sceneShareEl = document.getElementById('scene-share') as HTMLButtonElement;




// One-time notice for scenes saved under the pre-0.3 multi-scene model.
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

async function runEval(code: string, opts: { format?: boolean } = {}): Promise<boolean> {
  // Format-on-run: if the setting is on, reformat the buffer before
  // evaluation. A failure (a syntax error mid-edit, say) falls through to
  // eval, which surfaces a clearer message than prettier's parse trace.
  // Same behaviour as Ctrl+Shift+F.
  let toRun = code;
  if (getSettings().formatOnRun && opts.format !== false) {
    const formatted = await formatBuffer({ silent: true });
    if (formatted !== null) toRun = formatted;
  }
  // Give the mini-notation strings their document offsets, so the editor can
  // outline whichever token is driving light. It skips anything it is unsure
  // of and leaves that source untouched. See mini-locations.ts.
  const tagged = tagLocations(toRun);

  let result = evalCode(tagged.code);
  // If the tagged copy fails but the original runs, the tagging is at fault:
  // drop the outlines and keep the scene. The retry runs once, on the
  // untouched source, and only when tagging rewrote something, so a scene with
  // its own error still reports that error and is not run twice.
  if (!result.success && tagged.tagged > 0) {
    const plain = evalCode(toRun);
    if (plain.success) {
      console.warn(
        '[gobo] the inline decorations were dropped for this scene: tagging its mini() and '
        + `viz calls produced code that would not run (${result.error ?? 'unknown error'}). `
        + 'The scene itself ran.',
      );
      result = plain;
    }
  }
  if (result.success) {
    showErrorLine(editorView, null);
    // A scene that ran is kept in the address bar. See
    // rememberSceneInAddressBar.
    rememberSceneInAddressBar(toRun);
    // What is on the rig now. Ctrl+Shift+Enter splices onto this.
    _lastGoodSource = toRun;
    // Live again, so the next stop is a first stop and honours the setting.
    _stoppedAlready = false;
    // Everything in the buffer is now on the rig. A splice run puts back what
    // it deliberately left behind, straight after this returns.
    _editsSinceGoodRun = [];
    refreshPendingMarks();
    // The scene may have picked a different output, so the connection light,
    // the lock badge and the outputs panel are resolved again before anything
    // is reported about this run.
    refreshOutputIndicator();
    const out = describeOutput();
    // A run can succeed and still have something to report: a dimmer it
    // raised, a channel two looks both set. The bar shows a short mark for it,
    // short enough to keep the output name on the line, and the log has the
    // full text.
    // A DMX line carries one universe, so a USB box gets only one. A scene
    // that names a second universe would lose that half of its output without
    // a word, so undeliveredUniverseNote() reports it in the same mark.
    const note = [result.warning ?? null, undeliveredUniverseNote()]
      .filter((n) => n !== null).join(' ') || null;
    const mark = note === null ? '' : ' · ⚠ see log';
    if (out && !out.delivered) {
      setStatus('error', `running, but ${out.short} was never reached. ${undeliveredHint()}`);
      if (out.short !== 'td()') showConnectorBanner(out.short);
    } else if (out) {
      setConnectorBannerOpen(false);
      setStatus('ok', `✓ running · ${out.text}${mark}`, note ?? undefined);
    } else {
      setStatus('ok', `✓ running${mark}`, note ?? undefined);
    }
    if (!isRunning()) start();
    flashRun();
    // Rebuild inline editor visualizations to reflect any .viz() calls
    // in the new code. Widgets animate from the live universe buffer; this
    // call only (re)places them in the editor at the right lines. The
    // inlineViz setting opts out for big scenes or screen recordings.
    if (getSettings().inlineViz) refreshViz(editorView);
    else refreshViz(editorView, { disabled: true });
    // Rebuild the sim panel: one fixture-unit per SimFixture registered by
    // the new code.
    rebuildSimPanel();
    rebuildCueBar();
    rebuildScreens();
    refreshVisualizerLabel();
    // Refresh the library panel: a new defineFixture call may have added or
    // replaced a custom fixture that the user can now save.
    _refreshLibraryAfterEval();
    return true;
  } else {
    // A scene that does not parse never ran, so it has no line from the
    // stack. The editor's parser finds one.
    const message = locateSyntaxError(result.error ?? 'unknown error', toRun);
    // The bar is one line and clips, and the useful part of an error (the line
    // number, the suggested rename, the channel name) is usually at the end.
    // The console copy lands in the log panel in full, with a timestamp.
    console.error(`[gobo] ${message}`);
    setStatus('error', message);
    showErrorLine(editorView, message);
    return false;
  }
}

/**
 * A brief flash across the editor when a run lands.
 *
 * The status bar reports the run too, but it sits at the bottom of the window
 * while the eyes are on the code. Strudel flashes for the same reason.
 *
 * Restarted on every run, so two runs a beat apart read as two flashes. Reflow
 * is forced between the two class writes so the browser cannot coalesce them
 * into a no-op.
 */
let _flashTimer: ReturnType<typeof setTimeout> | null = null;
function flashRun(): void {
  if (!getSettings().flashOnRun) return;
  if (_flashTimer) clearTimeout(_flashTimer);
  editorWrapEl.classList.remove('run-flash');
  void editorWrapEl.offsetWidth;
  editorWrapEl.classList.add('run-flash');
  _flashTimer = setTimeout(() => {
    editorWrapEl.classList.remove('run-flash');
    _flashTimer = null;
  }, 180);
}

/**
 * Whether the rig was already stopped when the last stop arrived.
 *
 * The second press of the panic key always blacks out, whatever the stop
 * action is set to. "freeze last frame" lets you stop the code at a gig
 * without blacking the stage, but then no other key clears the rig: the
 * scheduler is stopped, so nothing rewrites the buffers, and hush() needs a
 * scene to run to reach it.
 */
let _stoppedAlready = false;

function runStop(): void {
  // Under 'freeze', pressing stop again is the blackout. Read before stop().
  const panic = _stoppedAlready || getSettings().stopAction === 'blackout';
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
  if (panic) {
    clearDefs();
    for (const buf of getAllUniverses().values()) buf.fill(0);
    sendUniverseState(getAllUniverses());
    if (isUsbConnected()) sendUsbDmx(getUniverseBuffer(usbUniverse()));
    updateVisualizer(getUniverseSnapshot(visualizedUniverse()));
  }
  _stoppedAlready = true;
  // The blackout hint shows only while the rig is holding a frame.

  setStatus('', panic ? 'stopped · ctrl+enter to run' : 'stopped, rig holding · ctrl+. again to black out');
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
function describeOutput(): { text: string; short: string; delivered: boolean } | null {
  // Direct output bypasses the bridge entirely: the page holds the socket, so
  // its own connection state is what matters, not the bridge's.
  const direct = getDirectUrl();
  if (direct) return { text: `td() → ${direct}`, short: 'td()', delivered: isDirectConnected() };

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
  // artnet() with no address sends to this machine, which is right for a
  // visualiser or TouchDesigner here and silent for a node on the network. The
  // bare address reads as a destination either way, so the line says which.
  if (mode === 'artnet') {
    const host = c.artnet?.host ?? '?';
    const port = c.artnet?.port ?? 6454;
    if (isLoopbackHost(host)) {
      text = `art-net to this computer only (${host}:${port}), artnet('node ip') for the rig`;
    } else if (artnetTargetProblem(host, getConnectorNetworks()) !== null) {
      text = `art-net ${host}:${port}, which this computer cannot reach: see outputs`;
    } else {
      text = `art-net ${host}:${port}`;
    }
  }
  else if (mode === 'osc') text = `osc ${c.osc?.host ?? '?'}:${c.osc?.port ?? 9000}`;
  else if (mode === 'sacn') text = `sacn base universe ${c.sacn?.universe ?? 1}`;
  else if (mode === 'mock') text = 'mock (console only)';
  // `short` is the call that chose the output, for use inside a longer
  // sentence ("artnet() is going nowhere"), where the full text reads badly.
  return { text, short: `${mode}()`, delivered: out.delivered };
}

function setStatus(kind: '' | 'ok' | 'error', msg: string, full?: string): void {
  // Errors are marked with × in the text as well as the colour. The two status
  // colours, --sage #7a8c6e and --error #c45a5a, sit at 1.17:1 against each
  // other for normal vision and 1.05:1 simulated for deuteranopia, and people
  // read this bar at a glance in a dark room. Ok messages carry a ✓.
  //
  // _statusMsg keeps the unmarked text, because the tick loop compares it
  // against the pattern-failure warning to know whether that warning is still
  // the thing on the bar.
  evalStatusEl.textContent = kind === 'error' && !msg.startsWith('×') ? `× ${msg}` : msg;
  evalStatusEl.className = kind;
  // `full` is everything this run had to say, when that does not fit. An
  // error always has it: the bar is one line and clips, and the useful part of
  // an error (the line number, the suggested rename, the channel named) is
  // usually at the end. A successful run has it when it produced a warning.
  //
  // Appending it to the message would be clipped too, so it goes in the
  // element's title, where hovering shows it, and the bar becomes a way into
  // the log, which keeps it in full with a timestamp.
  const detail = full ?? (kind === 'error' ? msg : '');
  evalStatusEl.title = detail === '' ? '' : `${detail}\n\n(click to open the log)`;
  evalStatusEl.classList.toggle('clickable', detail !== '');
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
  // Alt+1..9 picks a cue, so a performer can switch looks without looking at
  // the keyboard. Alt rather than a bare digit because a bare digit is a
  // number you are typing into a scene, and alt+digit is not bound to anything
  // in the editor. preventDefault matters on macOS, where alt+1 would
  // otherwise insert a character.
  //
  // On a US Mac, option+1 types ¡, so `key` is never "1" there. Those nine
  // characters are read as their digits. Other layouts are left alone: on a
  // German, Nordic or French Mac, option+5 to 9 type [ ] { } |, which a scene
  // needs, and taking the physical key would stop anyone typing a brace.
  const US_MAC_OPTION_DIGITS = '¡™£¢∞§¶•ª';
  const macDigit = US_MAC_OPTION_DIGITS.indexOf(e.key);
  const cueDigit = /^[1-9]$/.test(e.key) ? e.key : macDigit >= 0 ? String(macDigit + 1) : null;
  if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && cueDigit !== null) {
    e.preventDefault();
    selectCueIndex(Number(cueDigit));
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
// work. Durable copies are share links, or the text copied out of the share
// dialog.

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


// Debounced autosave: every edit rewrites the working buffer. localStorage
// writes take microseconds, and 500ms avoids one per keystroke of a long paste.
let _saveTimer: ReturnType<typeof setTimeout> | null = null;
/**
 * The source of the last run that succeeded, and the edits made since.
 *
 * Together they are what Ctrl+Shift+Enter splices: the document on the rig,
 * plus only the edits inside the region you pointed at.
 * See splice.ts for why the unit is the edit rather than the syntactic block.
 *
 * Null until something has run. There is nothing to splice onto before that,
 * so the gesture falls back to a full run and says so.
 */
let _lastGoodSource: string | null = null;
let _editsSinceGoodRun: Hunk[] = [];

/**
 * Show which lines are not in the source that is running.
 *
 * Called after every edit and every run, so the marks track the difference
 * between the buffer and the rig rather than a snapshot of it.
 */
function refreshPendingMarks(): void {
  showPending(editorView, _editsSinceGoodRun.map((h) => [h.fromB, h.toB] as [number, number]));
}

/** Fold one CodeMirror change set into the edits pending since the last run. */
function recordEdits(changes: ChangeSet): void {
  if (_lastGoodSource === null) return;          // nothing to be pending against
  const next: Hunk[] = [];
  // Rebase what was already pending through this new change, then add it.
  // Composing the ChangeSets and re-reading them would be tidier, but the
  // pending list is also rebased by a splice, which has no ChangeSet to
  // compose with, so both paths keep the same plain representation.
  for (const held of _editsSinceGoodRun) {
    next.push({
      ...held,
      fromB: changes.mapPos(held.fromB, -1),
      toB: changes.mapPos(held.toB, 1),
    });
  }
  changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
    next.push({ fromA, toA, fromB, toB, insert: inserted.toString() });
  });
  // Ascending A order is what spliceEdits expects; new edits land wherever
  // the typing happened, not necessarily after the ones already held.
  next.sort((a, b) => a.fromA - b.fromA);
  _editsSinceGoodRun = next;
}

function onEditorChange(code: string, changes: ChangeSet): void {
  recordEdits(changes);
  refreshPendingMarks();
  // Any edit differs from the last file, so the flag flips immediately
  // rather than waiting out the debounce.
  if (!_dirtySinceFileSave) {
    _dirtySinceFileSave = true;
  }
  if (_saveTimer) clearTimeout(_saveTimer);
  // Autosave can be disabled in settings; the browser copy is then left as it
  // stands. The setting is read per edit, so switching it back on takes effect
  // from the next keystroke.
  if (!getSettings().autosave) return;
  _saveTimer = setTimeout(() => {
    _saveTimer = null;
    saveBuffer(code);
  }, 500);
}

/**
 * Run only the edits inside the selection, on top of what is already running.
 *
 * Ctrl+Enter commits the whole buffer: nudge a level in the lit look and the
 * half-written look you were drafting for the next song goes live with it, as
 * long as it parses. This commits only the region you point at. Keeping other
 * looks alive is a separate matter: a whole-document re-run already does
 * that. See splice.ts.
 *
 * What is compiled is always a complete document, so nothing downstream sees a
 * fragment. The engine is untouched by this feature.
 */
async function runBlock(view: EditorView): Promise<void> {
  if (_lastGoodSource === null) {
    setStatus('', 'nothing is running yet · ctrl+enter runs the whole file first');
    return;
  }
  const { state } = view;
  const sel = state.selection.main;
  // A selection if there is one, otherwise the run of non-blank lines around
  // the cursor, which matches how a performance file is laid out: one blank
  // line between looks.
  const region = sel.empty
    ? paragraphAt(state.doc.toString().split('\n'), state.doc.lineAt(sel.head).number - 1)
    : { from: sel.from, to: sel.to };

  const spliced = spliceEdits(_lastGoodSource, _editsSinceGoodRun, region.from, region.to);
  if (spliced === null) {
    setStatus('', 'nothing edited there · ctrl+enter runs the whole file');
    return;
  }

  // Formatting is skipped: it rewrites the whole document, which would mark
  // every line as edited.
  const ok = await runEval(spliced.source, { format: false });
  if (!ok) return;                                  // the rig is untouched; keep the edits pending
  _editsSinceGoodRun = spliced.remaining;
  refreshPendingMarks();
  const left = spliced.remaining.length;
  setStatus('ok', left === 0
    ? `✓ ran that block · ${describeOutput()?.text ?? 'no output chosen'}`
    : `✓ ran that block · ${left} edit${left === 1 ? '' : 's'} elsewhere not running`);
}

/**
 * The editor preferences, pulled out of the settings blob.
 *
 * Read from the same object every time rather than cached, because a toggle
 * has to reach a running editor: the compartments in editor.ts exist so that
 * changing one of these does not rebuild the state and lose the undo history,
 * the folds and the live decorations with it.
 */
function editorPrefs(): EditorPrefs {
  const s = getSettings();
  return {
    lineNumbers: s.lineNumbers,
    activeLine: s.activeLine,
    bracketMatching: s.bracketMatching,
    closeBrackets: s.closeBrackets,
    lineWrapping: s.lineWrapping,
    autocomplete: s.autocomplete,
    hoverHelp: s.hoverHelp,
    eventHighlight: s.eventHighlight,
    multiCursor: s.multiCursor,
    blockEval: s.blockEval,
  };
}

const goboEditor = createEditor(
  editorEl, runEval, runStop, editorPrefs(), onEditorChange, boot.code,
  (v) => { void runBlock(v); },
);
const editorView = goboEditor.view;

// Picking a look runs the file again with that one selected.
//
// Which function runs is decided at eval time, so selection cannot be a live
// value the way a fader is. Evaluating is atomic, so a re-run is a clean swap:
// the rig holds the previous look up to the commit, and a scene that throws
// leaves it where it was.
//
// It runs the source already on the rig, not the buffer. This fires from a
// chip, a key and a MIDI button, and none of those means the operator has
// decided their half-typed edits are ready. Running the buffer would let a cue
// press put an unfinished look on stage and reformat the document on the way.
// Falls back to the buffer only before anything has run.
onCueChange((_name, previous) => {
  void (async (): Promise<void> => {
    const source = _lastGoodSource ?? editorView.state.doc.toString();
    const ok = await runEval(source, { format: false });
    // A look that threw is not on the rig (the staged scene was discarded and
    // the previous one is still live), so the selection goes back to match.
    // Otherwise the bar shows what is lit, the selection holds something that
    // never ran, and the next run jumps somewhere nobody asked to go.
    if (!ok) {
      restoreCue(previous);
      rebuildCueBar();
    }
  })();
});


// ── Run and stop keys, bound at the document ─────────────────────────────────
//
// Run and stop work wherever focus is. The status bar promises them
// unconditionally and the app opens with focus on the body, so keys bound only
// in the editor's keymap would do nothing until the user clicked the code.
//
// Stop matters most. Opening the docs or the library mid-show moves focus out
// of the editor, and the panic stop still has to reach the rig. editor.ts notes
// that performers asked for a stop that does not depend on the easy-to-miss
// period key; one that depends on where the caret is would be worse.
//
// Bound in the capture phase, and this listener calls stopPropagation, so
// anything it handles never reaches the editor's own keymap. That is why the
// focus checks below matter.
document.addEventListener('keydown', (e) => {
  // Literal Ctrl, matching the editor's 'Ctrl-' bindings rather than 'Mod-':
  // on a Mac these are ctrl, not cmd, and cmd+enter must stay free. Alt as
  // well, for Strudel's Alt+Enter and Alt+., but never both: Windows sends
  // ctrl+alt for AltGr, which types characters.
  const alt = e.altKey && !e.ctrlKey;
  if (e.metaKey || (!e.ctrlKey && !alt) || (e.ctrlKey && e.altKey)) return;

  if (e.key === 'Enter') {
    // Inside the editor, its keymap owns both Enter chords, including the
    // swap the "block on ctrl+enter" setting makes. Handling them here
    // as well would leave the editor's bindings unreachable, and the setting
    // would change nothing.
    // Only the editor's own text: an inline slider or swatch sits inside the
    // editor but CodeMirror ignores keys from widgets, so "drag a fader, then
    // run" has to be handled here or it does nothing.
    const active = document.activeElement;
    if (editorEl.contains(active) && !active?.closest('.gobo-slider, .gobo-picker')) return;
    e.preventDefault();
    e.stopPropagation();
    // Outside the editor there is no caret to watch, but the editor's own
    // selection is still where it was left, so the block gesture still has a
    // region to take. The setting swaps which chord means which, the same way
    // it does inside.
    if (getSettings().blockEval !== e.shiftKey) void runBlock(editorView);
    else void runEval(editorView.state.doc.toString());
    return;
  }

  // Space is read off `code` as well, because a keyboard layout can put a
  // different character on that key. Alt+Space is not a stop: it is the
  // window menu on Windows and a non-breaking space on a Mac.
  // Option+. types ≥ on a US Mac, so that is read as a period. The physical
  // key is not used: on other layouts it types something a scene may need.

  const period = e.key === '.' || (alt && e.key === '≥');
  const space = e.key === ' ' || e.code === 'Space';
  if (!period && (alt || !space)) return;
  e.preventDefault();
  e.stopPropagation();
  runStop();
}, true);

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
  // Unconditionally, including with autosave off. Autosave off means "do not
  // write on every keystroke". Closing the page is the last chance to keep the
  // work, and one write here costs nothing.
  flushBuffer();
  blackoutOnTheWayOut();
});

/**
 * Darken the outputs the connector cannot darken for us.
 *
 * When the page goes away while driving artnet, sacn or osc, the connector
 * notices its last client leave and blacks out by itself (bridge/index.ts
 * calls blackoutAll('app disconnected')). usb() and td() never go through it:
 * one writes the serial port straight from the page and the other holds its own
 * socket to TouchDesigner. A DMX interface does not stop when its host does:
 * an Enttec Pro keeps re-transmitting the last frame it was handed. Without
 * this, closing the tab mid-show would leave the rig lit on whatever was up,
 * with nothing running that could change it.
 *
 * Done whatever the stop-action setting says. 'freeze' is a choice about what
 * `stop` means, made by someone still at the keyboard; this is the case where
 * nobody is. The connector does the same on the other three outputs.
 *
 * Best effort: pagehide gives no guarantee an async serial write lands. The
 * frame it sends is the same one .off() sends.
 */
function blackoutOnTheWayOut(): void {
  if (!isUsbConnected() && !isDirectConnected()) return;
  for (const buf of getAllUniverses().values()) buf.fill(0);
  sendUniverseState(getAllUniverses());
  if (isUsbConnected()) sendUsbDmx(getUniverseBuffer(usbUniverse()));
}

// ─── Visualizer ──────────────────────────────────────────────────────────────

/**
 * Which universe the 512-channel level strip shows.
 *
 * The lowest universe the scene drives, falling back to 0 when nothing is
 * running so the strip keeps its shape. A strip fixed on universe 0 would draw
 * empty for a scene addressing anything else, and look broken while the rig
 * ran correctly.
 *
 * Screen lights are skipped: they render themselves as panels, and their
 * universe is an implementation detail nobody patched a fixture to.
 */
function visualizedUniverse(): number {
  const active = getActiveUniverses().filter((u) => u !== SCREEN_UNIVERSE);
  return active.length > 0 ? active[0] : 0;
}

/**
 * Which universe the USB interface is fed.
 *
 * A DMX line carries one universe, so one of them has to be chosen. It follows
 * whatever the level strip is showing, so the picture and the light agree, and
 * usb(n) overrides it for a rig that needs a fixed one.
 *
 * Every call defaults to universe 0, so a scene reaches two universes only by
 * naming one, and a run that does says which are not being sent.
 */
function usbUniverse(): number {
  return getUsbUniverse() ?? visualizedUniverse();
}

/**
 * What a single-universe output cannot carry, or null.
 *
 * Only USB today: the connector paths send every universe, so nothing is lost
 * on them. The note names the universes by number and gives the cause,
 * because someone chasing a light that will not come up is not thinking in
 * universes.
 */
function undeliveredUniverseNote(): string | null {
  if (!isUsbConnected()) return null;
  const sent = usbUniverse();
  const dropped = getActiveUniverses().filter((u) => u !== SCREEN_UNIVERSE && u !== sent);
  if (dropped.length === 0) return null;
  return (
    `the usb interface carries one universe and is sending ${sent}, so universe `
    + `${dropped.join(' and ')} ${dropped.length === 1 ? 'is' : 'are'} not reaching it. `
    + 'Every call defaults to universe 0, so something in the scene is naming '
    + 'another one. Give them all one universe, or set the interface to the one '
    + 'you want with usb(n).'
  );
}

/** Update the strip's label to name the universe on screen. */
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
// a WiFi link. Configurable via settings.sendRate: default 40 Hz, just under
// what DMX itself carries, lower for wireless rigs. Read fresh each tick so it
// can change live without re-evaluating.
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
// it: any unrelated setStatus (a format, say) erases it, and with the
// failing set unchanged the generation never moves again. Holding the message
// here makes the warning a state rather than an event, so the tick loop can
// put it back once something else takes the bar.
let _queryFailureMsg: string | null = null;

// How long an unrelated message stays readable before the warning takes the bar
// back. Reclaiming on the next frame would flash a confirmation for ~16ms and
// make it look like the action failed. Waiting much longer leaves a dark
// channel unreported for most of a song. 1.5s is long enough to read a
// confirmation.
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
    if (isUsbConnected()) sendUsbDmx(getUniverseBuffer(usbUniverse()));
  }
});

// ─── Transport ───────────────────────────────────────────────────────────────
// Run and stop as buttons, next to the tempo, for a hand on the mouse and for
// anyone who has not read the status bar's key hints yet.
//
// Run is not disabled while a scene runs. Re-running is the core gesture of
// live coding, so every press does what ctrl+enter does. Stop carries state:
// it is lit while there is something to stop, so the pair also shows whether
// anything is going out.

const transportRunEl = document.getElementById('transport-run') as HTMLButtonElement;
const transportStopEl = document.getElementById('transport-stop') as HTMLButtonElement;

transportRunEl.addEventListener('click', () => {
  // Through the editor's own document, not a cached string: the button has to
  // run what is on screen, including edits made since the last run.
  runEval(editorView.state.doc.toString());
  // Focus goes back to the code. Clicking a button takes it, and the next
  // thing anyone does after pressing run is type.
  editorView.focus();
});

transportStopEl.addEventListener('click', () => {
  runStop();
  editorView.focus();
});

function refreshTransport(): void {
  const live = isRunning();
  transportStopEl.classList.toggle('live', live);
  transportStopEl.setAttribute('aria-disabled', String(!live));
}

// ─── Status bar updates ──────────────────────────────────────────────────────

// Update cycle bar continuously; BPM display updates too EXCEPT while the
// user is actively editing it (see bpm-edit section below).
let _bpmEditing = false;

setInterval(() => {
  if (!_bpmEditing) bpmValEl.textContent = String(getBPM());
  cycleFillEl.style.width = `${(getCycleFraction() * 100).toFixed(1)}%`;
  // Polled rather than pushed. A scene can stop itself, and the scheduler can
  // stop for reasons that never pass through runStop(), so reading the engine
  // on the same tick as the tempo keeps the buttons correct, where a callback
  // on each of our own entry points would miss some stops.
  refreshTransport();
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

// ─── Halve and double ────────────────────────────────────────────────────────
// Two buttons beside the readout, for the moment a scene turns out to be at
// twice or half the tempo of the room. Two characters each, to keep the top
// bar compact.

/**
 * Scale the tempo and put the result back through setBPM, the same call the
 * inline editor commits through, so there is one clamp rather than two.
 *
 * The ends hold rather than wrap, because setBPM clamps to 1..400: 400 doubled
 * stays 400, and 1 halved stays 1 whichever way the rounding falls. The readout
 * is repainted from getBPM() rather than from the number computed here, so a
 * clamped value shows the tempo in force.
 */
function scaleBpm(factor: number): void {
  setBPM(Math.round(getBPM() * factor));
  // Painted now rather than on the next 100ms status tick: a button that takes
  // a tenth of a second to show anything reads as a button that missed the
  // click.
  bpmValEl.textContent = String(getBPM());
}

bpmHalveEl.addEventListener('click', () => scaleBpm(0.5));
bpmDoubleEl.addEventListener('click', () => scaleBpm(2));

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
    '.cm-editor, input, textarea, select, [contenteditable="true"], [contenteditable="plaintext-only"]',
  )) return;
  e.preventDefault();
  tap();
});

// ─── Address bar copy ────────────────────────────────────────────────────────
//
// The scene model is one working buffer, autosaved, with a share link as the
// copy that outlives this browser. A link that exists only when someone
// presses share is missing when the unexpected happens: a closed tab, a
// cleared site, a laptop swapped at the venue, a second window overwriting the
// first.
//
// So after a run that worked, the URL in the address bar carries that scene. A
// bookmark, a browser-restored tab or a copied address is then a durable copy,
// with nothing to remember.
//
// Written with replaceState, so it never adds a history entry: back keeps its
// meaning, and a scene run forty times in a set does not bury every other page
// behind forty copies of itself.
//
// Written only after a successful eval. A half-typed scene is not worth
// carrying, the encode is a compression pass, and the address bar would
// flicker while someone types.


/** How long a hash can get before it is left alone. */
const MAX_LIVE_HASH_CHARS = 60_000;

let _hashWriteId = 0;

function rememberSceneInAddressBar(code: string): void {
  // Sequenced: the encode is async, and two fast runs must not land out of
  // order and leave the older scene in the bar.
  const id = ++_hashWriteId;
  void encodeShareLink(code)
    .then((url) => {
      if (id !== _hashWriteId) return;
      const hash = new URL(url).hash;
      // A scene big enough to make the URL unusable is not carried: some
      // browsers and most chat apps truncate a very long one, and a truncated
      // scene that looks like a link is worse than no link.
      if (hash.length > MAX_LIVE_HASH_CHARS) return;
      if (globalThis.location.hash === hash) return;
      globalThis.history.replaceState(null, '', hash);
    })
    .catch(() => {
      // Losing the address-bar copy is not worth a word on the status bar,
      // which is carrying whether the rig is lit.
    });
}

// ─── Resync ──────────────────────────────────────────────────────────────────
// Tapping a tempo fixes the speed and says nothing about where the downbeat is,
// so a set can end up running at exactly the right BPM and half a bar out. This
// puts the count back to the top of a cycle and leaves the tempo alone.
//
// resetPhase() is a single assignment between ticks, so the clock keeps
// running and no frame is dropped. Stopping and starting the clock would zero
// the accumulator too, and would cost the few milliseconds a replacement
// worker takes to come up, which the rig shows as a stutter.

function resync(): void {
  if (!isRunning()) {
    // A stopped clock is already at zero, and starting one here would put a
    // scene on the rig that nobody asked to run.
    setStatus('', 'nothing running · ctrl+enter to run');
    return;
  }
  resetPhase();
  // The message includes the tempo to show that resync left it alone.
  setStatus('ok', `resynced · cycle back to 1 · ${getBPM()} bpm`);
}

bpmResyncEl.addEventListener('click', resync);

// ─── Bridge connection ───────────────────────────────────────────────────────

// Assigned when the outputs panel is mounted further down. Declared here so the
// connection listeners registered just below can reach it once it exists, and
// see null rather than a temporal-dead-zone error if anything fires earlier.
let _outputsPanel: ReturnType<typeof mountOutputsPanel> | null = null;

/**
 * Repaint the connection light from every link at once.
 *
 * The bridge, direct output and a USB interface are independent, and a scene
 * can be using two of them. A label written from one socket alone would read
 * "disconnected" while a rig is driven over USB, so one resolver, called by
 * all three listeners, writes it.
 *
 * Also drives the lock badge and the outputs panel, so a connection appearing
 * updates every place that reports on it.
 */
function refreshOutputIndicator(): void {
  const summary = connectionSummary();
  wsDotEl.className = summary.state === 'connected'
    ? 'ws-dot connected'
    : summary.state === 'disconnected' ? 'ws-dot disconnected'
    : summary.state === 'ready' ? 'ws-dot ready'
    : 'ws-dot';
  wsLabelEl.textContent = summary.label;
  outputStatusEl.title = summary.title;
  wsLockEl.hidden = !needsConnectorUnlock();
  _outputsPanel?.refresh();
}

/**
 * Say on the bar what the indicator already knows.
 *
 * The status line is written when the eval finishes, but delivery can change
 * after that: the connector can go away mid-show, and the interface can be
 * unplugged. Without this, the bar would go on reading "✓ running · art-net →
 * 2.0.0.100" in green with nothing on the wire and the rig frozen on its last
 * frame. Direct output gets the same correction just below.
 */
function refreshOutputStatus(): void {
  refreshOutputIndicator();
  if (!isRunning()) return;
  const out = describeOutput();
  if (!out) return;
  if (out.delivered) setStatus('ok', `✓ running · ${out.text}`);
  else setStatus('error', `running, but ${out.short} was never reached. ${undeliveredHint()}`);
}

onStatusChange(refreshOutputStatus);
onUsbStatusChange(refreshOutputStatus);

/**
 * Direct output opens its socket asynchronously, so the status written the
 * instant an eval finishes always says "not reached". Correct it when the
 * socket settles, otherwise a working setup reads as broken.
 */
onDirectStatusChange(() => {
  refreshOutputIndicator();
  if (!isRunning()) return;
  const out = describeOutput();
  if (!out) return;
  if (out.delivered) setStatus('ok', `✓ running · ${out.text}`);
  else setStatus('error', `running, but ${out.short} was never reached. Is the receiver listening?`);
});

connectBridge();

// ─── Fixture simulation ──────────────────────────────────────────────────────
// Rebuilt from scratch after every successful eval. The core sim-fixture
// registry (populated by each fixture/rgbStrip/rgbwStrip call in the scene)
// says what to draw: one fixture-unit element per entry. No addresses are
// hardcoded here; the panel follows whatever the scene creates.

const simContainerEl = document.getElementById('fixture-lights') as HTMLElement;
const cueBarEl = document.getElementById('cue-bar') as HTMLElement;
const cueListEl = document.getElementById('cue-list') as HTMLElement;
const cueLabelEl = document.getElementById('cue-label') as HTMLElement;

/**
 * The cue bar: one chip per look the scene offered, the live one lit.
 *
 * Rebuilt after every eval, and hidden entirely when a scene offers none, so a
 * file that does not use cue() shows nothing extra. The chips carry their
 * number because that number is also the key that picks them and the program
 * change a controller sends.
 */
function rebuildCueBar(): void {
  const names = getCues();
  cueBarEl.hidden = names.length === 0;
  cueLabelEl.textContent = isCueDrivenByPattern() ? 'cue · chosen by the scene' : 'cue';
  if (names.length === 0) {
    cueListEl.replaceChildren();
    return;
  }
  // A scene with a selector chooses its own look, every frame. There is no one
  // look that is up, so none is highlighted and none can be pressed: a bar
  // showing one live look while a pattern moves between them would contradict
  // the rig.
  const driven = isCueDrivenByPattern();
  cueBarEl.classList.toggle('driven', driven);
  const live = driven ? null : getSelectedCue();
  cueListEl.replaceChildren(...names.map((name, i) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = name === live ? 'cue-chip live' : 'cue-chip';
    chip.disabled = driven;
    chip.setAttribute('aria-pressed', String(name === live));
    // The number only claims a key for the first nine, because only the first
    // nine have one.
    if (i < 9) {
      const key = document.createElement('span');
      key.className = 'cue-key';
      key.textContent = String(i + 1);
      chip.append(key);
    }
    chip.append(document.createTextNode(name));
    chip.title = driven
      ? `"${name}" is one of the looks this scene is choosing between`
      : i < 9
        ? `run "${name}" · alt+${i + 1} · program change ${i}`
        : `run "${name}" · program change ${i}`;
    chip.addEventListener('click', () => selectCue(name));
    return chip;
  }));
}

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
  // Nothing is registered until the scene has been evaluated, so a scene that
  // plainly declares a fixture still has none here until it runs. "no fixtures
  // in this scene" over `const wash = fixture(1, 'rgb')` would read as a fault
  // in the scene, and this is the state the app opens in, above the bundled
  // example. Before a run the panel says how to run instead.

  simEmptyEl.textContent = isRunning()
    ? 'no fixtures in this scene'
    : 'nothing running · ctrl+enter to run';

  // Labelled with the names the scene gave its lights where they can be
  // matched by address, so the sim reads like the code. See declared-lights.ts.
  const names = lightNamesByAddress(editorView.state.doc.toString());

  for (const fix of fixtures) {
    const unit = document.createElement('div');
    unit.className = 'fixture-unit';

    let mainEl: HTMLElement;
    let pixelEls: HTMLElement[] | undefined;

    if (fix.render.kind === 'strip-rgb' || fix.render.kind === 'strip-rgbw' || fix.render.kind === 'strip-mono') {
      mainEl = document.createElement('div');
      mainEl.className = 'fixture-strip';
      const grid = fix.render.grid;
      const cols = grid?.columns ?? fix.render.pixelCount;
      const rows = grid?.rows ?? 1;

      // A grid is drawn as a grid. Cells are square when there is more than one
      // row and tall when there is not, because a single row of pixels is a
      // strip and reads like one. Either way the element ends up the shape of
      // the light: a 12 x 4 wash is three times wider than it is tall.
      if (rows > 1) mainEl.classList.add('is-grid');
      // Sized to fit a budget rather than a fixed cell, so 48 pixels and 8 do
      // not come out the same width and neither runs off the panel.
      const cell = Math.max(3, Math.min(rows > 1 ? 11 : 9, Math.round(150 / cols)));
      mainEl.style.setProperty('--cols', String(cols));
      mainEl.style.setProperty('--cell-w', `${cell}px`);
      mainEl.style.setProperty('--cell-h', rows > 1 ? `${cell}px` : '26px');

      pixelEls = [];
      // Built in picture order and told which wire pixel each square shows, so
      // serpentine wiring and a bottom-right origin land where the eye expects.
      for (let i = 0; i < fix.render.pixelCount; i++) {
        const p = document.createElement('div');
        p.className = 'fixture-strip-pixel';
        mainEl.appendChild(p);
        pixelEls.push(p);
      }
      if (grid) {
        // pixelEls[i] is the square at picture position i; it reads wire pixel
        // grid.order[i].
        const reordered: HTMLElement[] = [];
        for (let i = 0; i < pixelEls.length; i++) reordered[grid.order[i]] = pixelEls[i];
        pixelEls = reordered;
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
    const named = names.get(`${fix.universe}:${fix.patchChannel ?? fix.startChannel}`);
    // An embedded strip keeps the part after the dot: bar · pixels.
    const part = fix.patchChannel !== undefined ? fix.label.split(' · ').slice(1).join(' · ') : '';
    label.textContent = named === undefined ? fix.label : part ? `${named} · ${part}` : named;
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
    } else if (render.kind === 'strip-rgb' || render.kind === 'strip-rgbw' || render.kind === 'strip-mono') {
      // A master dimmer over the fixture dims its pixels on the rig, so it has
      // to dim them here. Otherwise a wash whose master is at zero, emitting
      // nothing, would be drawn on screen at full.
      const m = r.core.master !== undefined ? (buf[r.core.master - 1] ?? 0) / 255 : 1;
      const pixels = r.pixelEls ?? [];
      if (render.kind === 'strip-rgb') {
        for (let i = 0; i < render.pixelCount; i++) {
          const pb = base + i * 3;
          updateStripPixel(pixels[i], (buf[pb] ?? 0) * m, (buf[pb + 1] ?? 0) * m, (buf[pb + 2] ?? 0) * m);
        }
      } else if (render.kind === 'strip-rgbw') {
        for (let i = 0; i < render.pixelCount; i++) {
          const pb = base + i * 4;
          const wv = buf[pb + 3] ?? 0;
          // Mix W additively into RGB for the on-screen pixel.
          updateStripPixel(
            pixels[i],
            Math.min(255, (buf[pb] ?? 0) + wv) * m,
            Math.min(255, (buf[pb + 1] ?? 0) + wv) * m,
            Math.min(255, (buf[pb + 2] ?? 0) + wv) * m,
          );
        }
      } else {
        // One channel per cell, so the level is the colour. Drawn white,
        // because that is what a segmented strobe strip emits.
        for (let i = 0; i < render.pixelCount; i++) {
          const v = (buf[base + i] ?? 0) * m;
          updateStripPixel(pixels[i], v, v, v);
        }
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

  // What this fixture answers to, and the call that patched it, so nobody has
  // to look up in the docs a light that is already on screen.
  const { fixtureId, patchChannel, commands } = r.core;
  const patchLine = fixtureId !== undefined
    ? `<div class="tt-call">fixture(${patchChannel ?? startChannel}, '${escapeHtml(fixtureId)}'${universe !== 0 ? `, ${universe}` : ''})</div>`
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

// ─── Stop from anywhere ──────────────────────────────────────────────────────
//
// The panic key has to work wherever focus is: the sim panel, a toolbar button
// or the page background. The editor binding stays (it can stop autocomplete
// taking Ctrl+Space); this catches the rest of the page.
document.addEventListener('keydown', (e) => {
  if (!e.ctrlKey && !e.metaKey) return;
  if (e.key !== '.' && e.key !== ' ' && e.code !== 'Space') return;
  // The editor already dealt with it and called preventDefault. Running again
  // would be harmless, but this keeps one keypress to one stop.
  if (e.defaultPrevented) return;
  e.preventDefault();
  runStop();
});

// ─── Scene bar ───────────────────────────────────────────────────────────────
// One button: share. Bundled examples are on the docs panel, beside the
// reference that explains them. There is no scene list and no name, because
// the browser holds one working buffer: it is the document on screen, and
// nothing else exists for a name to tell it apart from.

/** Shorten a name for a status line. A legal filename can still be too long
 *  to read in a one-line status message. */
function short(name: string): string {
  return name.length > 32 ? `${name.slice(0, 31)}…` : name;
}

/**
 * Shorten a filename for a status line, keeping its extension.
 *
 * The extension says what kind of file the download wrote, so the ellipsis
 * eats the middle of the name rather than the tail of the string.
 * `short()` on a long name would leave a status line that never says `.js`.
 */
function shortFilename(filename: string): string {
  const dot = filename.lastIndexOf('.');
  // dot > 0, not >= 0: a leading dot is part of the name, not an extension.
  if (dot <= 0) return short(filename);
  const base = filename.slice(0, dot);
  return base.length > 31 ? `${base.slice(0, 30)}…${filename.slice(dot)}` : filename;
}

// ─── Choosing an output from the panel ──────────────────────────────────────

/** A live output call on a line of its own, trailing comment and all. */
const OUTPUT_LINE = /^[ \t]*(?:artnet|sacn|osc|mock|usb|td)[ \t]*\(.*\)[ \t]*;?[ \t]*(?:\/\/.*)?$/m;

/**
 * Write an output call into the scene from the outputs panel.
 *
 * The output lives in the code, like everything else a scene does, so the
 * panel writes the line rather than switching anything behind the scene's
 * back. It replaces the scene's own output line if there is one, and otherwise
 * goes in under the comments at the top. It does not run the scene: ctrl+enter
 * does that, so nothing reaches the rig until the person says so.
 */
function useOutputCode(code: string): void {
  const doc = editorView.state.doc;
  const text = doc.toString();
  const existing = OUTPUT_LINE.exec(text);
  let from: number;
  let to: number;
  let insert: string;
  if (existing) {
    from = existing.index;
    to = existing.index + existing[0].length;
    insert = code;
  } else {
    let line = 1;
    while (line <= doc.lines && /^\s*\/\//.test(doc.line(line).text)) line++;
    from = to = line <= doc.lines ? doc.line(line).from : doc.length;
    insert = `${code}\n`;
  }
  editorView.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + code.length },
    scrollIntoView: true,
  });
  editorView.focus();
  setStatus('', `${code} is in the scene · ctrl+enter to run it`);
}

/**
 * Write patch lines from the fixtures tab into the scene, under the lights it
 * already declares. Like the outputs panel's lines it does not run them: the
 * lines are code in the buffer, and ctrl+enter puts them on the rig. The new
 * lines are selected so they are easy to see and to undo.
 */
function insertPatch(code: string, summary: string): void {
  const doc = editorView.state.doc;
  const line = patchInsertLine(doc.toString());
  let from: number;
  let insert: string;
  if (line < doc.lines) {
    from = doc.line(line + 1).from;
    insert = `${code}\n`;
  } else {
    from = doc.length;
    insert = doc.length === 0 || doc.toString().endsWith('\n') ? `${code}\n` : `\n${code}\n`;
  }
  const start = insert.startsWith('\n') ? from + 1 : from;
  editorView.dispatch({
    changes: { from, insert },
    selection: { anchor: start, head: start + code.length },
    scrollIntoView: true,
  });
  setStatus('', `added ${summary} · ctrl+enter to run`);
}

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
 * the whole buffer: a share link or an example.
 */
function confirmReplace(headline: string): boolean {
  if (!_dirtySinceFileSave) return true;
  return confirm(
    `${headline}\n\n` +
    'The scene in the editor has changes that exist nowhere else. ' +
    'Replacing it will lose them.\n\n' +
    'OK to replace · Cancel to keep it, then copy it or make a share link.',
  );
}

/**
 * Swap the whole buffer for something else: an example or a shared scene.
 * Always lands stopped, so new code runs only when the operator asks for it.
 *
 * `dirty` says whether the incoming text exists anywhere outside this browser.
 */
function replaceBuffer(code: string, opts: { dirty: boolean }): void {
  loadCodeIntoEditor(code);
  // Persist immediately, and regardless of the autosave setting: the editor
  // is showing the new scene, so the browser copy has to be it too.
  saveBuffer(code);
  // After the dispatch above, whose change event set the flag true.
  _dirtySinceFileSave = opts.dirty;
  runStop();
}

// ─── Share link ──────────────────────────────────────────────────────────────

/**
 * Length past which a link starts being risky to paste around. Browsers handle
 * far longer URLs, but chat clients, mail gateways and QR codes truncate
 * somewhere around here (see the note in share.ts). A truncated link fails at
 * the other end, not this one, so the status line states the length.
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

/**
 * Say "copied" on the button itself for a moment.
 *
 * The status bar reports it too, but that is at the far end of the window from
 * the button, so the confirmation goes where the eye already is.

 */
const _flashTimers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();
function flashCopied(button: HTMLElement, restore: string): void {
  const held = _flashTimers.get(button);
  if (held) clearTimeout(held);
  button.textContent = 'copied';
  button.classList.add('copied');
  _flashTimers.set(button, setTimeout(() => {
    button.textContent = restore;
    button.classList.remove('copied');
    _flashTimers.delete(button);
  }, 1600));
}

const shareDialogEl = document.getElementById('share-dialog') as HTMLDialogElement;
const shareUrlEl = document.getElementById('share-url') as HTMLTextAreaElement;
const shareNoteEl = document.getElementById('share-note') as HTMLElement;
const shareResultEl = document.getElementById('share-result') as HTMLElement;
const shareCopyEl = document.getElementById('share-copy') as HTMLButtonElement;
const shareCodeEl = document.getElementById('share-code') as HTMLButtonElement;

/**
 * Build the link, put it on the clipboard, and say so.
 *
 * The top bar has one button for this. Link versus plain code is a
 * distinction about storage, too fine to ask someone to work out from a top
 * bar, so copying the code is a second button inside the dialog, where there
 * is room to say what it is.
 *
 * The copy happens before the dialog opens rather than on a button inside it.
 * Clipboard writes need a user gesture and this click is one; deferring to a
 * second click inside a modal spends that gesture on opening the modal.
 */
async function handleShare(): Promise<void> {
  const code = editorView.state.doc.toString();
  let url: string;
  try {
    url = await encodeShareLink(code);
  } catch (err) {
    setStatus('error', `couldn't build a share link: ${(err as Error).message}`);
    return;
  }

  shareUrlEl.value = url;
  shareNoteEl.textContent = url.length > LONG_LINK_CHARS
    ? `${url.length} characters. Some chat apps cut links this long. Send the code instead for a long scene.`
    : `${url.length} characters. The whole scene is in the link, so it cannot expire.`;

  const copied = await copyText(url);
  // The link is on screen and selected either way, so a browser that refuses
  // the clipboard leaves something to do rather than nothing.
  shareResultEl.textContent = copied
    ? '✓ link copied to the clipboard'
    : 'clipboard unavailable · the link is selected below to copy by hand';
  shareResultEl.classList.toggle('ok', copied);
  shareCopyEl.textContent = 'copy link';
  shareCodeEl.textContent = 'copy the code instead';

  shareDialogEl.showModal();
  shareUrlEl.select();
}

/** Copy the link again, for a second paste or a first one that did not take. */
shareCopyEl.addEventListener('click', () => {
  void (async (): Promise<void> => {
    if (await copyText(shareUrlEl.value)) {
      flashCopied(shareCopyEl, 'copy link');
      return;
    }
    shareCopyEl.textContent = 'copy it by hand';
    shareUrlEl.select();
  })();
});

/**
 * The scene as text rather than as a link.
 *
 * A link has a length ceiling and a paste does not: past a couple of thousand
 * characters the link is the worse of the two, and a scene that long is worth
 * keeping in a file of your own.
 */
shareCodeEl.addEventListener('click', () => {
  void (async (): Promise<void> => {
    const code = editorView.state.doc.toString();
    if (await copyText(code)) {
      flashCopied(shareCodeEl, 'copy the code instead');
      setStatus('ok', `copied ${code.length} characters · paste it somewhere you keep files`);
      return;
    }
    shareCodeEl.textContent = 'clipboard unavailable';
  })();
});

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
  replaceBuffer(ex.code, { dirty: false });
  setStatus('', `example: ${ex.label} · ctrl+enter to run`);
}



// ─── Shared scenes ───────────────────────────────────────────────────────────
// Scene code is evaluated with full page privileges (SECURITY.md,
// packages/core/src/eval.ts), so a scene that arrived in a link can read what
// is saved on this origin and repoint DMX output.
//
// A shared scene is never auto-run, and opening one asks before it replaces
// the buffer, so nothing from a link executes until the user presses
// ctrl+enter on code they can see. There is no warning banner on top of that:
// it would put a paragraph of reading in the way on every open.

/** Whether this session started from a link, so the ready message does not
 *  overwrite the line saying so. */
let _openedFromLink = false;

/**
 * Load a scene out of the URL hash, if there is one. Runs once at boot.
 *
 * Never auto-runs the code, and never replaces unsaved work without asking.
 */
async function handleSharedScene(): Promise<void> {
  const shared = await decodeShareFromLocation();
  if (shared === null) return;

  if (!confirmReplace('Open the shared scene?')) {
    // The link stays in the address bar. It is the only copy of somebody
    // else's scene the page has, and keeping it lets the user secure their own
    // work first and open the link afterwards. A refresh asks again, which is
    // the lesser cost.
    setStatus('', 'shared scene not loaded · your work is untouched, the link is still in the address bar');
    return;
  }
  // Stripped only once it has been taken, so a refresh does not offer to
  // replace the scene with itself.
  clearShareFromLocation();
  // Dirty: a scene from a link exists in no file of the user's, so whatever
  // would replace it next still has to ask.
  replaceBuffer(shared.code, { dirty: true });
  _openedFromLink = true;
  setStatus('', 'shared scene loaded · read it, then ctrl+enter to run');
}

// ─── Legacy scenes notice ────────────────────────────────────────────────────
// Scenes saved under the pre-0.3 multi-scene model. Their storage keys are
// only read (see listLegacyScenes), never written or cleared. The panel offers
// to take copies out as files; dismissing it changes nothing but whether the
// panel appears again.

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

// ─── Report a problem ────────────────────────────────────────────────────────
// What the bug form's environment field is filled with. Read at the moment the
// button is pressed, so it describes the setup as it is while something is
// wrong, not as it was at load. What goes in, and what is kept out, is in
// report.ts: a report is public, so this names the setup and nothing of yours.

function currentEnvironment(): Environment {
  const nav = navigator as Navigator & {
    userAgentData?: { brands?: { brand: string; version: string }[]; platform?: string };
  };
  const desktop = isDesktopBuild();
  const connector = getConnectorInfo();
  return {
    version: APP_VERSION,
    route: routeName({ desktop, hostname: window.location.hostname, port: window.location.port }),
    browser: browserName(nav.userAgent, nav.userAgentData?.brands),
    system: systemName(nav.userAgent, nav.userAgentData?.platform),
    output: currentOutputId() ?? 'none chosen',
    connector: connector
      ? (connector.version ?? 'connected, too old to say its version')
      : desktop ? 'built into the app, not connected' : 'not connected',
    localAccess: servedLocally() ? 'not asked (served from this computer)' : getLocalAccess(),
  };
}

// ─── The side panel ──────────────────────────────────────────────────────────
// One panel, five tabs: the reference, the fixture library, the log, the
// outputs and the settings.
//
// panel.ts owns the shell. Each module below renders into the page it is
// handed and is told when that page comes into view.

const docsBodyEl     = document.getElementById('docs-body')     as HTMLElement;
const libraryBodyEl  = document.getElementById('library-body')  as HTMLElement;
const logBodyEl      = document.getElementById('log-body')      as HTMLElement;
const outputsBodyEl  = document.getElementById('outputs-body')  as HTMLElement;
const settingsBodyEl = document.getElementById('settings-body') as HTMLElement;

// Declared before the pages are mounted, because each of them asks whether it
// is the one on screen and the panel does not exist yet at that point. Null
// until mountPanel() returns, which is before anything can be clicked.
let _panel: PanelHost | null = null;
const pageIsOpen = (id: string) => (): boolean => _panel?.isOpen(id) ?? false;

renderDocs(docsBodyEl);

// The reference raises this when one of its example rows is clicked. It
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

const libraryPanel = mountLibraryPanel({
  bodyEl: libraryBodyEl,
  getDoc: () => editorView.state.doc.toString(),
  onPatch: insertPatch,
});

// Recording starts before anything else runs, so a failure during start-up is
// already in the log by the time anyone opens it.
mountConsolePanel({
  bodyEl: logBodyEl,
  isOpen: pageIsOpen('log'),
  // In the desktop app this new window is handed to the system browser.
  onReport: () => { window.open(reportUrl(currentEnvironment()), '_blank', 'noopener'); },
});

mountSettingsPanel({ bodyEl: settingsBodyEl });

// Kept in _outputsPanel so the connection listeners can repaint it.
_outputsPanel = mountOutputsPanel({
  bodyEl: outputsBodyEl,
  isOpen: pageIsOpen('outputs'),
  // Choosing a serial port needs a user gesture, and a click on the panel row
  // is one, so the row can share the top-bar button's handler.
  onUsbRequest: () => { void handleUsbButton(); },
  onUseCode: useOutputCode,
});

_panel = mountPanel({
  shellEl:  document.getElementById('panel')        as HTMLElement,
  tabsEl:   document.getElementById('panel-tabs')   as HTMLElement,
  closeEl:  document.getElementById('panel-close')  as HTMLButtonElement,
  toggleEl: document.getElementById('panel-toggle') as HTMLButtonElement,
  pages: [
    // "docs": the page has a sub-tab of its own called "reference", and it
    // carries the walkthrough and the bundled scenes as well as the function
    // list.
    { id: 'docs', label: 'docs', bodyEl: docsBodyEl,
      title: 'every function a scene can call, the bundled examples, and how to start' },
    // "fixtures" names what the definitions are. The docs page has its own
    // fixtures tab: this one is the stock you can address by name, that one is
    // how to address it.
    { id: 'fixtures', label: 'fixtures', bodyEl: libraryBodyEl,
      title: 'fixture definitions you can address by name, and the ones this scene declared' },
    { id: 'log', label: 'log', bodyEl: logBodyEl,
      title: 'what the scene has printed, and what went wrong' },
    { id: 'outputs', label: 'outputs', bodyEl: outputsBodyEl,
      title: 'where light is going, and whether it is arriving' },
    { id: 'settings', label: 'settings', bodyEl: settingsBodyEl },
  ],
});

// The connection light also opens the outputs tab. It is what a lighting
// person looks at when the rig is dark.
outputStatusEl.addEventListener('click', () => _panel?.toggle('outputs'));
// The welcome page's "connect your lights" goes to the live panel, not a doc.
document.addEventListener(OPEN_PANEL_EVENT, (e) => {
  const id = (e as CustomEvent<string>).detail;
  if (id) _panel?.open(id);
});

// An error on the bar is usually longer than the bar. Clicking it opens the
// log, which has the whole thing; the hover title has it too, for anyone who
// would rather not lose the editor width. Wired here rather than in
// setStatus so the handler is installed once instead of per message.
evalStatusEl.addEventListener('click', () => {
  if (evalStatusEl.classList.contains('clickable')) _panel?.open('log');
});

// Re-apply the theme whenever the setting changes. Other settings are read at
// the point of use and need no subscription; themes need one because they
// write CSS variables onto :root to take effect.
onSettingsChange((s) => {
  applyTheme(s.theme, { black: s.blackBackground });
  applyFontSize(s.fontSize);
  goboEditor.setPrefs(editorPrefs());
  applyAnimations(s.animations);
});

// After every successful eval, any new defineFixture() calls land in the
// runtime registry. Refresh the library panel so those show up in the
// "Defined this session" section as save-able.
const _refreshLibraryAfterEval = (): void => libraryPanel.refresh();

// ─── Minimal view ────────────────────────────────────────────────────────────
// One key hides everything that is not the code: the top bar, the sim panel
// and the level strip. The screen lights stay, because a scene using screen()
// is aiming at them and they are output. So does the status bar, where a
// pattern error turns up mid-set.
//
// Strudel calls this zen mode; "minimal view" says what it is to someone who
// has not met strudel. Three ways in: alt+m, the button in the bar, and
// clicking the mark on the left (Strudel's own gesture). What it hides is
// tucked away and comes back on hover (the CSS in index.html), so nothing is
// out of reach while it is on.
//
// Bound on the document, not in the editor's keymap: a CodeMirror keymap only
// fires while the editor has focus. Tests that focus the editor before
// pressing a key will not catch that.
//
// alt+m rather than a ctrl+shift combination: ctrl+shift+m switches profile in
// Chrome and opens responsive mode in Firefox, and a page cannot take either
// back. CodeMirror's default keymap binds alt+l, alt+shift+a, ctrl+m and, on
// macOS, shift+alt+m; the autocomplete keymap binds no alt at all. Plain alt+m
// is bound by none of them. Shift is rejected below because shift+alt+m is
// macOS's tab-focus toggle, and taking it would cost an accessibility control.
//
// Not persisted: the Settings type in settings.ts has no key for it, so the
// view starts off on every load. That is the safer default, since nobody then
// opens gobo into a window with no controls and has to work out why.


const zenExitEl = document.getElementById('zen-exit') as HTMLButtonElement;
const zenToggleEl = document.getElementById('zen-toggle') as HTMLButtonElement;
const wordmarkEl = document.getElementById('wordmark') as HTMLButtonElement;

let _zenMode = false;

function setZenMode(on: boolean): void {
  _zenMode = on;
  document.body.classList.toggle('zen-mode', on);
  // Which parts the view hides are settings; the key stays a single toggle.
  // Read on every toggle rather than cached, so changing a setting with the
  // view open takes effect when it is next turned on.
  const s = getSettings();
  document.body.classList.toggle('zen-hide-chrome', on && s.zenHideChrome);
  document.body.classList.toggle('zen-hide-sim', on && s.zenHideSim);
  document.body.classList.toggle('zen-hide-levels', on && s.zenHideLevels);
  document.body.classList.toggle('zen-hide-cues', on && s.zenHideCues);
  document.body.classList.toggle('zen-black', on && s.zenBlackBackground);
  zenToggleEl.setAttribute('aria-pressed', String(on));
  wordmarkEl.setAttribute('aria-pressed', String(on));
  // The exit button is the only thing on screen naming this mode, and clicking
  // it is the way out, so forgetting the key does not strand anyone.
  zenExitEl.hidden = !on;
  if (!on) return;
  // A panel left open would sit over the code this view is for. It is a
  // hover away: the button that opens it is in the tucked-away top bar.
  _panel?.close();
  // Whatever had focus may have just become display:none, which drops focus to
  // the body. The code is the only thing left to type into.
  editorView.focus();
}

document.addEventListener('keydown', (e) => {
  // Ctrl is rejected as well as the other modifiers because Windows sends
  // ctrl+alt for AltGr, so an international layout typing a character on that
  // key must not toggle the layout out from under the typist.
  if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
  // Either identifier matches. e.code is the physical key, which holds up
  // where alt composes a character (alt+m is µ on macOS) or the layout is
  // not Latin. e.key covers the sources that send no code at all: on-screen
  // keyboards, some remote-desktop clients, and the browser automation this was
  // tested through, all of which would otherwise find the shortcut dead.
  if (e.code !== 'KeyM' && e.key.toLowerCase() !== 'm') return;
  // Holding the key repeats at the OS rate, which would strobe the layout.
  if (e.repeat) return;
  e.preventDefault();
  setZenMode(!_zenMode);
});

zenExitEl.addEventListener('click', () => setZenMode(false));
zenToggleEl.addEventListener('click', () => setZenMode(!_zenMode));
wordmarkEl.addEventListener('click', () => setZenMode(!_zenMode));

// ─── Init ────────────────────────────────────────────────────────────────────

// Register the bundled public-library fixtures so `fixture(1, 'any-public-id')`
// works without clicking "add" first. Public fixtures go in first; the user's
// localStorage library is restored next so a user-pinned version of a public
// id (if any) wins.
registerPublicFixtures();

// Nothing updates the desktop app automatically, so it asks GitHub whether a
// newer release is out and says so in the top bar. See app-update.ts.
if (isDesktopBuild()) {
  const desktopVersion = (globalThis as { gobo?: { version?: string } }).gobo?.version ?? 'unknown';
  void mountAppUpdate({
    button: document.getElementById('app-update') as HTMLButtonElement,
    current: desktopVersion,
  });
}
restoreLibraryFixtures();

// Resolve the connection light once at boot. The markup ships reading
// "disconnected", which is wrong before a scene has chosen any output at all.
refreshOutputIndicator();

// Defensive: ensure the scheduler is in the stopped state on boot. Vite's
// HMR can keep the worker / animation loop alive across reloads in dev,
// which makes the page look like it's "already playing" before the user
// hits Ctrl+Enter. Calling stop() unconditionally is a no-op on a cold
// load and a reset under HMR.
runStop();

// One-time offer to export the pre-0.3 multi-scene saves as files. Reads the
// legacy keys; never writes or clears them.
mountLegacyNotice();

// A scene may have arrived in the URL hash. Handled after the editor and the
// stop above exist, so the incoming code lands in a halted app. It is loaded
// for the user to read, never started for them.
void handleSharedScene();

// A link pasted into a tab that already has gobo open changes only the hash,
// which is a same-document navigation: nothing reloads, so the boot handler
// never runs. Without this listener the scene would not arrive, the address
// bar would keep a payload nobody read, and no message would say why. Pasting
// a link into the tab you are already in is an ordinary way to open one.
//
// replaceState does not fire this event, so the permalink the app writes after
// every successful run cannot trigger it; only a navigation the user made can.
window.addEventListener('hashchange', () => {
  void handleSharedScene();
});

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
  if (!_openedFromLink) {
    setStatus('', 'ctrl+enter to run  ·  ctrl+space / ctrl+. to stop  ·  alt+m for minimal view');
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
// again. Browsers remember the grant but not the open port, so without this a
// reload would leave a plugged-in box disconnected until someone clicked
// through the chooser a second time. Nothing is prompted here: getPorts() only ever
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
    setStatus('error', 'this browser has no WebSerial · use Chrome or Edge');
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
// Someone running from a checkout has one command for that. Someone on the
// hosted site has no repository to run anything from, and an npm command is no
// use to them, so they get the download instead.

// RELEASES_URL, connectorFileName(), hasSeenConnector() and rememberConnector()
// come from outputs.ts, which the panel reads from too, so the banner and the
// panel cannot drift apart on what to offer or whom to offer it to.

/**
 * How long to let the socket finish connecting before calling it a failure.
 *
 * Pressing ctrl+enter as the page loads beats the WebSocket to it, so declaring
 * "nothing is listening" straight away would flash a download prompt at someone
 * whose connector is running.
 */
const CONNECT_GRACE_MS = 2500;
let _connectorPromptTimer: ReturnType<typeof setTimeout> | null = null;

function undeliveredHint(): string {
  const out = describeOutput();
  if (out?.short === 'td()') return 'Is the receiver listening?';
  if (out?.short.startsWith('usb')) return 'Open the outputs panel from the connection light and pick the interface.';
  if (browserBlocksConnector()) {
    return 'Your browser is blocking this page from reaching this computer: allow local network '
      + 'access for this site, or run gobo locally.';
  }
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
  connectorBannerLinkEl.href = connectorDownloadUrl();

  if (browserBlocksConnector()) {
    // Offering the download here would send someone to fetch a program they
    // may have running already. The browser's permission is what is missing.
    connectorBannerTextEl.textContent = `${target} is going nowhere. ${BLOCKED_BY_BROWSER}`;
    connectorBannerLinkEl.hidden = true;
    setConnectorBannerOpen(true);
    return;
  }

  if (hasSeenConnector()) {
    // The connector is installed here but not running.
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
    // Same sentence the outputs panel gives for this output, so the banner and
    // the panel agree.
    connectorBannerTextEl.textContent =
      `${blockedOutputMessage(target)} The file to download is ${connectorFileName()}.`;
  }
  setConnectorBannerOpen(true);
}

connectorBannerDismissEl.addEventListener('click', () => setConnectorBannerOpen(false));

// The banner says one output is blocked. This opens the panel that says which
// outputs are not, which is the more useful answer for anyone unwilling to
// install anything.
connectorBannerMoreEl.addEventListener('click', () => _panel?.open('outputs'));

// Ask the browser once whether this page may reach the computer at all, and
// keep listening. Allowing it takes effect at once rather than after whatever
// the reconnect backoff has stretched to, and every surface that explains the
// connector is redrawn with the new answer.
if (!servedLocally()) {
  onLocalAccessChange((state) => {
    if (state === 'granted') retryBridgeNow();
    refreshOutputStatus();
    if (connectorBannerEl.classList.contains('open')) {
      const out = describeOutput();
      if (out && !out.delivered) renderConnectorBanner(out.short);
      else setConnectorBannerOpen(false);
    }
  });
  void watchLocalAccess();
}

// Once something is listening, the banner closes.

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
