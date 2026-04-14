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

const INITIAL_CODE = `// lumen — live DMX coding environment
// ctrl+enter to run  ·  ctrl+. to stop

// ─────────────────────────────────────────────────────
// 0. output config (artnet / sacn / mock)
// ─────────────────────────────────────────────────────

// artnet(host, port)  — send Art-Net UDP
// sacn(universe, priority) — send sACN E1.31
// osc(host, port) — send OSC (great for TouchDesigner)
// mock() — console log only (no hardware)

osc('127.0.0.1', 9000)      // /lumen/<uni>/<ch> <float 0-1>
// artnet('127.0.0.1', 6454)
// sacn(1, 100)
// mock()

// ─────────────────────────────────────────────────────
// 1. define your fixtures (type + DMX start address)
// ─────────────────────────────────────────────────────

// built-in types: generic-dimmer, generic-rgb, generic-rgbw,
// generic-rgba, generic-dim-rgb, moving-head-basic, strobe-basic

const washA = fixture(1, 'generic-rgbw')   // ch 1-4
const washB = fixture(5, 'generic-rgbw')   // ch 5-8
const spot  = fixture(9, 'generic-dimmer') // ch 9
const strb  = fixture(10, 'strobe-basic')  // ch 10-11

// custom fixture — define your own channel layout:
defineFixture('my-par', {
  name: 'My PAR Can',
  manufacturer: 'Generic',
  type: 'rgba',
  channelCount: 5,
  channels: [
    { offset: 0, name: 'red',   type: 'color' },
    { offset: 1, name: 'green', type: 'color' },
    { offset: 2, name: 'blue',  type: 'color' },
    { offset: 3, name: 'amber', type: 'color' },
    { offset: 4, name: 'white', type: 'color' },
  ]
})
const myPar = fixture(12, 'my-par')        // ch 12-16

// ─────────────────────────────────────────────────────
// 2. write patterns
// ─────────────────────────────────────────────────────

// wash A — warm amber breathe (dim via colour intensity)
washA.red(sine().slow(4).range(0, 0.9))
washA.green(sine().slow(4).range(0, 0.4))
washA.blue(sine().slow(4).range(0, 0.05))
washA.white(sine().slow(6))

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

// custom par — colour cycle
myPar.red(sine().slow(3).range(0, 0.8))
myPar.green(cosine().slow(3).range(0, 0.8))
myPar.blue(sine().slow(5).range(0, 0.8))
myPar.amber(saw().slow(8).range(0, 0.6))
myPar.white(0.2)
`;

export type EvalHandler = (code: string) => void;
export type StopHandler = () => void;

export function createEditor(
  parent: HTMLElement,
  onEval: EvalHandler,
  onStop: StopHandler,
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
      evalKeybinding,
      keymap.of([...defaultKeymap, ...historyKeymap]),
    ],
  });

  return new EditorView({ state, parent });
}
