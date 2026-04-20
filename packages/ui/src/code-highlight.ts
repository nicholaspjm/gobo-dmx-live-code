/**
 * Semantic colour coding for the editor: lumen commands vs. fixture names.
 *
 * The default `@codemirror/lang-javascript` highlighter paints all function
 * calls and identifiers identically. At lumen's scale it's useful to tell
 * two kinds of name apart at a glance:
 *
 *   1. **Commands** — names from the lumen API (fixture, sine, artnet,
 *      .viz, .flash, setBPM, audio, …). These are the verbs of the
 *      language and get the accent colour so you can find a pattern call
 *      site instantly.
 *
 *   2. **Lights** — identifiers you bound to a fixture with `const wash =
 *      fixture(...)` / `rgbStrip(...)` / `rgbwStrip(...)`. These are the
 *      nouns you drive and get a distinct accent2 tint so method-chain
 *      roots like `wash.red(...)` pop.
 *
 * Implementation is a plain ViewPlugin that regex-scans the doc on every
 * change and produces a Decoration set. The regexes respect word
 * boundaries but intentionally don't try to skip comments or strings —
 * highlighting a command name inside a string literal is harmless and
 * the overhead of full tokenization isn't worth the payoff here.
 */

import { ViewPlugin, EditorView, Decoration, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';

/** Free-function lumen commands (referenced without a receiver). */
const COMMAND_NAMES = [
  // fixtures + custom
  'fixture', 'defineFixture', 'listFixtures', 'rgbStrip', 'rgbwStrip',
  // output
  'artnet', 'osc', 'sacn', 'mock',
  // clock
  'setBPM',
  // patterns
  'sine', 'cosine', 'square', 'saw', 'rand',
  // sequencing (Strudel mini-notation)
  'mini', 'm', 'sequence', 'cat', 'stack',
  // low-level DMX
  'ch', 'uni', 'dim', 'rgb',
  // audio reactivity namespace
  'audio',
];

/** Method names whose colour should match the command accent (the lumen
 *  decoration chain; not every method — .red, .green, .pan etc. stay
 *  default so they read as fixture channels). */
const METHOD_NAMES = ['viz', 'flash', 'glow', 'wave'];

const commandMark = Decoration.mark({ class: 'lumen-command' });
const lightMark = Decoration.mark({ class: 'lumen-light' });

const COMMAND_RE = new RegExp(`\\b(?:${COMMAND_NAMES.join('|')})\\b`, 'g');
const METHOD_RE = new RegExp(`\\.(${METHOD_NAMES.join('|')})\\b`, 'g');
// Capture the light name declared by any of the fixture factory calls.
// Allows `let` or `var` in case the user switches style, though the default
// sample uses `const`.
const LIGHT_DECL_RE =
  /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:fixture|rgbStrip|rgbwStrip)\s*\(/g;

function buildDecorations(view: EditorView): DecorationSet {
  const doc = view.state.doc.toString();

  // Pass 1: collect light variable names defined anywhere in the doc.
  const lights = new Set<string>();
  let m: RegExpExecArray | null;
  LIGHT_DECL_RE.lastIndex = 0;
  while ((m = LIGHT_DECL_RE.exec(doc)) !== null) {
    lights.add(m[1]);
  }

  // Pass 2: gather every decoration as a flat list, dedup overlaps later.
  type Hit = { from: number; to: number; deco: Decoration };
  const hits: Hit[] = [];

  // Commands (function/identifier names).
  COMMAND_RE.lastIndex = 0;
  while ((m = COMMAND_RE.exec(doc)) !== null) {
    hits.push({ from: m.index, to: m.index + m[0].length, deco: commandMark });
  }

  // Method commands — highlight just the method name, skipping the `.`.
  METHOD_RE.lastIndex = 0;
  while ((m = METHOD_RE.exec(doc)) !== null) {
    hits.push({ from: m.index + 1, to: m.index + m[0].length, deco: commandMark });
  }

  // Lights — every usage of a declared fixture variable.
  if (lights.size > 0) {
    const lightRe = new RegExp(`\\b(?:${[...lights].join('|')})\\b`, 'g');
    while ((m = lightRe.exec(doc)) !== null) {
      hits.push({ from: m.index, to: m.index + m[0].length, deco: lightMark });
    }
  }

  // RangeSetBuilder demands sorted + non-overlapping ranges. Sort first;
  // then take the first mark for any overlapping region (commands win ties
  // since they're pushed before lights — which matters if a light name
  // collides with a command name, e.g. `const audio = fixture(…)`).
  hits.sort((a, b) => a.from - b.from || a.to - b.to);
  const builder = new RangeSetBuilder<Decoration>();
  let lastTo = -1;
  for (const h of hits) {
    if (h.from >= lastTo) {
      builder.add(h.from, h.to, h.deco);
      lastTo = h.to;
    }
  }
  return builder.finish();
}

/**
 * CodeMirror extension. Re-runs the scan on every doc change; skips re-work
 * on pure viewport updates (scroll/resize) because the decorations span the
 * whole doc, not just the visible lines.
 */
export const lumenCodeHighlight = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }
    update(update: ViewUpdate): void {
      if (update.docChanged) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);
