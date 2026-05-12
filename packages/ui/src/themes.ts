/**
 * Colour theme presets.
 *
 * Each theme is a flat map of CSS custom-property values written onto
 * `:root` via `applyTheme()`. Everything visible — the page CSS, the
 * CodeMirror editor styles, the hover tooltip — reads these variables,
 * so swapping themes is a single function call with no editor rebuild.
 *
 * Themes share the same variable schema, which means we can also expose
 * `var(--accent)` etc. in user-facing places like the docs panel without
 * theme-specific code paths.
 *
 * Adding a theme: drop a new entry into THEMES, give it a name + 12
 * colours. The settings panel populates its dropdown from the keys
 * automatically.
 */

export type ThemeId =
  | 'ember'
  | 'slate'
  | 'forest'
  | 'midnight'
  | 'paper'
  | 'ikeda'
  | 'datamatrix'
  | 'terminal'
  | 'puredata';

/** The variables each theme must supply. Keep this small — every
 *  additional variable means every theme needs an update. */
export interface ThemeVars {
  bg: string;
  surface: string;
  border: string;
  text: string;
  textMuted: string;
  accent: string;
  accent2: string;
  sage: string;       // used for strings + a few accents in CM highlight
  error: string;
  selection: string;
  lineHighlight: string;
  cursor: string;
  /** Background of code-example blocks inside tooltips. Slightly darker
   *  than `surface` on dark themes; slightly lighter on light themes. */
  codeBg: string;
  /** Selection / bracket-match background for the editor — needs slightly
   *  more contrast than `selection` for dark themes. */
  selectionBg: string;
}

/** Human-readable name + the variable values. */
export interface ThemeDef {
  id: ThemeId;
  label: string;
  vars: ThemeVars;
}

