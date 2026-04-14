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

const INITIAL_CODE = `// lumen — live DMX coding environment
// ctrl+enter to run  ·  ctrl+. to stop

// ─────────────────────────────────────────────────────
// 0. output config
// ─────────────────────────────────────────────────────

// td(host, port)       — direct WebSocket to TouchDesigner (no bridge)
// osc(host, port)      — OSC via bridge (/lumen/<uni>/<ch> <float 0-1>)
// artnet(host, port)   — Art-Net via bridge
// sacn(universe, prio) — sACN E1.31 via bridge
// mock()               — console log only, no hardware

td('localhost', 9980)       // point at TD WebSocket DAT
// osc('127.0.0.1', 9000)
// artnet('127.0.0.1', 6454)
// sacn(1, 100)
// mock()

// ─────────────────────────────────────────────────────
// 1. define your fixtures (type + DMX start address)
// ─────────────────────────────────────────────────────

// built-in types: generic-dimmer, generic-rgb, generic-rgbw,
// generic-rgba, generic-dim-rgb, moving-head-basic, strobe-basic

// Chain .viz(kind) to drop a live widget at the end of the line. Kinds:
//   'color' swatch · 'wave' scope · 'meter' bar · 'strip' pixel-row.
// Multiple kinds are allowed, e.g. .viz('wave', 'meter').

const washA = fixture(1, 'generic-rgbw').viz('color')   // ch 1-4
const washB = fixture(5, 'generic-rgbw').viz('color')   // ch 5-8
const spot  = fixture(9, 'generic-dimmer').viz('wave')  // ch 9
const strb  = fixture(10, 'strobe-basic').viz('meter')  // ch 10-11

// rgbStrip(startChannel, pixelCount) — each pixel = 3 chs (R, G, B)
const strip = rgbStrip(12, 10).viz('strip')             // ch 12-41 (10 pixels × 3)

// Custom fixture with an embedded pixel-strip segment:
//   ch1 dim · ch2 strobe · ch3-11 strip(3 pixels) · ch12 mode
// Strip channels declare { type: 'strip', pixelCount: N } and become a
// nested object on the fixture instance (not a setter function).
defineFixture('my-bar', {
  name: 'Custom RGB Bar',
  manufacturer: 'Generic',
  type: 'generic',
  channelCount: 12,
  channels: [
    { offset: 0,  name: 'dim',    type: 'intensity' },
    { offset: 1,  name: 'strobe', type: 'strobe' },
    { offset: 2,  name: 'pixels', type: 'strip', pixelCount: 3 },
    { offset: 11, name: 'mode',   type: 'control' },
  ],
})
// const bar = fixture(100, 'my-bar')        // ch 100-111
// bar.dim(0.8)
// bar.pixels.fill(sine().slow(2), 0, cosine().slow(2))
// bar.pixels.pixel(1, 1, 0, 0)

// ─────────────────────────────────────────────────────
// 2. write patterns
// ─────────────────────────────────────────────────────

// wash A — warm amber breathe
washA.red(sine().slow(4).range(0, 0.9))
washA.green(sine().slow(4).range(0, 0.4))
washA.blue(sine().slow(4).range(0, 0.05))
washA.white(sine().slow(6).range(0, 0.4))

// wash B — cool blue, offset half a cycle
washB.red(sine().slow(4).add(0.5).range(0, 0.05))
washB.green(sine().slow(4).add(0.5).range(0, 0.3))
washB.blue(sine().slow(4).add(0.5).range(0, 0.9))
washB.white(0)

// spot — sharp beat pulse
spot.dim(square().fast(1))

// strobe — uncomment to fire
// strb.dim(0.8)
// strb.strobe(square().fast(16))

// pixel strip — per-pixel rainbow chase
for (let i = 0; i < strip.pixelCount; i++) {
  const phase = i / strip.pixelCount
  strip.pixel(i,
    sine().slow(4).add(phase).range(0, 0.9),
    cosine().slow(4).add(phase).range(0, 0.6),
    sine().slow(2).add(phase).range(0, 0.4),
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
