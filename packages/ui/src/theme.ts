/**
 * CodeMirror 6 theme for gobo.
 *
 * All colours come from CSS custom properties so the active theme
 * (set via themes.ts → applyTheme()) propagates into the editor without
 * rebuilding the EditorView. These used to be JS constants, which meant
 * a rebuild on every switch.
 *
 * Two colour families are in play and are kept separate:
 *   - the chrome vars (--bg, --accent, --text-muted …) style the editor
 *     surface: gutters, cursor, selection, tooltips.
 *   - the syntax vars (--syn-*) style the code itself. goboHighlight
 *     below owns the base-JavaScript half of that (keywords, numbers,
 *     strings, comments, operators); the regex ViewPlugin in
 *     code-highlight.ts owns the gobo-specific half.
 * Base JS used to borrow --accent / --accent2 / --sage / --text-muted,
 * putting it in competition with the gobo tokens for the same three
 * colours. It has its own vars now.
 */

import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

// Re-exported so existing `import { COLORS } from './theme.js'` callers
// (notably visualizer.ts) keep working after the move to themes.ts.
export { COLORS } from './themes.js';

/** Shorthand for `var(--x)` so the style object stays readable. */
const v = (name: string): string => `var(--${name})`;

export const goboTheme = EditorView.theme(
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
    '.cm-tooltip .gobo-hover-help': {
      maxWidth: '440px',
      padding: '8px 10px',
      lineHeight: '1.4',
      fontSize: '12.5px',
    },
    '.cm-tooltip .gobo-hover-help-sig': {
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      color: v('accent2'),
      fontSize: '12.5px',
      marginBottom: '4px',
    },
    '.cm-tooltip .gobo-hover-help-desc': {
      color: v('text'),
      marginBottom: '6px',
      whiteSpace: 'normal',
    },
    '.cm-tooltip .gobo-hover-help-ex-label': {
      color: v('text-muted'),
      fontSize: '10.5px',
      letterSpacing: '0.08em',
      textTransform: 'uppercase',
      marginBottom: '2px',
    },
    '.cm-tooltip .gobo-hover-help-ex': {
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
    // What a declared light responds to. Wraps, and capped in height so a
    // fixture with forty channels cannot push the card off the screen.
    '.cm-tooltip .gobo-hover-help-cmds': {
      display: 'flex',
      flexWrap: 'wrap',
      gap: '3px',
      maxHeight: '104px',
      overflowY: 'auto',
    },
    '.cm-tooltip .gobo-hover-help-cmd': {
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: '11px',
      padding: '1px 5px',
      borderRadius: '2px',
      backgroundColor: v('code-bg'),
      color: v('text'),
    },
    // ── Completion info panel ─────────────────────────────────────────
    '.cm-tooltip .gobo-completion-info': {
      maxWidth: '360px',
      padding: '6px 8px',
      lineHeight: '1.4',
    },
    '.cm-tooltip .gobo-completion-info-desc': {
      marginBottom: '5px',
    },
    '.cm-tooltip .gobo-completion-info-ex-label': {
      color: v('text-muted'),
      fontSize: '10.5px',
      letterSpacing: '0.08em',
      textTransform: 'uppercase',
      marginBottom: '2px',
    },
    '.cm-tooltip .gobo-completion-info-ex': {
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
  // for anything we don't override. That leaves light themes slightly off,
  // but the overrides above cover nearly every visible colour, so the
  // difference is small.
  { dark: true },
);

export const goboHighlight = syntaxHighlighting(
  HighlightStyle.define([
    // Comments are the lowest-chroma colour in every palette so they
    // recede, but --syn-comment is still solved to >= 4.5:1 rather than
    // the usual near-invisible grey. They used to take --text-muted,
    // which on some themes fails contrast against --bg.
    { tag: t.comment, color: v('syn-comment'), fontStyle: 'italic' },
    { tag: t.lineComment, color: v('syn-comment'), fontStyle: 'italic' },
    { tag: t.blockComment, color: v('syn-comment'), fontStyle: 'italic' },
    { tag: t.docComment, color: v('syn-comment'), fontStyle: 'italic' },

    // --syn-keyword is the --syn-factory hue at roughly half the chroma,
    // because `const wash = fixture(…)` is one gesture: the binding word
    // and the factory call belong to the same family, with the factory
    // carrying the emphasis. `this`, booleans and null are keywords in
    // the same sense: fixed words of the language, not values you tune.
    { tag: t.keyword, color: v('syn-keyword') },
    { tag: t.controlKeyword, color: v('syn-keyword') },
    { tag: t.operatorKeyword, color: v('syn-keyword') },
    { tag: t.definitionKeyword, color: v('syn-keyword') },
    { tag: t.moduleKeyword, color: v('syn-keyword') },
    { tag: t.self, color: v('syn-keyword') },
    { tag: t.bool, color: v('syn-keyword') },
    { tag: t.null, color: v('syn-keyword') },

    // Strings are fixture ids and mini-notation, so they sit next to the
    // pattern hue. Replaces --sage, which the gobo tokens now need.
    { tag: t.string, color: v('syn-string') },
    { tag: t.special(t.string), color: v('syn-string') },
    { tag: t.regexp, color: v('syn-string') },

    // Numbers get a hue of their own rather than an accent: they are what
    // you nudge live, so they must stay findable without competing with
    // the verbs around them.
    { tag: t.number, color: v('syn-number') },
    { tag: t.integer, color: v('syn-number') },
    { tag: t.float, color: v('syn-number') },

    // Identifiers are the neutral ground the gobo marks are read against,
    // so they get no colour of their own. t.function(t.variableName) in
    // particular must stay --text: the ViewPlugin already paints every
    // call that means something to the rig, and leaving this rule on an
    // accent would paint user-defined helper calls the same colour as
    // fixture names.
    { tag: t.function(t.variableName), color: v('text') },
    { tag: t.definition(t.variableName), color: v('text') },
    { tag: t.variableName, color: v('text') },

    { tag: t.propertyName, color: v('text') },
    { tag: t.definition(t.propertyName), color: v('text') },

    // Structure you read past.
    { tag: t.operator, color: v('syn-operator') },
    { tag: t.punctuation, color: v('syn-operator') },
    { tag: t.separator, color: v('syn-operator') },
    { tag: t.bracket, color: v('syn-operator') },
    { tag: t.paren, color: v('syn-operator') },
    { tag: t.brace, color: v('syn-operator') },
    { tag: t.squareBracket, color: v('syn-operator') },

    // Type and class names are identifiers too, and rare in a live-coding
    // buffer, so they stay neutral. Not italic either: italic is reserved
    // for the inert tokens (viz, meta, comments).
    { tag: t.typeName, color: v('text') },
    { tag: t.className, color: v('text') },

    { tag: t.invalid, color: v('error'), textDecoration: 'underline' },
  ]),
);
