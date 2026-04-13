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
// 1. define your fixtures (type + DMX start address)
// ─────────────────────────────────────────────────────

// built-in types: generic-dimmer, generic-rgb, generic-rgbw,
// generic-rgba, generic-dim-rgb, moving-head-basic, strobe-basic

const washA = fixture(1,  'generic-rgbw')   // ch 1-4
const washB = fixture(5,  'generic-rgbw')   // ch 5-8
const spot  = fixture(9,  'generic-dimmer') // ch 9
const strb  = fixture(10, 'strobe-basic')   // ch 10-11

// custom fixture — define your own channel layout:
defineFixture('my-par', {
  name: 'My PAR Can',
  manufacturer: 'Generic',
  type: 'rgba',
  channelCount: 5,
  channels: [
    { offset: 0, name: 'dim',   type: 'intensity' },
    { offset: 1, name: 'red',   type: 'color' },
    { offset: 2, name: 'green', type: 'color' },
    { offset: 3, name: 'blue',  type: 'color' },
    { offset: 4, name: 'amber', type: 'color' },
  ]
})
const myPar = fixture(12, 'my-par')         // ch 12-16

// ─────────────────────────────────────────────────────
// 2. write patterns
// ─────────────────────────────────────────────────────

// wash A — warm amber breathe
washA.dim(sine().slow(4))
washA.red(0.9)
washA.green(0.4)
washA.blue(0.05)
washA.white(sine().slow(6))

// wash B — cool blue, offset half a cycle
washB.dim(sine().slow(4).add(0.5).range(0, 1))
washB.red(0.05)
washB.green(0.3)
washB.blue(0.9)
washB.white(0)

// spot — sharp beat pulse
spot.dim(square().fast(1).range(0, 1))

// strobe — uncomment to fire
// strb.dim(0.8)
// strb.strobe(square().fast(16))

// custom par — colour cycle
myPar.dim(0.8)
myPar.red(sine().slow(3))
myPar.green(cosine().slow(3))
myPar.blue(sine().slow(5))
myPar.amber(saw().slow(8))
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
