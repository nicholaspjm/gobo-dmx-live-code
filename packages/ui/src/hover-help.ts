/**
 * Editor hover-help: tooltip that shows signature + description + example
 * when the cursor lingers over a gobo API identifier.
 *
 * The data source is `help-data.ts`, shared with autocomplete so a single
 * edit updates both surfaces.
 *
 * Names the user bound themselves are handled too: `wash` in
 * `const wash = fixture(1, 'rgb')` is the name they actually think in, and it
 * used to be the one identifier on the line with nothing to say. Its
 * declaration is read out of the buffer (see declared-lights.ts) so the
 * tooltip can list the channels that fixture has. Anything that is neither
 * yields nothing rather than a "no info" tooltip.
 *
 * Word boundary detection is ECMAScript-identifier shaped (it matches
 * /[A-Za-z_$][\w$]+/) so it ignores punctuation and whitespace. Mousing
 * over `(` or `.` does not pop a tooltip.
 */

import { hoverTooltip, type Tooltip } from '@codemirror/view';
import type { EditorView } from '@codemirror/view';
import { HELP_INDEX, type HelpEntry } from './help-data.js';
import { describeLight, findLight, type LightInfo } from './declared-lights.js';

const IDENT_CHAR = /[A-Za-z0-9_$]/;

/**
 * Find the identifier (if any) at the given document position. Returns
 * null if pos is on whitespace, punctuation, or anything else that isn't
 * part of an ECMAScript identifier. The returned [from, to] range is
 * inclusive-from / exclusive-to in document coordinates.
 */
function identifierAt(
  view: EditorView,
  pos: number,
): { word: string; from: number; to: number } | null {
  const doc = view.state.doc;
  if (pos < 0 || pos > doc.length) return null;
  // Take a generous slice around the cursor and walk outwards. 64 chars
  // each side is plenty for any plausible identifier.
  const left = Math.max(0, pos - 64);
  const right = Math.min(doc.length, pos + 64);
  const text = doc.sliceString(left, right);
  const offset = pos - left;

  // Find left/right bounds of the run of identifier chars surrounding offset.
  let lo = offset;
  while (lo > 0 && IDENT_CHAR.test(text[lo - 1])) lo--;
  let hi = offset;
  while (hi < text.length && IDENT_CHAR.test(text[hi])) hi++;
  if (lo === hi) return null;

  const word = text.slice(lo, hi);
  // Reject pure-numeric tokens. `120` in `setBPM(120)` would otherwise
  // fall through and fail to match HELP_INDEX anyway; short-circuiting
  // saves the lookup.
  if (/^\d+$/.test(word)) return null;

  return { word, from: left + lo, to: left + hi };
}

/** HTML-escape a string for direct insertion into the tooltip DOM. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Build the tooltip DOM. Three stacked rows:
 *   1. signature      (mono, accent colour)
 *   2. description    (plain text)
 *   3. example label + code block (mono, muted bg)
 */
function renderTooltip(entry: HelpEntry): HTMLElement {
  const root = document.createElement('div');
  root.className = 'gobo-hover-help';

  const sig = document.createElement('div');
  sig.className = 'gobo-hover-help-sig';
  sig.textContent = entry.signature;
  root.appendChild(sig);

  const desc = document.createElement('div');
  desc.className = 'gobo-hover-help-desc';
  desc.textContent = entry.description;
  root.appendChild(desc);

  if (entry.example) {
    const exLabel = document.createElement('div');
    exLabel.className = 'gobo-hover-help-ex-label';
    exLabel.textContent = 'example';
    root.appendChild(exLabel);

    const ex = document.createElement('pre');
    ex.className = 'gobo-hover-help-ex';
    // innerHTML so we can preserve newlines as-is; entry.example is
    // editor-controlled data, but escape defensively anyway.
    ex.innerHTML = escapeHtml(entry.example);
    root.appendChild(ex);
  }

  return root;
}

/**
 * Build the tooltip for a light the user declared.
 *
 * Same three rows as an API entry, plus the list of verbs, because the useful
 * thing about a fixture you patched is which channels it turned out to have.
 */
function renderLightTooltip(info: LightInfo): HTMLElement {
  const root = document.createElement('div');
  root.className = 'gobo-hover-help';

  const sig = document.createElement('div');
  sig.className = 'gobo-hover-help-sig';
  sig.textContent = info.signature;
  root.appendChild(sig);

  const desc = document.createElement('div');
  desc.className = 'gobo-hover-help-desc';
  desc.textContent = info.note ?? info.summary;
  root.appendChild(desc);

  if (info.commands.length > 0) {
    const label = document.createElement('div');
    label.className = 'gobo-hover-help-ex-label';
    label.textContent = 'responds to';
    root.appendChild(label);

    const list = document.createElement('div');
    list.className = 'gobo-hover-help-cmds';
    for (const c of info.commands) {
      const chip = document.createElement('span');
      chip.className = 'gobo-hover-help-cmd';
      chip.textContent = c;
      list.appendChild(chip);
    }
    root.appendChild(list);
  }

  return root;
}

/** The CodeMirror extension. Wire into editor.ts alongside the other
 *  extensions. */
export const goboHoverHelp = hoverTooltip(
  (view, pos): Tooltip | null => {
    const hit = identifierAt(view, pos);
    if (!hit) return null;

    // A declared name wins over the API index: someone who writes
    // `const strip = …` means their strip, not the constructor.
    const decl = findLight(view.state.doc.toString(), hit.word);
    if (decl) {
      const info = describeLight(decl);
      return {
        pos: hit.from,
        end: hit.to,
        above: true,
        create() {
          return { dom: renderLightTooltip(info) };
        },
      };
    }

    const entry = HELP_INDEX.get(hit.word);
    if (!entry) return null;
    return {
      pos: hit.from,
      end: hit.to,
      above: true,
      create() {
        return { dom: renderTooltip(entry) };
      },
    };
  },
  { hideOnChange: true, hoverTime: 250 },
);