export const THEMES: Record<ThemeId, ThemeDef> = {
  // The original warm-brown theme — kept as default so existing users
  // see no visible change after this lands.
  ember: {
    id: 'ember',
    label: 'ember (default)',
    vars: {
      bg: '#1a1714',
      surface: '#211e1b',
      border: '#2e2a26',
      text: '#e8dfd0',
      textMuted: '#8a8078',
      accent: '#c4724a',
      accent2: '#b8956a',
      sage: '#7a8c6e',
      error: '#c45a5a',
      selection: '#2e2a2680',
      lineHighlight: '#211e1b88',
      cursor: '#c4724a',
      codeBg: '#1e1b18',
      selectionBg: '#3a342e',
    },
  },
  // Cool blue/grey — easier on the eyes for long sessions.
  slate: {
    id: 'slate',
    label: 'slate',
    vars: {
      bg: '#16181c',
      surface: '#1d2026',
      border: '#2c3038',
      text: '#d8dde6',
      textMuted: '#7a8190',
      accent: '#6aa9d8',
      accent2: '#94b8d1',
      sage: '#7ab5a6',
      error: '#d65a6a',
      selection: '#2c303880',
      lineHighlight: '#1d202688',
      cursor: '#6aa9d8',
      codeBg: '#1a1d22',
      selectionBg: '#2f3640',
    },
  },
  // Deep green with mint accents — feels organic without going too far.
  forest: {
    id: 'forest',
    label: 'forest',
    vars: {
      bg: '#141815',
      surface: '#1a1f1c',
      border: '#283028',
      text: '#d8e0d2',
      textMuted: '#7a8a7a',
      accent: '#6abe7a',
      accent2: '#a5c490',
      sage: '#b8a868',
      error: '#c46a5a',
      selection: '#28302880',
      lineHighlight: '#1a1f1c88',
      cursor: '#6abe7a',
      codeBg: '#171c18',
      selectionBg: '#2c382e',
    },
  },
  // Deep blue/violet — high contrast, slightly synthwave.
  midnight: {
    id: 'midnight',
    label: 'midnight',
    vars: {
      bg: '#15131c',
      surface: '#1c1929',
      border: '#2a253a',
      text: '#ddd8e8',
      textMuted: '#88809a',
      accent: '#b07ad8',
      accent2: '#d8a5c0',
      sage: '#7ab5b0',
      error: '#d65a6a',
      selection: '#2a253a80',
      lineHighlight: '#1c192988',
      cursor: '#b07ad8',
      codeBg: '#181522',
      selectionBg: '#332a45',
    },
  },
  // Light theme — warm cream, useful for sunlit rooms / projection.
  paper: {
    id: 'paper',
    label: 'paper (light)',
    vars: {
      bg: '#f4eede',
      surface: '#ebe3ce',
      border: '#d4c8af',
      text: '#2a241c',
      textMuted: '#6a6253',
      accent: '#a85a30',
      accent2: '#8a7048',
      sage: '#5a7050',
      error: '#b04040',
      selection: '#d4c8afa0',
      lineHighlight: '#ebe3ce88',
      cursor: '#a85a30',
      codeBg: '#e0d6bc',
      selectionBg: '#d4c8af',
    },
  },
  // Ryoji Ikeda · data.matrix aesthetic — pure black, stark white text,
  // a single saturated red as the only colour. Strings get a signal
  // green so syntax still parses visually, but the palette overall is
  // monochrome by design.
  ikeda: {
    id: 'ikeda',
    label: 'ikeda',
    vars: {
      bg: '#000000',
      surface: '#070707',
      border: '#1a1a1a',
      text: '#ffffff',
      textMuted: '#888888',
      accent: '#ff0033',
      accent2: '#ffffff',
      sage: '#00ff66',
      error: '#ff3344',
      selection: '#ff003322',
      lineHighlight: '#ffffff08',
      cursor: '#ff0033',
      codeBg: '#040404',
      selectionBg: '#1f1f1f',
    },
  },
  // Phosphor green-on-black terminal — Ikeda's data.tron, surveillance
  // monitor aesthetic, late-90s GUI screensavers. Everything is one
  // colour with intensity variations.
  datamatrix: {
    id: 'datamatrix',
    label: 'datamatrix',
    vars: {
      bg: '#000000',
      surface: '#050807',
      border: '#143218',
      text: '#c8ffd0',
      textMuted: '#4a7050',
      accent: '#00ff66',
      accent2: '#66ff99',
      sage: '#00cc88',
      error: '#ff5566',
      selection: '#00ff662e',
      lineHighlight: '#00ff660c',
      cursor: '#00ff66',
      codeBg: '#030504',
      selectionBg: '#103018',
    },
  },
  // Amber CRT — warm phosphor terminal, the OG live-coding aesthetic.
  // Higher comfort than datamatrix for long sessions; reads more like
  // an old oscilloscope than a Matrix shell.
  terminal: {
    id: 'terminal',
    label: 'terminal',
    vars: {
      bg: '#0a0500',
      surface: '#14100a',
      border: '#2a200a',
      text: '#ffb83d',
      textMuted: '#886030',
      accent: '#ffc966',
      accent2: '#ff9933',
      sage: '#e8a548',
      error: '#ff5538',
      selection: '#ffb83d2e',
      lineHighlight: '#ffb83d0c',
      cursor: '#ffb83d',
      codeBg: '#050300',
      selectionBg: '#2e2310',
    },
  },
  // Pure Data vanilla — the classic gray-on-gray patcher look. Cable
  // blue and box-border orange as accents; messages in dark green.
  // Light theme, so a little harder to live-code in low light, but
  // perfect for the Pd-style demo aesthetic.
  puredata: {
    id: 'puredata',
    label: 'puredata (light)',
    vars: {
      bg: '#f0f0f0',
      surface: '#e0e0e0',
      border: '#909090',
      text: '#000000',
      textMuted: '#555555',
      accent: '#0066cc',
      accent2: '#cc6600',
      sage: '#007030',
      error: '#cc0000',
      selection: '#c8d8e8',
      lineHighlight: '#e8e8e8',
      cursor: '#0066cc',
      codeBg: '#d8d8d8',
      selectionBg: '#c8d8e8',
    },
  },
};

/**
 * Concrete colour values for the active theme. Mutable so canvas consumers
 * (the visualizer) can keep a stable reference and just re-read it after
 * a theme change — no observer plumbing needed. Mirrors the CSS variables
 * for code that can't use them (canvas 2D context only accepts hex/rgb,
 * not `var()` references).
 */
export const COLORS: ThemeVars = { ...THEMES.ember.vars };

/** Write a theme's variables onto `:root` so all `var(--...)` lookups
 *  pick them up, and refresh the shared COLORS object for canvas/JS
 *  consumers. Idempotent. */
export function applyTheme(id: ThemeId): void {
  const t = THEMES[id] ?? THEMES.ember;
  const root = document.documentElement;
  // Map camelCase → kebab-case so the CSS variable names stay readable
  // (--text-muted, not --textMuted).
  for (const [key, value] of Object.entries(t.vars)) {
    const cssName = '--' + key.replace(/([A-Z])/g, '-$1').toLowerCase();
    root.style.setProperty(cssName, value);
  }
  // A boolean attribute on <html> lets CSS make tiny per-theme tweaks
  // without inventing a new variable for every nuance.
  root.setAttribute('data-theme', id);
  // Re-sync the shared colour bag for canvas/JS consumers.
  Object.assign(COLORS, t.vars);
}

/** Stable list for dropdowns (preserves insertion order of THEMES). */
export const THEME_LIST: ThemeDef[] = Object.values(THEMES);
