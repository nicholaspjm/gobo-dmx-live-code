/**
 * User settings panel: small preferences persisted in localStorage.
 * Mounted as a sliding side-panel mirroring the docs / library panels.
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
  /** Format the editor buffer with prettier every time the code runs
   *  (Ctrl+Enter). Off by default, because rewriting the doc
   *  mid-performance moves the cursor anchor. */
  formatOnRun: boolean;
}

const DEFAULTS: Settings = {
  stopAction: 'blackout',
  autosave: true,
  inlineViz: true,
  simTooltips: true,
  sendRate: 40,
  theme: 'tungsten',
  formatOnRun: false,
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

/** Merge persisted values over defaults. Unknown keys are dropped and
 *  missing ones inherit defaults. Cached for fast repeat reads. */
export function getSettings(): Settings {
  if (_cached) return _cached;
  const raw = readRaw();
  const merged: Settings = { ...DEFAULTS, ...raw };
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
    || (raw.sendRate !== undefined && raw.sendRate !== merged.sendRate)) writeRaw(merged);
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

/** Mount the settings panel. Returns { setOpen } so the host can drive
 *  open/close from outside (used by the mutual-exclusion logic that
 *  shuts the other panels when this one opens). */
export function mountSettingsPanel(opts: {
  panelEl: HTMLElement;
  bodyEl: HTMLElement;
  toggleEl: HTMLButtonElement;
  closeEl: HTMLButtonElement;
  /** Called whenever the user opens the panel. The host uses this to
   *  close the other sliding panels for mutual exclusion. */
  onOpen?: () => void;
}): { setOpen: (open: boolean) => void; isOpen: () => boolean } {
  const { panelEl, bodyEl, toggleEl, closeEl, onOpen } = opts;

  function setOpen(open: boolean): void {
    panelEl.classList.toggle('open', open);
    panelEl.setAttribute('aria-hidden', open ? 'false' : 'true');
    toggleEl.classList.toggle('active', open);
    if (open) {
      render();
      onOpen?.();
    }
  }
  function isOpen(): boolean { return panelEl.classList.contains('open'); }

  toggleEl.addEventListener('click', () => setOpen(!isOpen()));
  closeEl.addEventListener('click', () => setOpen(false));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen()) setOpen(false);
  });

  function render(): void {
    const s = getSettings();
    // Each section is a definition list-shaped row: label, control, hint.
    // A string template plus a couple of delegated listeners, no framework.
    bodyEl.innerHTML = `
      <div class="settings-list">
        ${row({
          key: 'theme',
          label: 'theme',
          hint: 'colour scheme for the editor and ui chrome. takes effect immediately.',
          control: select('theme', s.theme, THEME_LIST.map((t) => ({ value: t.id, label: t.label }))),
        })}
        ${row({
          key: 'stopAction',
          label: 'stop action',
          hint: 'what ctrl+. / ctrl+space does. blackout zeroes all channels; freeze leaves the last frame on outputs.',
          control: select('stopAction', s.stopAction, [
            { value: 'blackout', label: 'blackout (default)' },
            { value: 'freeze',   label: 'freeze last frame' },
          ]),
        })}
        ${row({
          key: 'autosave',
          label: 'autosave',
          hint: 'persist every edit to the active scene after a 500ms idle. off means you save manually with ctrl+s.',
          control: toggle('autosave', s.autosave),
        })}
        ${row({
          key: 'formatOnRun',
          label: 'format on run',
          hint: 'reformat the buffer with prettier each time you press ctrl+enter. ctrl+shift+f is the manual trigger.',
          control: toggle('formatOnRun', s.formatOnRun),
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
      const v: unknown = key === 'sendRate' ? Number(t.value) : t.value;
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

  return { setOpen, isOpen };
}

// ─── HTML helpers ────────────────────────────────────────────────────────────

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
