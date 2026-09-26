/**
 * User settings: small preferences persisted in localStorage.
 * Rendered into one tab of the side panel (panel.ts).
 *
 * Each setting has:
 *   - a stable key in the persisted JSON blob
 *   - a default value applied on first run and when "reset" is clicked
 *   - a UI control (toggle or select)
 *   - (optional) an onChange callback the host wires in
 *
 * Settings are read synchronously via `getSettings()` so callers don't
 * need to subscribe; long-lived behaviour (e.g. autosave) reads the
 * current value at the point of decision rather than caching it.
 */

import { THEMES, THEME_LIST, LEGACY_THEME_IDS, type ThemeId } from './themes.js';
import { PANEL_OPEN_EVENT } from './panel.js';
import { migrateLegacyKey } from './storage-migration.js';

const STORAGE_KEY = 'gobo-settings-v1';

// Pre-rename this blob lived under `lumen-settings-v1`. Adopt it before the
// first read so an existing user keeps their theme, send rate and stop
// action instead of being silently reset to defaults. See
// storage-migration.ts.
migrateLegacyKey(STORAGE_KEY, 'lumen-settings-v1');

/** Behaviour when the user presses the stop key (Ctrl+. / Ctrl+Space).
 *  - 'blackout' wipes the universe buffers and turns every fixture off.
 *  - 'freeze'   leaves the last frame on the output buffers, so sim and
 *               hardware hold their colour until the next eval. */
export type StopAction = 'blackout' | 'freeze';

/** Maximum send rate to the bridge in Hz. Higher is smoother and uses
 *  more network traffic. 60 is the default, 30 saves bandwidth on
 *  wireless rigs, 120 suits local rigs running at high refresh. */
export type SendRate = 25 | 30 | 40 | 44;

/**
 * Editor type size, in pixels.
 *
 * Bigger than a text editor's usual range at the top end on purpose: this is
 * read in a dark room, over someone's shoulder, and sometimes off a projector
 * at the back of a venue. 13 is for working on a laptop, 24 is for being able
 * to see it from the desk.
 */
export type FontSize = 11 | 13 | 15 | 18 | 21 | 24;

/**
 * Rates that used to be offered. A setting saved as 60 or 120 is migrated to
 * the nearest useful value rather than left as a number the select cannot
 * show, which would silently reset it to the default on the next write.
 */
const LEGACY_SEND_RATES: Record<number, SendRate> = { 60: 40, 120: 44 };

export interface Settings {
  /** What runStop() does. Default 'blackout'. */
  stopAction: StopAction;
  /** Whether the editor autosaves on every change. Default true. */
  autosave: boolean;
  /** Whether inline pattern viz (.flash / .glow / .wave) renders.
   *  Toggle off for big scenes where the decoration redraws are
   *  visible in DevTools. Default true. */
  inlineViz: boolean;
  /** Whether sim panel tooltips show on hover. Default true. */
  simTooltips: boolean;
  /** Maximum send rate to the bridge, in Hz. Default 40.
   *
   *  DMX512 carries at most about 44 full frames a second: 512 channels plus
   *  break and start code at 250 kbit/s. Sending faster than the wire can
   *  carry buys nothing, and the Art-Net spec asks senders not to exceed that
   *  rate. 40 sits just under it. */
  sendRate: SendRate;
  /** Active colour theme. Default 'tungsten' (the original warm-brown,
   *  formerly stored as 'ember'; see resolveThemeId()). */
  theme: ThemeId;
  /** Editor type size in pixels. Default 13. */
  fontSize: FontSize;
  /** Format the editor buffer with prettier every time the code runs
   *  (Ctrl+Enter). Off by default, because rewriting the doc
   *  mid-performance moves the cursor anchor. */
  formatOnRun: boolean;
  /** What zen mode (alt+m, the button in the top bar, or a click on the mark)
   *  hides.
   *
   *  The mode is one switch; these decide what it does. Someone projecting the
   *  screen wants the code alone, someone in a booth may want the sim kept. All
   *  default true except the background, which changes what the code sits on
   *  and is the one worth opting into. */
  zenHideChrome: boolean;
  zenHideSim: boolean;
  zenHideLevels: boolean;
  zenHideCues: boolean;
  /** Drop the page background to black behind the code. Default false. */
  zenBlackBackground: boolean;

