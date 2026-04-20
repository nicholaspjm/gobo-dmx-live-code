/**
 * CodeMirror 6 editor setup.
 *
 * Keybindings:
 *   Ctrl+Enter  — evaluate code
 *   Ctrl+.      — stop / clear all channels
 */

import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view';
import { EditorState, Prec } from '@codemirror/state';
import { javascript } from '@codemirror/lang-javascript';
import { defaultKeymap, historyKeymap, history } from '@codemirror/commands';
import { bracketMatching, indentOnInput } from '@codemirror/language';
import { lumenTheme, lumenHighlight } from './theme.js';
import { vizDecorationsField } from './inline-viz.js';
import { lumenCodeHighlight } from './code-highlight.js';
import { lumenAutocomplete } from './autocomplete.js';

const INITIAL_CODE = `// lumen — ctrl+enter to run · ctrl+. to stop · open 'docs' for the reference

// Output target — swap in mock() for headless dev, osc() for TouchDesigner,
// or sacn(universe, priority) for E1.31. Port defaults to 6454 for Art-Net.
artnet('2.0.0.100')

// ── fixtures ──────────────────────────────────────────────
// fixture(startChannel, id, universe = 0) returns an object with one setter
// per named channel. Chain .viz('kind') to drop a live widget at line-end.
const wash  = fixture(1, 'generic-rgbw').viz('color')  // uni 0, ch 1-4
const strb  = fixture(5, 'strobe-basic').viz('meter')  // uni 0, ch 5-6

// rgbStrip(startChannel, pixelCount) — pixel bar at 3 channels per pixel.
const strip = rgbStrip(7, 10).viz('strip')             // uni 0, ch 7-36

// Custom fixture — defineFixture lets you describe any channel layout. The
// 'pixels' channel below is a nested RGBW strip thanks to pixelLayout:'rgbw'.
defineFixture('four-color-bar', {
  name: 'Four-Colour Moving Bar',
  manufacturer: 'Generic',
  type: 'generic',
  channelCount: 38,
  channels: [
    { offset: 0, name: 'direction',   type: 'control'   },
    { offset: 1, name: 'speed',       type: 'control'   },
    { offset: 2, name: 'effect',      type: 'control'   },   // leave 0 for direct pixel control
    { offset: 3, name: 'effectSpeed', type: 'control'   },
    { offset: 4, name: 'dim',         type: 'intensity' },
    { offset: 5, name: 'strobe',      type: 'strobe'    },
    { offset: 6, name: 'pixels',      type: 'strip', pixelCount: 8, pixelLayout: 'rgbw' },
  ],
})
const bar = fixture(1, 'four-color-bar', 1)            // uni 1, ch 1-38
bar.pixels.viz('strip')

// ── patterns ──────────────────────────────────────────────
// Channels take a number (constant) or a pattern (animated). Patterns
// come in two flavours: continuous waveforms (sine/cosine/square/saw/
// rand, chainable with .slow / .range / .mul / etc.) and step sequences
// (mini, same drum-style notation Strudel uses).

// Drum-grid on the wash — one mini() string per channel. Each string
// plays through one scheduler cycle (= 4 beats) with tokens splitting
// the time equally. '-' rests, numbers pass through as values. Whitespace
// between tokens is free — group in fours for readability.
// See the 'sequencing' docs entry for subdivisions, repeats, and more.
wash.red(  mini('1 - - -  - - 1 -  - - 1 -  - - - -').glow())
wash.green(mini('- - 1 -  1 - - -  - - - -  - 1 - -'))
wash.blue( mini('- 1 - -  - - - 1  - 1 - -  1 - - 1'))
wash.white(mini('- - - 1  - - - -  - - - 1  - - - -'))

// Strobe burst on beats 2 and 4. [1 1 1 1] compresses four hits into
// one slot (4× the outer step rate), so each bracket gives a rapid
// roll. Uncomment to fire.
// strb.dim(0.9)
// strb.strobe(mini('- [1 1 1 1] - [1 1 1 1]').flash())

// Rainbow chase on the strip — manual for-loop version so the math is
// visible. strip.rainbowChase() would do the same in one line (see the
// 'effects' tab in the docs for the full mechanism).
const hueR = sine().slow(12).range(0, 1)
const hueG = sine().early(1/3).slow(12).range(0, 1)
const hueB = sine().early(2/3).slow(12).range(0, 1)
for (let i = 0; i < strip.pixelCount; i++) {
  const phase = i / strip.pixelCount
  const bright = cosine().early(phase).slow(2).range(-8, 1)
  strip.pixel(i, bright.mul(hueR), bright.mul(hueG), bright.mul(hueB))
}

// Same chase on the moving bar (universe 1) — one-line helper version.
bar.dim(1)
bar.pixels.rainbowChase()

// Kick — flash the whole bar white on every beat, sitting on top of the
// rainbow. One scheduler cycle = 4 beats, so .fast(4) gives one pulse per
// beat. .range(-15, 1) sharpens the cosine into a short snap. Writing to
// .white() alone overrides just the W channel the chase set to 0, so the
// rainbow's RGB stays visible between kicks.
//   .fast(2) → half notes · .fast(4) → quarters · .fast(8) → eighths
bar.pixels.white(cosine().fast(4).range(-15, 1))
`;

export type EvalHandler = (code: string) => void;
export type StopHandler = () => void;
export type ChangeHandler = (code: string) => void;

export function createEditor(
  parent: HTMLElement,
  onEval: EvalHandler,
  onStop: StopHandler,
  onChange?: ChangeHandler,
): EditorView {
  const evalKeybinding = Prec.highest(
    keymap.of([
      {
        key: 'Ctrl-Enter',
        run(view) {
          onEval(view.state.doc.toString());
          return true;
        },
      },
      {
        key: 'Ctrl-.',
        run() {
          onStop();
          return true;
        },
      },
    ]),
  );

  // Fire the change callback on any doc edit (user typing, paste, undo…).
  // Consumers typically debounce this before hitting the network.
  const changeListener = EditorView.updateListener.of((update) => {
    if (update.docChanged && onChange) {
      onChange(update.state.doc.toString());
    }
  });

  const state = EditorState.create({
    doc: INITIAL_CODE,
    extensions: [
      history(),
      lineNumbers(),
      highlightActiveLine(),
      bracketMatching(),
      indentOnInput(),
      javascript(),
      lumenTheme,
      lumenHighlight,
      lumenCodeHighlight,
      lumenAutocomplete,
      vizDecorationsField,
      evalKeybinding,
      changeListener,
      keymap.of([...defaultKeymap, ...historyKeymap]),
    ],
  });

  return new EditorView({ state, parent });
}

/** Read the current text contents of an editor view. */
export function getEditorCode(view: EditorView): string {
  return view.state.doc.toString();
}
