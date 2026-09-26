/**
 * The log, in the app.
 *
 * gobo hands `console` to the scene sandbox, so a scene can print — and until
 * now the only place that went was the browser's devtools. That is a fine
 * answer while you are building something and a bad one at a gig, where the
 * laptop is on a road case, the room is dark, and opening devtools over the
 * top of the editor costs the half of the screen you are working in.
 *
 * It also holds what the status bar cannot. The bar shows one line and the
 * newest thing wins, so a pattern that threw four bars ago is gone by the time
 * anyone looks up. This keeps the last few hundred and timestamps them.
 *
 * The real console still gets everything: this wraps rather than replaces, so
 * devtools stays exactly as useful as it was.
 */

import { PANEL_OPEN_EVENT } from './panel.js';

/** What kind of line this is, which decides how it is coloured. */
export type LogKind = 'log' | 'warn' | 'error';

export interface LogEntry {
  /** Wall clock, for the timestamp column. */
  at: number;
  kind: LogKind;
  text: string;
  /** How many times this identical line has repeated, collapsed into one row. */
  count: number;
}

/**
 * How many lines to keep.
 *
 * A pattern throwing on every tick can produce 40 lines a second, and the
 * collapse below turns that into one row with a count, so this is not a
 * per-second budget. It is how far back you can look, and a few hundred covers
 * the last song.
 */
const MAX_ENTRIES = 300;

const _entries: LogEntry[] = [];
const _listeners = new Set<() => void>();

export function onLogChange(fn: () => void): void {
  _listeners.add(fn);
}

export function getLog(): readonly LogEntry[] {
  return _entries;
}

export function clearLog(): void {
  _entries.length = 0;
  for (const fn of _listeners) fn();
}

/**
 * Record one line.
 *
 * An identical line repeated bumps a count instead of adding a row. A scene
 * that logs inside a pattern body runs that line at frame rate, and without
 * this the panel is a thousand copies of one message and nothing else.
 */
export function addLog(kind: LogKind, text: string): void {
  const last = _entries[_entries.length - 1];
  if (last && last.kind === kind && last.text === text) {
    last.count++;
    last.at = Date.now();
  } else {
    _entries.push({ at: Date.now(), kind, text, count: 1 });
    if (_entries.length > MAX_ENTRIES) _entries.splice(0, _entries.length - MAX_ENTRIES);
  }
  for (const fn of _listeners) fn();
}

/** Render one console argument the way a person would want to read it. */
function present(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.message;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    // A circular object, or a throwing getter on something a scene built.
    return String(value);
  }
}

/**
 * Apply console format directives, the way devtools would.
 *
 * Without this the panel shows a library's styled banner as the raw thing:
 * "%c🌀 @strudel/core loaded 🌀 background-color: black;color:white", CSS and
 * all. The real console reads %c as "style what follows with the next
 * argument"; there is no styling to do here, so the directive and its CSS are
 * dropped and the text is left.
 *
 * Only run when the first argument is a string that actually carries a
 * directive, so ordinary calls keep going through untouched.
 */
export function formatArgs(args: unknown[]): string {
  const first = args[0];
  if (typeof first !== 'string' || !/%[sdifoOcj%]/.test(first)) {
    return args.map(present).join(' ');
  }
  let i = 1;
  const text = first.replace(/%([sdifoOcj%])/g, (_whole, kind: string) => {
    if (kind === '%') return '%';
    if (i >= args.length) return `%${kind}`;   // nothing left to consume
    const value = args[i++];
    if (kind === 'c') return '';               // a style, and nothing to style
    if (kind === 'd' || kind === 'i') return String(Math.trunc(Number(value)));
    if (kind === 'f') return String(Number(value));
    return present(value);
  });
  // Anything the directives did not consume still belongs in the line.
  const rest = args.slice(i).map(present);
  return [text, ...rest].join(' ').trim();
}

let _captured = false;

/**
 * Start recording what goes to the console.
 *
 * Wraps rather than replaces: every call is still forwarded, so devtools shows
 * exactly what it showed before. Guarded against being called twice, which
 * would wrap the wrapper and double every line.
 */
export function captureConsole(): void {
  if (_captured) return;
  _captured = true;
  for (const kind of ['log', 'warn', 'error'] as const) {
    const original = console[kind].bind(console);
    console[kind] = (...args: unknown[]): void => {
      original(...args);
      try {
        addLog(kind, formatArgs(args));
      } catch {
        // Recording a line must never be the reason a scene fails. The real
        // console already has it.
      }
    };
  }
}

// ─── Panel ───────────────────────────────────────────────────────────────────

/** One clock time, to the second. Enough to tell two songs apart. */
function stamp(at: number): string {
  const d = new Date(at);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function mountConsolePanel(opts: {
  bodyEl: HTMLElement;
  /** Whether this page is the one currently on screen. */
  isOpen: () => boolean;
  /**
   * Open a bug report with the setup filled in. Here because the log is where
   * someone is standing when something has gone wrong, and it is what the
   * report will ask them to paste.
   */
  onReport?: () => void;
}): { refresh: () => void } {
  const { bodyEl, isOpen, onReport } = opts;

  bodyEl.innerHTML = `
    <div class="log-toolbar">
      ${onReport ? '<button type="button" class="log-report" id="log-report" title="open a bug report with your versions filled in">report a problem</button>' : ''}
      <button type="button" class="log-clear" id="log-clear">clear</button>
    </div>
    <div class="log-list" id="log-list"></div>
  `;
  const listEl = bodyEl.querySelector('#log-list') as HTMLElement;
  (bodyEl.querySelector('#log-clear') as HTMLButtonElement).addEventListener('click', clearLog);
  if (onReport) (bodyEl.querySelector('#log-report') as HTMLButtonElement).addEventListener('click', onReport);

  function refresh(): void {
    // Only while it is on screen. This is called on every line, and a scene
    // logging inside a pattern body calls it at frame rate.
    if (!isOpen()) return;
    const entries = getLog();
    if (entries.length === 0) {
      listEl.innerHTML = '<p class="log-empty">Nothing logged yet. A scene can write here with console.log(), '
        + 'and anything that goes wrong while a pattern runs lands here too.</p>';
      return;
    }
    // Newest last, the way a console reads, and pinned to the bottom below.
    listEl.innerHTML = entries.map((e) => {
      const repeat = e.count > 1 ? `<span class="log-count">×${e.count}</span>` : '';
      return `<div class="log-row log-${e.kind}">`
        + `<span class="log-time">${stamp(e.at)}</span>`
        + `<span class="log-text">${escapeHtml(e.text)}</span>${repeat}`
        + '</div>';
    }).join('');
    listEl.scrollTop = listEl.scrollHeight;
  }

  onLogChange(refresh);

  // Everything logged while the page was hidden was skipped by the guard
  // above, so it is drawn the moment the page comes into view.
  bodyEl.addEventListener(PANEL_OPEN_EVENT, refresh);

  return { refresh };
}