  // ── The editor itself ──────────────────────────────────────────────────
  // The editor is the whole interface here, and an editor habit is personal:
  // someone who has typed in one for twenty years has opinions about brackets
  // closing themselves. Each of these maps to a CodeMirror extension held in
  // a compartment (editor.ts), so changing one takes effect with a scene
  // running rather than on the next reload.
  /** Line numbers down the gutter. Default true. */
  lineNumbers: boolean;
  /** Tint the line the cursor is on. Default true. */
  activeLine: boolean;
  /** Light up the bracket matching the one beside the cursor. Default true. */
  bracketMatching: boolean;
  /** Type ( and get (). Default true. */
  closeBrackets: boolean;
  /** Wrap a long line instead of scrolling it sideways. Default false. */
  lineWrapping: boolean;
  /** The completion popup. Default true. */
  autocomplete: boolean;
  /** Hover a name for what it does. Default true. */
  hoverHelp: boolean;
  /** Outline the mini-notation token that is driving light right now.
   *  Default true; the one setting here that is about the rig rather than
   *  about typing. */
  eventHighlight: boolean;
  /** Cmd/Ctrl+click for a second cursor. Default true. */
  multiCursor: boolean;
  /** Ctrl+Enter runs the block around the cursor, and Ctrl+Shift+Enter runs
   *  the whole document. The pair swaps rather than one disappearing.
   *  Default false, because the document is the safer thing for the main
   *  chord to mean. */
  blockEval: boolean;
  /** Flash the editor when a run lands. Default true: the status bar is at
   *  the bottom of the window and the eyes are on the code. */
  flashOnRun: boolean;
  /** CSS transitions and animations across the app. Off is for a slow
   *  machine, or for anyone who does not want movement they did not ask for.
   *  Default true. */
  animations: boolean;
}

const DEFAULTS: Settings = {
  stopAction: 'blackout',
  autosave: true,
  inlineViz: true,
  simTooltips: true,
  sendRate: 40,
  theme: 'tungsten',
  fontSize: 13,
  formatOnRun: false,
  zenHideChrome: true,
  zenHideSim: true,
  zenHideLevels: true,
  zenHideCues: false,
  zenBlackBackground: false,
  lineNumbers: true,
  activeLine: true,
  bracketMatching: true,
  closeBrackets: true,
  lineWrapping: false,
  autocomplete: true,
  hoverHelp: true,
  eventHighlight: true,
  multiCursor: true,
  blockEval: false,
  flashOnRun: true,
  animations: true,
};

let _cached: Settings | null = null;
const _listeners = new Set<(s: Settings) => void>();

function readRaw(): Partial<Settings> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object') return parsed as Partial<Settings>;
  } catch {
    // Corrupt blob. Fall through to defaults so a broken localStorage
    // entry can't brick the page. The next write fixes it.
  }
  return {};
}

function writeRaw(s: Settings): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch { /* quota / private mode */ }
}

/**
 * Resolve a persisted theme id to one that still exists.
 *
 * The theme ids were renamed (ember → tungsten, slate → moonbox, and so
 * on). The stored value is whatever id was current when the user picked
 * it, so anyone who chose a theme before the rename has a legacy id.
 * applyTheme() falls back to the default for an id it does not know, so
 * without this the rename would silently reset their choice.
 *
 * Returns null for a value that is neither current nor legacy (a hand-
 * edited or corrupt blob), so the caller can fall back to the default.
 */
function resolveThemeId(stored: unknown): ThemeId | null {
  if (typeof stored !== 'string') return null;
  // Current ids win over the legacy map: an id that exists today is
  // never reinterpreted, even if some future rename reuses the spelling.
  if (Object.prototype.hasOwnProperty.call(THEMES, stored)) return stored as ThemeId;
  return LEGACY_THEME_IDS[stored] ?? null;
}

/**
 * The five zen-mode switches under the names they had while the mode was
 * called the performance view.
 *
 * Renaming a key silently resets whoever had changed one: the stored blob
 * still holds the old spelling, the merge below drops it as unknown, and the
 * default takes over with nothing on screen to say so. Adopted on read, then
 * written back, so the old spelling is gone for good rather than depending on
 * this map being kept forever.
 */
const RENAMED_KEYS: Record<string, keyof Settings> = {
  perfHideChrome: 'zenHideChrome',
  perfHideSim: 'zenHideSim',
  perfHideLevels: 'zenHideLevels',
  perfHideCues: 'zenHideCues',
  perfBlackBackground: 'zenBlackBackground',
};

