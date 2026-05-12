/**
 * User settings panel — small, durable preferences persisted in
 * localStorage. Mounted as a sliding side-panel mirroring the docs /
 * library panels.
 *
 * Each setting has:
 *   - a stable key in the persisted JSON blob
 *   - a default value applied on first run + when "reset" is clicked
 *   - a UI control (toggle or select)
 *   - (optional) an onChange callback the host wires in
 *
 * Settings are read synchronously via `getSettings()` so callers don't
 * need to subscribe; long-lived behaviour (e.g. autosave) reads the
 * current value at the point of decision rather than caching it.
 */

import { THEME_LIST, type ThemeId } from './themes.js';

const STORAGE_KEY = 'lumen-settings-v1';

/** Behaviour when the user presses the stop key (Ctrl+. / Ctrl+Space).
 *  - 'blackout' wipes the universe buffers and turns every fixture off.
 *  - 'freeze'   leaves the last frame on the output buffers, so sim and
 *               hardware hold their colour until the next eval. */
export type StopAction = 'blackout' | 'freeze';

/** Maximum send rate to the bridge in Hz. Higher = smoother, more network
 *  traffic. 60 is a safe default; 30 saves bandwidth for wireless rigs;
 *  120 is for local rigs running at high refresh. */
export type SendRate = 30 | 60 | 120;

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
  /** Maximum send rate to the bridge, in Hz. Default 60. */
  sendRate: SendRate;
  /** Active colour theme. Default 'ember' (the original warm-brown). */
  theme: ThemeId;
  /** Format the editor buffer with prettier every time the code runs
   *  (Ctrl+Enter). Off by default — opt-in because rewriting the doc
   *  mid-performance changes the cursor anchor and can be jarring. */
  formatOnRun: boolean;
}

const DEFAULTS: Settings = {
  stopAction: 'blackout',
  autosave: true,
  inlineViz: true,
  simTooltips: true,
  sendRate: 60,
  theme: 'ember',
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
    // Corrupt blob — fall through to defaults so a broken localStorage
    // entry can't brick the page. Next write fixes it.
  }
  return {};
}

function writeRaw(s: Settings): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch { /* quota / private mode */ }
}

/** Merge persisted values over defaults — unknown keys are dropped and
 *  missing ones inherit defaults. Cached for fast repeat reads. */
export function getSettings(): Settings {
  if (_cached) return _cached;
  const raw = readRaw();
  _cached = { ...DEFAULTS, ...raw };
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
  /** Called whenever the user opens the panel — host uses this to
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
    // Each section is a definition list-shaped row: label + control + hint.
    // No frameworks — vanilla string template + a couple delegated listeners.
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
          hint: 'cap on bridge updates per second. lower for wireless rigs, higher for local dev.',
          control: select('sendRate', String(s.sendRate), [
            { value: '30',  label: '30 Hz' },
            { value: '60',  label: '60 Hz (default)' },
            { value: '120', label: '120 Hz' },
          ]),
        })}
        <div class="settings-footer">
          <button type="button" class="settings-reset" data-setting-action="reset">reset all to defaults</button>
        </div>
      </div>
    `;
  }

  // Delegated change/click handlers — simpler than attaching to each control
  // and survives the innerHTML rebuild on every render().
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
