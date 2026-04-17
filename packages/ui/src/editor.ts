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

// artnet(host?, port?) — Art-Net via bridge. Port defaults to 6454 (the
//                        standard Art-Net port — you rarely need to pass it).
//                        Host should be your node's IP, or a broadcast addr
//                        like '2.255.255.255' to hit every node on the subnet.
// osc(host, port)      — OSC via bridge (/lumen/<uni>/<ch> <float 0-1>)
// sacn(universe, prio) — sACN E1.31 via bridge
// mock()               — console log only, no hardware

artnet('2.0.0.100')                 // point at your Art-Net node
// artnet('2.255.255.255')          // or broadcast on the 2.x.x.x subnet
// osc('127.0.0.1', 9000)
// sacn(1, 100)
// mock()

// ─────────────────────────────────────────────────────
// 1. define your fixtures (type + DMX start address)
// ─────────────────────────────────────────────────────

// built-in types: generic-dimmer, generic-rgb, generic-rgbw,
// generic-rgba, generic-dim-rgb, moving-head-basic, strobe-basic

// Signatures:
//   fixture(startChannel, id, universe = 0)
//   rgbStrip(startChannel, pixelCount, universe = 0)
// Universe defaults to 0 (Art-Net / TD convention: first universe is 0).
// Any fixture can live on any universe; the bridge transmits every universe
// that has been written to, one ArtDmx packet per universe per tick.

// Chain .viz(kind) to drop a live widget at the end of the line. Kinds:
//   'color' swatch · 'wave' scope · 'meter' bar · 'strip' pixel-row.
// Multiple kinds are allowed, e.g. .viz('wave', 'meter').

// Universe 0 — demo group
const washA = fixture(1, 'generic-rgbw').viz('color')   // uni 0, ch 1-4
const washB = fixture(5, 'generic-rgbw').viz('color')   // uni 0, ch 5-8
const spot  = fixture(9, 'generic-dimmer').viz('wave')  // uni 0, ch 9
const strb  = fixture(10, 'strobe-basic').viz('meter')  // uni 0, ch 10-11

// rgbStrip(startChannel, pixelCount, universe?) — each pixel = 3 chs (R, G, B)
const strip = rgbStrip(12, 10).viz('strip')             // uni 0, ch 12-41

// ─── Custom fixture: four-colour moving bar (RGBW pixel segment) ─────
// defineFixture lets you describe any DMX fixture by its channel map. The
// 'pixels' channel below uses type: 'strip' with pixelLayout: 'rgbw', so
// you get a nested RgbwStripInstance with .fill(r,g,b,w), .pixel(i,r,g,b,w),
// and a .white(v) setter — same API as rgbwStrip() but embedded in the
// fixture alongside dim / strobe / macro channels.
defineFixture('four-color-bar', {
  name: 'Four-Colour Moving Bar',
  manufacturer: 'Generic',
  type: 'generic',
  channelCount: 38,
  channels: [
    { offset: 0, name: 'direction',   type: 'control'   },      // ch1 level operation / direction
    { offset: 1, name: 'speed',       type: 'control'   },      // ch2 movement speed
    { offset: 2, name: 'effect',      type: 'control'   },      // ch3 built-in macro (0 = off)
    { offset: 3, name: 'effectSpeed', type: 'control'   },      // ch4 macro speed
    { offset: 4, name: 'dim',         type: 'intensity' },      // ch5 master dimmer
    { offset: 5, name: 'strobe',      type: 'strobe'    },      // ch6 strobe
    { offset: 6, name: 'pixels',      type: 'strip',
      pixelCount: 8, pixelLayout: 'rgbw' },                     // ch7-38: 8 RGBW pixels
  ],
})

// Universe 1, address 1 — drive the bar with the rainbow pattern below.
const bar = fixture(1, 'four-color-bar', 1)
bar.pixels.viz('strip')

// Additional universes — uncomment to drive them.
// const parU2   = fixture(1, 'generic-rgbw', 2)          // universe 2
// const parU3   = fixture(1, 'generic-rgbw', 3)          // universe 3
// const stripU4 = rgbStrip(1, 40, 4)                     // universe 4, 40px

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

// four-colour moving bar (universe 1) — same rainbow across its 8 RGBW pixels.
// ch3 (effect) stays at 0 so the fixture obeys direct pixel input instead of
// running its own built-in macro. dim() must be non-zero or the bar stays dark.
bar.dim(1)
bar.strobe(0)
for (let i = 0; i < bar.pixels.pixelCount; i++) {
  const phase = i / bar.pixels.pixelCount
  bar.pixels.pixel(i,
    sine().slow(4).add(phase).range(0, 0.9),   // R
    cosine().slow(4).add(phase).range(0, 0.6), // G
    sine().slow(2).add(phase).range(0, 0.4),   // B
    cosine().slow(6).add(phase).range(0, 0.3), // W — slow warm shimmer
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