/** Pull any old key spellings in `raw` across to their current names. Returns
 *  the adopted pairs, empty when there was nothing to adopt. */
function adoptRenamedKeys(raw: Record<string, unknown>): Partial<Settings> {
  const out: Record<string, unknown> = {};
  for (const [was, now] of Object.entries(RENAMED_KEYS)) {
    // The current spelling wins where both are present, so an adoption can
    // never undo a choice made since the rename.
    if (was in raw && !(now in raw)) out[now] = raw[was];
  }
  return out as Partial<Settings>;
}

/** Merge persisted values over defaults. Unknown keys are dropped and
 *  missing ones inherit defaults. Cached for fast repeat reads. */
export function getSettings(): Settings {
  if (_cached) return _cached;
  const raw = readRaw();
  const adopted = adoptRenamedKeys(raw as Record<string, unknown>);
  // Only keys that exist today are carried over. A plain spread would keep
  // whatever else is in the blob and write it back out again, which would make
  // the adoption above a lie: the old spelling would live in storage forever.
  const merged: Settings = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS) as (keyof Settings)[]) {
    if (key in raw) (merged as unknown as Record<string, unknown>)[key] = (raw as Record<string, unknown>)[key];
  }
  Object.assign(merged, adopted);
  merged.theme = resolveThemeId(raw.theme) ?? DEFAULTS.theme;
  // 60 and 120 Hz used to be offered, and both are above what DMX can carry.
  merged.sendRate = LEGACY_SEND_RATES[merged.sendRate as number] ?? merged.sendRate;
  _cached = merged;
  // Write the adopted id straight back. Settings are otherwise only
  // persisted when the user changes one, so a legacy id would sit in
  // storage indefinitely and be lost the moment LEGACY_THEME_IDS is
  // retired. Rewriting on first read makes the adoption permanent while
  // the map is still here. Guarded on an actual change so a first run
  // (no stored theme at all) doesn't write.
  if ((raw.theme !== undefined && raw.theme !== merged.theme)
    || (raw.sendRate !== undefined && raw.sendRate !== merged.sendRate)
    || Object.keys(adopted).length > 0) writeRaw(merged);
  return _cached;
}

export function setSetting<K extends keyof Settings>(key: K, value: Settings[K]): void {
  const s = { ...getSettings(), [key]: value };
  _cached = s;
  writeRaw(s);
  for (const cb of _listeners) cb(s);
}

export function onSettingsChange(cb: (s: Settings) => void): () => void {
  _listeners.add(cb);
  return () => _listeners.delete(cb);
}

export function resetSettings(): void {
  _cached = { ...DEFAULTS };
  writeRaw(_cached);
  for (const cb of _listeners) cb(_cached);
}

// ─── Panel UI ────────────────────────────────────────────────────────────────

/** Render the settings page into `bodyEl`. The panel shell (panel.ts) owns
 *  opening, closing and which tab is showing. */
