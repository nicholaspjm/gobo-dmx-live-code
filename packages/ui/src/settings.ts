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

import { THEMES, THEME_LIST, THEME_GROUPS, LEGACY_THEME_IDS, type ThemeId } from './themes.js';
import { PANEL_OPEN_EVENT } from './panel.js';
import { migrateLegacyKey } from './storage-migration.js';

const STORAGE_KEY = 'gobo-settings-v1';

// `lumen-settings-v1` is the legacy name of this blob. Adopt it before the
// first read so an existing user keeps their theme, send rate and stop
// action. See storage-migration.ts.
migrateLegacyKey(STORAGE_KEY, 'lumen-settings-v1');

/** Behaviour when the user presses the stop key (Ctrl+. / Ctrl+Space).
 *  - 'blackout' wipes the universe buffers and turns every fixture off.
 *  - 'freeze'   leaves the last frame on the output buffers, so sim and
 *               hardware hold their colour until the next eval. */
export type StopAction = 'blackout' | 'freeze';

/** Maximum send rate to the bridge in Hz. Lower rates save bandwidth on
 *  wireless rigs; see `Settings.sendRate` for the ceiling. */
export type SendRate = 25 | 30 | 40 | 44;

/**
 * Editor type size, in pixels.
 *
 * The top end goes past a text editor's usual range because this is read in
 * a dark room, over someone's shoulder, and sometimes off a projector at the
 * back of a venue. 13 is for working on a laptop, 24 is for reading it from
 * the desk.
 */
export type FontSize = 11 | 13 | 15 | 18 | 21 | 24;

/**
 * Legacy rates (60 and 120 Hz), mapped to the nearest supported value. Left
 * as they are, the select could not show them and the next write would reset
 * the setting to the default without saying so.
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
  /** Active colour theme. Default 'tungsten' (warm brown; legacy id
   *  'ember', see resolveThemeId()). */
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
   *  The mode is a single toggle and these choose what it hides. Someone
   *  projecting the screen wants only the code; someone in a booth may want to
   *  keep the sim. All default true except the cue bar and the black
   *  background, which changes what the code sits on and is opt-in. */
  zenHideChrome: boolean;
  zenHideSim: boolean;
  zenHideLevels: boolean;
  zenHideCues: boolean;
  /** Minimal view hides the status bar along the bottom. Default true. */
  zenHideStatus: boolean;
  /** Drop the page background to black behind the code. Default false. */
  zenBlackBackground: boolean;
  /** The page on true black under any dark theme, all the time. Default false. */
  blackBackground: boolean;

  // ── Editor ─────────────────────────────────────────────────────────────
  // Editor habits are personal (whether brackets close themselves, say), so
  // each one is a switch. Each maps to a CodeMirror extension held in a
  // compartment (editor.ts), so a change takes effect while a scene is
  // running, without a reload.
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
   *  Default true. */
  eventHighlight: boolean;
  /** Cmd/Ctrl+click for a second cursor. Default true. */
  multiCursor: boolean;
  /** Ctrl+Enter runs the block around the cursor and Ctrl+Shift+Enter runs
   *  the whole document (the two chords swap). Default false, because the
   *  whole document is the safer meaning for the main chord. */
  blockEval: boolean;
  /** Flash the editor when a run lands. Default true, because the status bar
   *  is at the bottom of the window and the eyes are on the code. */
  flashOnRun: boolean;
  /** CSS transitions and animations across the app. Off is for a slow
   *  machine, or for anyone who does not want motion. Default true. */
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
  zenHideStatus: true,
  zenBlackBackground: false,
  blackBackground: false,
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
 * Resolve a persisted theme id to one that exists.
 *
 * A stored value can be a legacy id (ember for tungsten, slate for moonbox,
 * and so on; see LEGACY_THEME_IDS). applyTheme() falls back to the default
 * for an id it does not know, so without this mapping a user with a legacy
 * id would lose their choice without being told.
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
 * Legacy names of the five zen-mode switches (`perf*`, from when the mode was
 * called the performance view).
 *
 * The merge below drops a key it does not know, so a stored value under a
 * legacy name would be replaced by the default with nothing on screen to say
 * so. These are adopted on read and written back, so storage holds the
 * current spelling and does not depend on this map being kept.
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

