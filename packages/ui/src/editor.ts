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
// Channels take a number (constant) or a pattern (animated). sine/cosine/
// square/saw/rand chain with .slow, .fast, .add, .mul, .range. .glow() and
// .wave() on a pattern are opt-in inline editor visualizations.

// Amber breathe on the wash. The .glow() draws a subtle bg rail on this
// line that tracks the sine's current value; .wave() adds a mini sparkline.
wash.red(sine().slow(4).range(0, 0.9).glow())
wash.green(sine().slow(4).range(0, 0.4))
wash.white(sine().slow(6).range(0, 0.3).wave())

// Strobe — uncomment to fire. .flash() pulses the editor line on each hit.
// strb.dim(0.8)
// strb.strobe(square().fast(16).flash())

// Rainbow chase across the strip — each pixel is phase-shifted by its
// position so the waves scroll down the bar.
for (let i = 0; i < strip.pixelCount; i++) {
  const phase = i / strip.pixelCount
  strip.pixel(i,
    sine().slow(4).add(phase).range(0, 0.9),
    cosine().slow(4).add(phase).range(0, 0.6),
    sine().slow(2).add(phase).range(0, 0.4),
  )
}

// Same rainbow on the moving bar (universe 1). RGBW pixels take a 4th arg
// for the white channel — here a slow cosine so the warm tone drifts.
// bar.dim(1) is required or the master dimmer keeps the fixture dark.
bar.dim(1)
for (let i = 0; i < bar.pixels.pixelCount; i++) {
  const phase = i / bar.pixels.pixelCount
  bar.pixels.pixel(i,
    sine().slow(4).add(phase).range(0, 0.9),
    cosine().slow(4).add(phase).range(0, 0.6),
    sine().slow(2).add(phase).range(0, 0.4),
    cosine().slow(6).add(phase).range(0, 0.3),
  )
}
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
