/**
 * CodeMirror 6 theme for lumen.
 *
 * All colours come from CSS custom properties so the active theme
 * (set via themes.ts → applyTheme()) propagates into the editor
 * without rebuilding the EditorView. Previously these were JS
 * constants — switching is now zero-cost.
 */

import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

// Re-exported so existing `import { COLORS } from './theme.js'` callers
// (notably visualizer.ts) keep working after the move to themes.ts.
export { COLORS } from './themes.js';

/** Shorthand for `var(--x)` so the style object stays readable. */
const v = (name: string): string => `var(--${name})`;

export const lumenTheme = EditorView.theme(
  {
    '&': {
      backgroundColor: v('bg'),
      color: v('text'),
      height: '100%',
      fontSize: '13px',
    },
    '.cm-scroller': {
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Consolas', monospace",
      lineHeight: '1.7',
    },
    '.cm-content': {
      caretColor: v('cursor'),
      padding: '12px 0',
    },
    '.cm-cursor, .cm-dropCursor': {
      borderLeftColor: v('cursor'),
      borderLeftWidth: '2px',
    },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
      backgroundColor: v('selection-bg'),
    },
    '.cm-activeLine': {
      backgroundColor: v('line-highlight'),
    },
    '.cm-activeLineGutter': {
      backgroundColor: v('line-highlight'),
    },
    '.cm-gutters': {
      backgroundColor: v('surface'),
      color: v('text-muted'),
      border: 'none',
      borderRight: `1px solid ${v('border')}`,
    },
    '.cm-lineNumbers .cm-gutterElement': {
      padding: '0 10px 0 6px',
      minWidth: '32px',
    },
    '.cm-foldGutter .cm-gutterElement': {
      color: v('text-muted'),
    },
    '.cm-line': {
      padding: '0 16px',
    },
    '.cm-matchingBracket': {
      backgroundColor: v('selection-bg'),
      color: `${v('accent2')} !important`,
      outline: `1px solid ${v('accent2')}`,
    },
    '.cm-tooltip': {
      backgroundColor: v('surface'),
      border: `1px solid ${v('border')}`,
      color: v('text'),
    },
    '.cm-tooltip-autocomplete ul li[aria-selected]': {
      backgroundColor: v('selection-bg'),
    },
    // ── Hover-help tooltip ─────────────────────────────────────────────
    '.cm-tooltip .lumen-hover-help': {
      maxWidth: '440px',
      padding: '8px 10px',
      lineHeight: '1.4',
      fontSize: '12.5px',
    },
    '.cm-tooltip .lumen-hover-help-sig': {
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      color: v('accent2'),
      fontSize: '12.5px',
      marginBottom: '4px',
    },
    '.cm-tooltip .lumen-hover-help-desc': {
      color: v('text'),
      marginBottom: '6px',
      whiteSpace: 'normal',
    },
    '.cm-tooltip .lumen-hover-help-ex-label': {
      color: v('text-muted'),
      fontSize: '10.5px',
      letterSpacing: '0.08em',
      textTransform: 'uppercase',
      marginBottom: '2px',
    },
    '.cm-tooltip .lumen-hover-help-ex': {
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: '12px',
      color: v('accent'),
      backgroundColor: v('code-bg'),
      padding: '6px 8px',
      borderRadius: '3px',
      margin: '0',
      whiteSpace: 'pre',
      overflow: 'auto',
    },
    // ── Completion info panel ─────────────────────────────────────────
    '.cm-tooltip .lumen-completion-info': {
      maxWidth: '360px',
      padding: '6px 8px',
      lineHeight: '1.4',
    },
    '.cm-tooltip .lumen-completion-info-desc': {
      marginBottom: '5px',
    },
    '.cm-tooltip .lumen-completion-info-ex-label': {
      color: v('text-muted'),
      fontSize: '10.5px',
      letterSpacing: '0.08em',
      textTransform: 'uppercase',
      marginBottom: '2px',
    },
    '.cm-tooltip .lumen-completion-info-ex': {
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: '11.5px',
      color: v('accent'),
      backgroundColor: v('code-bg'),
      padding: '5px 7px',
      borderRadius: '3px',
      margin: '0',
      whiteSpace: 'pre',
      overflow: 'auto',
    },
    '&.cm-focused .cm-cursor': {
      borderLeftColor: v('cursor'),
    },
    '.cm-searchMatch': {
      backgroundColor: `${v('accent')}33`,
      outline: `1px solid ${v('accent')}`,
    },
    '.cm-searchMatch.cm-searchMatch-selected': {
      backgroundColor: `${v('accent')}55`,
    },
  },
  // The `dark` flag tells CodeMirror to invert default colour calculations
  // for things we don't override. Light themes will look slightly off
  // because of this, but the override surface above covers nearly all
  // visible colours so the difference is minor and worth the simplicity.
  { dark: true },
);

export const lumenHighlight = syntaxHighlighting(
  HighlightStyle.define([
    { tag: t.comment, color: v('text-muted'), fontStyle: 'italic' },
    { tag: t.lineComment, color: v('text-muted'), fontStyle: 'italic' },
    { tag: t.blockComment, color: v('text-muted'), fontStyle: 'italic' },

    { tag: t.keyword, color: v('accent') },
    { tag: t.controlKeyword, color: v('accent') },
    { tag: t.operatorKeyword, color: v('accent') },

    { tag: t.string, color: v('sage') },
    { tag: t.regexp, color: v('sage') },

    { tag: t.number, color: v('accent2') },
    { tag: t.bool, color: v('accent2') },
    { tag: t.null, color: v('text-muted') },

    { tag: t.function(t.variableName), color: v('accent2') },
    { tag: t.definition(t.variableName), color: v('text') },
    { tag: t.variableName, color: v('text') },

    { tag: t.propertyName, color: v('text') },
    { tag: t.definition(t.propertyName), color: v('accent2') },

    { tag: t.operator, color: v('text-muted') },
    { tag: t.punctuation, color: v('text-muted') },
    { tag: t.separator, color: v('text-muted') },

    { tag: t.typeName, color: v('accent2'), fontStyle: 'italic' },
    { tag: t.className, color: v('accent2') },

    { tag: t.invalid, color: v('error'), textDecoration: 'underline' },
  ]),
);