/** A media query the browser answers, or false where there is no browser. */
function prefers(query: string): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia(query).matches;
  } catch {
    return false;
  }
}

/** Merge persisted values over defaults. Unknown keys are dropped and
 *  missing ones inherit defaults. Cached for fast repeat reads. */
export function getSettings(): Settings {
  if (_cached) return _cached;
  const raw = readRaw();
  const adopted = adoptRenamedKeys(raw as Record<string, unknown>);
  // Only current keys are carried over. A plain spread would keep everything
  // else in the blob and write it back out, so a legacy spelling would stay
  // in storage for good.
  const merged: Settings = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS) as (keyof Settings)[]) {
    if (key in raw) (merged as unknown as Record<string, unknown>)[key] = (raw as Record<string, unknown>)[key];
  }
  Object.assign(merged, adopted);
  merged.theme = resolveThemeId(raw.theme) ?? DEFAULTS.theme;
  // OS preferences fill in anything the user has not chosen here: reduced
  // motion turns the animations off, and more contrast starts on a
  // high-contrast theme. A choice made in settings always wins, and nothing
  // is written until the user makes one.
  if (!('animations' in raw) && prefers('(prefers-reduced-motion: reduce)')) merged.animations = false;
  if (raw.theme === undefined && prefers('(prefers-contrast: more)')) {
    merged.theme = prefers('(prefers-color-scheme: light)') ? 'contrastLight' : 'contrastDark';
  }
  // Legacy 60 and 120 Hz values, both above what DMX can carry.
  merged.sendRate = LEGACY_SEND_RATES[merged.sendRate as number] ?? merged.sendRate;
  _cached = merged;
  // Write adopted values straight back. Settings are otherwise persisted
  // only when the user changes one, so a legacy id would stay in storage and
  // be lost once LEGACY_THEME_IDS is retired. Guarded on an actual change so
  // a first run (no stored theme at all) doesn't write.
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

  // Redrawn each time it comes into view, because a setting can change
  // elsewhere (the zen-key adoption on first read, a reset) and a stale
  // toggle would show the wrong state.
  bodyEl.addEventListener(PANEL_OPEN_EVENT, () => render());

  function render(): void {
    const s = getSettings();
    // Each row is label, control, hint: a string template plus a couple of
    // delegated listeners, no framework. Rows are grouped under headings by
    // what they affect; one flat list of this many switches is too long to
    // scan.
    bodyEl.innerHTML = `
      <div class="settings-list">
        ${section('style')}
        ${row({
          key: 'theme',
          label: 'theme',
          hint: 'colour scheme for the editor and ui chrome. takes effect immediately.',
          control: themeSelect(s.theme),
        })}
        ${row({
          key: 'blackBackground',
          label: 'black background',
          hint: 'true black page under any dark theme. lights drawn on screen keep their colours, and light themes are unchanged.',
          control: toggle('blackBackground', s.blackBackground),
        })}
        ${row({
          key: 'fontSize',
          label: 'text size',
          hint: 'size of the code. the large sizes are for a dark room or a projector.',
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
          hint: 'slide, fade and colour transitions across the app. turn off for a slow machine, or to stop the motion.',
          control: toggle('animations', s.animations),
        })}

        ${section('editor')}
        ${row({
          key: 'lineNumbers',
          label: 'line numbers',
          hint: 'numbers in the left gutter. errors report the line they came from.',
          control: toggle('lineNumbers', s.lineNumbers),
        })}
        ${row({
          key: 'activeLine',
          label: 'active line',
          hint: 'tints the line the cursor is on.',
          control: toggle('activeLine', s.activeLine),
        })}
        ${row({
          key: 'lineWrapping',
          label: 'line wrapping',
          hint: 'off: a long chain runs off the right edge and scrolls. on: it folds onto the next line, and the line numbers no longer match the lines you see.',
          control: toggle('lineWrapping', s.lineWrapping),
        })}
        ${row({
          key: 'bracketMatching',
          label: 'bracket matching',
          hint: 'highlights the bracket paired with the one beside the cursor.',
          control: toggle('bracketMatching', s.bracketMatching),
        })}
        ${row({
          key: 'closeBrackets',
          label: 'auto-close brackets',
          hint: 'typing ( inserts () with the cursor inside. typing the closing bracket steps over it.',
          control: toggle('closeBrackets', s.closeBrackets),
        })}
        ${row({
          key: 'multiCursor',
          label: 'multiple cursors',
          hint: 'cmd/ctrl+click adds a cursor, and typing goes to all of them. for making the same change on several lights at once.',
          control: toggle('multiCursor', s.multiCursor),
        })}
        ${row({
          key: 'autocomplete',
          label: 'autocomplete',
          hint: 'popup that offers function and channel names as you type. enter or tab accepts.',
          control: toggle('autocomplete', s.autocomplete),
        })}
        ${row({
          key: 'hoverHelp',
          label: 'hover help',
          hint: 'hover a function name to see what it does and what it takes.',
          control: toggle('hoverHelp', s.hoverHelp),
        })}

        ${section('running')}
        ${row({
          key: 'blockEval',
          label: 'block on ctrl+enter',
          hint: 'off: ctrl+enter runs the whole document and ctrl+shift+enter runs the block around the cursor. on: the two swap. off by default, because running the whole document cannot leave half a scene running.',
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
          hint: 'a brief flash across the editor when a run lands. the status bar reports it too, but it sits at the bottom of the window.',
          control: toggle('flashOnRun', s.flashOnRun),
        })}
        ${row({
          key: 'formatOnRun',
          label: 'format on run',
          hint: 'reformat the buffer with prettier each time you press ctrl+enter. ctrl+shift+f formats on demand.',
          control: toggle('formatOnRun', s.formatOnRun),
        })}
        ${row({
          key: 'autosave',
          label: 'autosave',
          hint: 'saves every edit to the browser after 500 ms idle. off still saves when the tab closes, so a crash loses only the edits from this session. to keep a copy outside this browser, use share.',
          control: toggle('autosave', s.autosave),
        })}

        ${section('monitoring')}
        ${row({
          key: 'eventHighlight',
          label: 'live outlines',
          hint: 'outlines the mini-notation token that is driving light right now.',
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
          hint: 'hover a fixture in the sim panel to see its DMX values.',
          control: toggle('simTooltips', s.simTooltips),
        })}
        ${row({
          key: 'sendRate',
          label: 'send rate',
          hint: 'maximum connector updates per second. DMX carries about 44, so 40 is the practical ceiling. lower it for wireless rigs.',
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
          label: 'hide top bar',
          hint: 'these switches set what the minimal view hides (alt+m, the minimal view button, or a click on the mark). the top bar comes back while the pointer is at the top edge.',
          control: toggle('zenHideChrome', s.zenHideChrome),
        })}
        ${row({
          key: 'zenHideSim',
          label: 'hide sim',
          hint: 'the fixture simulation under the editor. when the level strip is also hidden, both come back while the pointer is on the status bar.',
          control: toggle('zenHideSim', s.zenHideSim),
        })}
        ${row({
          key: 'zenHideLevels',
          label: 'hide level strip',
          hint: 'the 512-bar channel strip at the bottom.',
          control: toggle('zenHideLevels', s.zenHideLevels),
        })}
        ${row({
          key: 'zenHideCues',
          label: 'hide cue bar',
          hint: 'off by default. the cue chips show which look is up, which helps on a projector.',
          control: toggle('zenHideCues', s.zenHideCues),
        })}
        ${row({
          key: 'zenHideStatus',
          label: 'hide status bar',
          hint: 'the line along the bottom. it comes back at the bottom edge, and by itself when a run fails.',
          control: toggle('zenHideStatus', s.zenHideStatus),
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
      // Booleans (every toggle). Cast through unknown
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
      // Every setting at once, with no undo, so it asks first.
      if (!window.confirm('Reset every setting to its default?')) return;
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

/** The theme list, under a heading per group. */
function themeSelect(value: string): string {
  const groups = THEME_GROUPS.map((g) => {
    const opts = THEME_LIST.filter((t) => (t.group ?? 'gobo') === g.id).map((t) =>
      `<option value="${escapeHtml(t.id)}"${t.id === value ? ' selected' : ''}>${escapeHtml(t.label)}</option>`,
    ).join('');
    return opts ? `<optgroup label="${escapeHtml(g.label)}">${opts}</optgroup>` : '';
  }).join('');
  return `
    <select class="setting-select" id="setting-theme" data-setting-key="theme">${groups}</select>
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
