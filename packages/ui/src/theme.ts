/**
 * Earth-tone CodeMirror 6 theme for lumen.
 */

import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

export const COLORS = {
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
};

export const lumenTheme = EditorView.theme(
  {
    '&': {
      backgroundColor: COLORS.bg,
      color: COLORS.text,
      height: '100%',
      fontSize: '13px',
    },
    '.cm-scroller': {
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Consolas', monospace",
      lineHeight: '1.7',
    },
    '.cm-content': {
      caretColor: COLORS.cursor,
      padding: '12px 0',
    },
    '.cm-cursor, .cm-dropCursor': {
      borderLeftColor: COLORS.cursor,
      borderLeftWidth: '2px',
    },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
      backgroundColor: '#3a342e',
    },
    '.cm-activeLine': {
      backgroundColor: COLORS.lineHighlight,
    },
    '.cm-activeLineGutter': {
      backgroundColor: COLORS.lineHighlight,
    },
    '.cm-gutters': {
      backgroundColor: COLORS.surface,
      color: COLORS.textMuted,
      border: 'none',
      borderRight: `1px solid ${COLORS.border}`,
    },
    '.cm-lineNumbers .cm-gutterElement': {
      padding: '0 10px 0 6px',
      minWidth: '32px',
    },
    '.cm-foldGutter .cm-gutterElement': {
      color: COLORS.textMuted,
    },
    '.cm-line': {
      padding: '0 16px',
    },
    '.cm-matchingBracket': {
      backgroundColor: '#3a342e',
      color: COLORS.accent2 + ' !important',
      outline: `1px solid ${COLORS.accent2}44`,
    },
    '.cm-tooltip': {
      backgroundColor: COLORS.surface,
      border: `1px solid ${COLORS.border}`,
      color: COLORS.text,
    },
    '.cm-tooltip-autocomplete ul li[aria-selected]': {
      backgroundColor: '#2e2a26',
    },
    '&.cm-focused .cm-cursor': {
      borderLeftColor: COLORS.cursor,
    },
    '.cm-searchMatch': {
      backgroundColor: '#c4724a33',
      outline: `1px solid ${COLORS.accent}66`,
    },
    '.cm-searchMatch.cm-searchMatch-selected': {
      backgroundColor: '#c4724a55',
    },
  },
  { dark: true },
);

export const lumenHighlight = syntaxHighlighting(
  HighlightStyle.define([
    { tag: t.comment, color: COLORS.textMuted, fontStyle: 'italic' },
    { tag: t.lineComment, color: COLORS.textMuted, fontStyle: 'italic' },
    { tag: t.blockComment, color: COLORS.textMuted, fontStyle: 'italic' },

    { tag: t.keyword, color: COLORS.accent },
    { tag: t.controlKeyword, color: COLORS.accent },
    { tag: t.operatorKeyword, color: COLORS.accent },

    { tag: t.string, color: COLORS.sage },
    { tag: t.regexp, color: COLORS.sage },

    { tag: t.number, color: COLORS.accent2 },
    { tag: t.bool, color: COLORS.accent2 },
    { tag: t.null, color: COLORS.textMuted },

    { tag: t.function(t.variableName), color: COLORS.accent2 },
    { tag: t.definition(t.variableName), color: COLORS.text },
    { tag: t.variableName, color: COLORS.text },

    { tag: t.propertyName, color: COLORS.text },
    { tag: t.definition(t.propertyName), color: COLORS.accent2 },

    { tag: t.operator, color: COLORS.textMuted },
    { tag: t.punctuation, color: COLORS.textMuted },
    { tag: t.separator, color: COLORS.textMuted },

    { tag: t.typeName, color: COLORS.accent2, fontStyle: 'italic' },
    { tag: t.className, color: COLORS.accent2 },

    { tag: t.invalid, color: COLORS.error, textDecoration: 'underline' },
  ]),
);