export function mountSettingsPanel(opts: {
  bodyEl: HTMLElement;
}): void {
  const { bodyEl } = opts;

  // Drawn each time it comes into view rather than once: a setting can be
  // changed from elsewhere (the zen-key adoption on first read, a reset), and
  // a stale toggle is a switch that lies about what it is set to.
  bodyEl.addEventListener(PANEL_OPEN_EVENT, () => render());

  function render(): void {
    const s = getSettings();
    // Each row is label, control, hint. A string template plus a couple of
    // delegated listeners, no framework.
    //
    // Grouped under headings rather than run together: there are twenty-five
    // of these now, and a flat list of twenty-five switches is a list nobody
    // reads to the end of. The groups are by what the setting is about, not
    // by what kind of control it is.
    bodyEl.innerHTML = `
      <div class="settings-list">
        ${section('how it looks')}
        ${row({
          key: 'theme',
          label: 'theme',
          hint: 'colour scheme for the editor and ui chrome. takes effect immediately.',
          control: select('theme', s.theme, THEME_LIST.map((t) => ({ value: t.id, label: t.label }))),
        })}
        ${row({
          key: 'fontSize',
          label: 'text size',
          hint: 'how big the code is. the large sizes are for reading it in a dark room, or off a projector.',
          control: select('fontSize', String(s.fontSize), [
            { value: '11', label: '11 px' },
            { value: '13', label: '13 px (default)' },
            { value: '15', label: '15 px' },
            { value: '18', label: '18 px' },
            { value: '21', label: '21 px' },
            { value: '24', label: '24 px' },
          ]),
        })}
        ${row({
          key: 'animations',
          label: 'animations',
          hint: 'the slide, fade and colour transitions across the app. off for a slow machine, or for anyone who would rather nothing moved unasked.',
          control: toggle('animations', s.animations),
        })}

        ${section('the editor')}
        ${row({
          key: 'lineNumbers',
          label: 'line numbers',
          hint: 'the gutter down the left. an error names the line it came from, so these are how you find it.',
          control: toggle('lineNumbers', s.lineNumbers),
        })}
        ${row({
          key: 'activeLine',
          label: 'highlight the active line',
          hint: 'a tint on the line the cursor is on.',
          control: toggle('activeLine', s.activeLine),
        })}
        ${row({
          key: 'lineWrapping',
          label: 'wrap long lines',
          hint: 'off, a long chain runs off the right edge and scrolls. on, it folds onto the next line and the line numbers stop lining up with what you see.',
          control: toggle('lineWrapping', s.lineWrapping),
        })}
        ${row({
          key: 'bracketMatching',
          label: 'match brackets',
          hint: 'lights up the bracket paired with the one beside the cursor.',
          control: toggle('bracketMatching', s.bracketMatching),
        })}
        ${row({
          key: 'closeBrackets',
          label: 'close brackets',
          hint: 'type ( and get () with the cursor inside. typing the closing one steps over it rather than doubling it.',
          control: toggle('closeBrackets', s.closeBrackets),
        })}
        ${row({
          key: 'multiCursor',
          label: 'multiple cursors',
          hint: 'cmd/ctrl+click puts a second cursor down, and typing goes to all of them. for changing the same thing on four lights at once.',
          control: toggle('multiCursor', s.multiCursor),
        })}
        ${row({
          key: 'autocomplete',
          label: 'autocomplete',
          hint: 'the popup that offers function and channel names as you type. enter or tab accepts.',
          control: toggle('autocomplete', s.autocomplete),
        })}
        ${row({
          key: 'hoverHelp',
          label: 'hover help',
          hint: 'hover a function name for what it does and what it takes.',
          control: toggle('hoverHelp', s.hoverHelp),
        })}

        ${section('running a scene')}
        ${row({
          key: 'blockEval',
          label: 'ctrl+enter runs the block',
          hint: 'off, ctrl+enter runs the whole document and ctrl+shift+enter runs the block around the cursor. on, the two swap. the document is the default because it is the one that cannot leave half a scene running.',
          control: toggle('blockEval', s.blockEval),
        })}
        ${row({
          key: 'stopAction',
          label: 'stop action',
          hint: 'what ctrl+. / ctrl+space does. blackout zeroes all channels; freeze leaves the last frame on outputs. a second press blacks out either way.',
          control: select('stopAction', s.stopAction, [
            { value: 'blackout', label: 'blackout (default)' },
            { value: 'freeze',   label: 'freeze last frame' },
          ]),
        })}
        ${row({
          key: 'flashOnRun',
          label: 'flash on run',
          hint: 'a brief flash across the editor when a run lands. the status bar says so too, but it is at the bottom of the window and your eyes are on the code.',
          control: toggle('flashOnRun', s.flashOnRun),
        })}
        ${row({
          key: 'formatOnRun',
          label: 'format on run',
          hint: 'reformat the buffer with prettier each time you press ctrl+enter. ctrl+shift+f is the manual trigger.',
          control: toggle('formatOnRun', s.formatOnRun),
        })}
        ${row({
          key: 'autosave',
          label: 'autosave',
          hint: 'persist every edit to the browser after a 500ms idle. off still writes when the tab closes, so a crash costs the session rather than everything. share is what makes a copy that outlives this browser.',
          control: toggle('autosave', s.autosave),
        })}

        ${section('what the rig is doing')}
        ${row({
          key: 'eventHighlight',
          label: 'highlight events in code',
          hint: 'outlines the mini-notation token that is driving light at this instant, so the code and the rig read as one thing.',
          control: toggle('eventHighlight', s.eventHighlight),
        })}
        ${row({
          key: 'inlineViz',
          label: 'inline viz',
          hint: '.flash() / .glow() / .wave() decorations in the editor. turn off if redraws become distracting.',
          control: toggle('inlineViz', s.inlineViz),
        })}
        ${row({
          key: 'simTooltips',
          label: 'sim tooltips',
          hint: 'hover any fixture in the sim panel to show its DMX values. off for a quieter UI.',
          control: toggle('simTooltips', s.simTooltips),
        })}
        ${row({
          key: 'sendRate',
          label: 'send rate',
          hint: 'cap on bridge updates per second. DMX itself carries about 44, so 40 is the useful ceiling. Lower it for wireless rigs.',
          control: select('sendRate', String(s.sendRate), [
            { value: '25',  label: '25 Hz' },
            { value: '30',  label: '30 Hz' },
            { value: '40',  label: '40 Hz (default)' },
            { value: '44',  label: '44 Hz (DMX maximum)' },
          ]),
        })}

        ${section('minimal view')}
        ${row({
          key: 'zenHideChrome',
          label: 'hide the top bar',
          hint: 'what alt+m, the minimal view button and a click on the mark tuck away. the view is one switch; these decide what it does. the top bar comes back while the pointer is at the top edge.',
          control: toggle('zenHideChrome', s.zenHideChrome),
        })}
        ${row({
          key: 'zenHideSim',
          label: 'hide the sim',
          hint: 'the fixture simulation under the editor. with the level strip also hidden, both come back while the pointer is on the status bar.',
          control: toggle('zenHideSim', s.zenHideSim),
        })}
        ${row({
          key: 'zenHideLevels',
          label: 'hide the level strip',
          hint: 'the 512-bar channel strip at the bottom.',
          control: toggle('zenHideLevels', s.zenHideLevels),
        })}
        ${row({
          key: 'zenHideCues',
          label: 'hide the cue bar',
          hint: 'off by default. the cue chips say which look is up, which is worth keeping on a projector.',
          control: toggle('zenHideCues', s.zenHideCues),
        })}
        ${row({
          key: 'zenBlackBackground',
          label: 'black background',
          hint: 'drop the page to black behind the code, for projecting.',
          control: toggle('zenBlackBackground', s.zenBlackBackground),
        })}

        <div class="settings-footer">
          <button type="button" class="settings-reset" data-setting-action="reset">reset all to defaults</button>
        </div>
      </div>
    `;
  }

  // Delegated change/click handlers. Simpler than attaching to each
  // control, and they survive the innerHTML rebuild in render().
  bodyEl.addEventListener('change', (ev) => {
    const t = ev.target as HTMLElement;
    const key = t.dataset.settingKey as keyof Settings | undefined;
    if (!key) return;
    if (t instanceof HTMLInputElement && t.type === 'checkbox') {
      // Booleans: autosave / inlineViz / simTooltips. Cast through unknown
      // because TS can't narrow the union from a runtime string key.
      (setSetting as (k: keyof Settings, v: unknown) => void)(key, t.checked);
    } else if (t instanceof HTMLSelectElement) {
      const v: unknown = key === 'sendRate' || key === 'fontSize' ? Number(t.value) : t.value;
      (setSetting as (k: keyof Settings, v: unknown) => void)(key, v);
    }
  });

  bodyEl.addEventListener('click', (ev) => {
    const t = (ev.target as HTMLElement).closest<HTMLElement>('[data-setting-action]');
    if (!t) return;
    if (t.dataset.settingAction === 'reset') {
      resetSettings();
      render();
    }
  });

  render();
}

// ─── HTML helpers ────────────────────────────────────────────────────────────

/** A heading between groups of rows. Plain text, no control. */
function section(title: string): string {
  return `<h3 class="settings-section">${escapeHtml(title)}</h3>`;
}

interface Row {
  key: keyof Settings;
  label: string;
  hint: string;
  control: string;
}
function row(r: Row): string {
  return `
    <div class="setting-row">
      <div class="setting-row-main">
        <label class="setting-label" for="setting-${r.key}">${r.label}</label>
        ${r.control}
      </div>
      <div class="setting-hint">${escapeHtml(r.hint)}</div>
    </div>
  `;
}

function toggle(key: string, value: boolean): string {
  return `
    <label class="setting-toggle">
      <input type="checkbox" id="setting-${key}" data-setting-key="${key}" ${value ? 'checked' : ''}>
      <span class="setting-toggle-thumb"></span>
    </label>
  `;
}

function select(key: string, value: string, options: { value: string; label: string }[]): string {
  const opts = options.map((o) =>
    `<option value="${escapeHtml(o.value)}"${o.value === value ? ' selected' : ''}>${escapeHtml(o.label)}</option>`,
  ).join('');
  return `
    <select class="setting-select" id="setting-${key}" data-setting-key="${key}">${opts}</select>
  `;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
