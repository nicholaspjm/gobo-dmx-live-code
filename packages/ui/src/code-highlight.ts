/**
 * Semantic colour coding for the editor: one decoration class per gobo token
 * category, so a scene reads as lighting rather than as generic JavaScript.
 *
 * The default `@codemirror/lang-javascript` highlighter paints every function
 * call and identifier the same. That suits a language whose verbs are
 * arbitrary. Here the verbs are a small fixed vocabulary, and the difference
 * between "changes the colour" and "changes where the light physically goes"
 * has to be readable at a glance.
 *
 * The taxonomy this plugin emits (base JavaScript tokens are NOT here:
 * keywords, numbers, strings, comments and operators are lezer tags styled by
 * the HighlightStyle in theme.ts):
 *
 *   gobo-fixture-decl   the name being BOUND to a fixture, at its declaration
 *                       site only: `wash` in `const wash = fixture(…)`
 *   gobo-fixture-ref    every later use of that same name: `wash` in
 *                       `wash.red(…)`, `bar` in `bar.pixels.fill(…)`
 *   gobo-factory        fixture/type constructors: fixture, rgbStrip,
 *                       rgbwStrip, defineFixture, listFixtures
 *   gobo-output         wire configuration: artnet, sacn, osc, mock. Loudest
 *                       token in the buffer; it decides where light goes
 *   gobo-clock          setBPM. One call retimes the whole show
 *   gobo-pattern        waveform/sequence SOURCES: sine, cosine, square, saw,
 *                       rand, mini, m, sequence, cat, stack
 *   gobo-pattern-chain  pattern TRANSFORMS: .slow .fast .early .late .range
 *                       .add .mul, plus bare `register` (it defines a new
 *                       chain method, so it belongs to this family)
 *   gobo-color          .color, the multi-channel setter that is no one hue,
 *                       plus bare mix and pick: both answer with a colour, and
 *                       neither answers with a fixed one
 *   gobo-color-red      .red, red      \
 *   gobo-color-orange   orange          |  one class per colour, tinted
 *   gobo-color-amber    .amber, amber   |  towards the colour it names. The
 *   gobo-color-yellow   yellow          |  five with a channel of their own
 *   gobo-color-green    .green, green   |  cover both spellings: the setter
 *   gobo-color-cyan     cyan            |  drives that channel, the bare name
 *   gobo-color-blue     .blue, blue     |  is the colour value of the same
 *   gobo-color-purple   purple          |  name. The other six are values
 *   gobo-color-magenta  magenta         |  only, because no fixture has a
 *   gobo-color-pink     pink            |  magenta emitter to drive
 *   gobo-color-white    .white, white  /
 *   gobo-intensity      .dim .strobe .full .off: how much light, not what
 *                       colour. Note bare `dim` is the low-level DMX function
 *                       and takes gobo-dmx instead; only `.dim` is intensity
 *   gobo-move           beam aim and optics: .pan .tilt .panFine .tiltFine
 *                       .speed .zoom .focus .gobo .colorWheel .prism
 *                       .direction
 *   gobo-pixel          strip/pixel addressing: .pixel .pixelGrid .each .fill
 *                       .rainbowChase and the pixelGrid fill modes .repeat
 *                       .hold .mirror
 *   gobo-viz            editor-only decorations: .viz .flash .glow .wave.
 *                       These change nothing on the rig
 *   gobo-dmx            raw channel writes that bypass the fixture layer:
 *                       bare ch, uni, dim, rgb, plus the method .set
 *   gobo-meta           read-only introspection: .channels .def .universe
 *                       .startChannel .channelCount .pixelCount
 *
 * ## Exactly one category per token
 *
 * CodeMirror's RangeSetBuilder requires ranges added in ascending order with
 * no overlap; two marks over one range from a single builder throws or renders
 * unpredictably. Rather than emit a category per regex and reconcile overlaps
 * afterwards, this walks the document once with a single identifier regex and
 * classifies each occurrence. A token can then only receive one class, and the
 * ranges are ascending and disjoint by construction.
 *
 * Classification, in precedence order:
 *
 *   1. Preceded immediately by `.` → look the name up in the METHOD table
 *      only. This is what keeps `.dim` (intensity) apart from bare `dim`
 *      (low-level DMX), and `.set` apart from a user variable called `set`.
 *      A method category can therefore never paint a plain variable that
 *      happens to be named `color` or `each`.
 *   2. Otherwise, at a fixture declaration site → gobo-fixture-decl.
 *   3. Otherwise, a name bound to a fixture anywhere in the document →
 *      gobo-fixture-ref. Fixture bindings outrank every bare keyword below: a
 *      name the user bound is a fixture in this buffer, and
 *      `const mock = fixture(1,'rgbw')` shadows the output binding in JS
 *      anyway.
 *   4. Otherwise, look the name up in the BARE table (factory, output, clock,
 *      pattern, register, dmx).
 *   5. Otherwise, no decoration. It is a user identifier and stays var(--text).
 *
 * Within each table the names are unique, which buildTable() asserts at module
 * load, so table order carries no meaning. Across the two they need not be:
 * five colours are in both, because `.red` drives the red channel and bare
 * `red` is the colour of that name, and the dot has already decided which
 * table is consulted before either is looked in.
 *
 * ## Known limitations
 *
 * The scan does not consult the syntax tree, so it does not skip strings or
 * comments: `fixture(1, 'rgb')` paints the `rgb` inside the string literal as
 * gobo-dmx, a wheel slot written `head.color('red')` paints the quoted name as
 * the colour red, and a command name written in a comment is coloured too. Full
 * tokenisation on every keystroke costs more than the mistake does. The wider
 * palette makes it more visible than it was with two colours, so it may be
 * worth revisiting.
 *
 * Two smaller accepted false positives: `m` is a one-letter pattern
 * constructor and will also paint a user variable called `m`; and a receiver
 * separated from its method by whitespace (`wash . red(…)`) is not recognised
 * as a method, because the dot must be the immediately preceding character.
 */

import { ViewPlugin, EditorView, Decoration, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';
import { findLights } from './declared-lights.js';

// One Decoration instance per class, created once. CodeMirror compares
// decorations by identity when diffing sets, so reusing these keeps redraws
// cheap on every doc change.
const fixtureDeclMark  = Decoration.mark({ class: 'gobo-fixture-decl'  });
const fixtureRefMark   = Decoration.mark({ class: 'gobo-fixture-ref'   });
const factoryMark      = Decoration.mark({ class: 'gobo-factory'       });
const outputMark       = Decoration.mark({ class: 'gobo-output'        });
const clockMark        = Decoration.mark({ class: 'gobo-clock'         });
const patternMark      = Decoration.mark({ class: 'gobo-pattern'       });
const patternChainMark = Decoration.mark({ class: 'gobo-pattern-chain' });
const colorMark        = Decoration.mark({ class: 'gobo-color'         });
const colorRedMark     = Decoration.mark({ class: 'gobo-color-red'     });
const colorGreenMark   = Decoration.mark({ class: 'gobo-color-green'   });
const colorBlueMark    = Decoration.mark({ class: 'gobo-color-blue'    });
const colorWhiteMark   = Decoration.mark({ class: 'gobo-color-white'   });
const colorAmberMark   = Decoration.mark({ class: 'gobo-color-amber'   });
const colorOrangeMark  = Decoration.mark({ class: 'gobo-color-orange'  });
const colorYellowMark  = Decoration.mark({ class: 'gobo-color-yellow'  });
const colorCyanMark    = Decoration.mark({ class: 'gobo-color-cyan'    });
const colorPurpleMark  = Decoration.mark({ class: 'gobo-color-purple'  });
const colorMagentaMark = Decoration.mark({ class: 'gobo-color-magenta' });
const colorPinkMark    = Decoration.mark({ class: 'gobo-color-pink'    });
const intensityMark    = Decoration.mark({ class: 'gobo-intensity'     });
const moveMark         = Decoration.mark({ class: 'gobo-move'          });
const pixelMark        = Decoration.mark({ class: 'gobo-pixel'         });
const vizMark          = Decoration.mark({ class: 'gobo-viz'           });
const dmxMark          = Decoration.mark({ class: 'gobo-dmx'           });
const metaMark         = Decoration.mark({ class: 'gobo-meta'          });

/**
 * Flatten `[mark, names]` groups into one lookup. Throws on a name claimed by
 * two categories: the design rests on a token landing in one category, and a
 * silent last-wins collision would break that invisibly. This runs once at
 * module load, so a bad edit fails on startup rather than mis-colouring one
 * token in production.
 */
function buildTable(groups: readonly (readonly [Decoration, readonly string[]])[]): Map<string, Decoration> {
  const table = new Map<string, Decoration>();
  for (const [deco, names] of groups) {
    for (const name of names) {
      if (table.has(name)) {
        throw new Error(`code-highlight: "${name}" is claimed by two token categories`);
      }
      table.set(name, deco);
    }
  }
  return table;
}

/**
 * Names recognised as gobo tokens when written WITHOUT a leading dot: the
 * free functions injected into the eval sandbox. The `ctx` object in
 * packages/core/src/eval.ts is the authoritative list.
 */
const BARE_TOKENS = buildTable([
  [factoryMark,      ['fixture', 'rgbStrip', 'rgbwStrip', 'defineFixture', 'listFixtures']],
  [outputMark,       ['artnet', 'sacn', 'osc', 'mock']],
  [clockMark,        ['setBPM']],
  [patternMark,      ['sine', 'cosine', 'square', 'saw', 'rand', 'mini', 'm', 'sequence', 'cat', 'stack']],
  // `register` defines a new chain method, so it reads as part of the chain
  // family rather than as a fixture factory.
  [patternChainMark, ['register']],
  [dmxMark,          ['ch', 'uni', 'dim', 'rgb']],
  // `mix` and `pick` return a colour that is no single hue, which is what
  // gobo-color already means for `.color`. Both are safe in the BARE table and
  // would not be in METHOD_TOKENS: neither is a call gobo has after a dot, and
  // painting them there would colour any user method named that.
  [colorMark,        ['mix', 'pick']],
  // The eleven predefined colours, each painted as the colour it names. They
  // are values rather than calls, and they are reserved in the sandbox, so a
  // scene cannot bind one: `const red = 1` is a SyntaxError, and painting the
  // name is what says so before the run does. Listed in the order of
  // COLOR_NAMES in packages/core/src/colors.ts, which is the list this must
  // match.
  [colorRedMark,     ['red']],
  [colorOrangeMark,  ['orange']],
  [colorAmberMark,   ['amber']],
  [colorYellowMark,  ['yellow']],
  [colorGreenMark,   ['green']],
  [colorCyanMark,    ['cyan']],
  [colorBlueMark,    ['blue']],
  [colorPurpleMark,  ['purple']],
  [colorMagentaMark, ['magenta']],
  [colorPinkMark,    ['pink']],
  [colorWhiteMark,   ['white']],
]);

/**
 * Names recognised only in receiver position (immediately after a dot). Kept
 * separate from BARE_TOKENS so that a user variable coincidentally named
 * `color`, `each` or `set` is never painted, and so bare `dim` (DMX) and
 * `.dim` (intensity) can disagree about their category.
 */
const METHOD_TOKENS = buildTable([
  [patternChainMark, ['slow', 'fast', 'early', 'late', 'range', 'add', 'mul']],
  [colorMark,        ['color']],
  [colorRedMark,     ['red']],
  [colorGreenMark,   ['green']],
  [colorBlueMark,    ['blue']],
  [colorWhiteMark,   ['white']],
  [colorAmberMark,   ['amber']],
  [intensityMark,    ['dim', 'strobe', 'full', 'off']],
  // panFine/tiltFine/speed/zoom/gobo/colorWheel/prism/focus are real channels
  // on moving-head-spot; `direction` reaches no built-in but is honoured by
  // collectMovement() in packages/core/src/fixtures.ts for defineFixture users.
  [moveMark,         ['pan', 'tilt', 'panFine', 'tiltFine', 'speed', 'zoom', 'focus', 'gobo', 'colorWheel', 'prism', 'direction']],
  // .repeat/.hold/.mirror are the pixelGrid fill modes (FillMode in fixtures.ts).
  [pixelMark,        ['pixel', 'pixelGrid', 'each', 'fill', 'rainbowChase', 'repeat', 'hold', 'mirror']],
  [vizMark,          ['viz', 'flash', 'glow', 'wave']],
  [dmxMark,          ['set']],
  [metaMark,         ['channels', 'def', 'universe', 'startChannel', 'channelCount', 'pixelCount']],
]);

/** Every JS identifier occurrence, in document order. */
const IDENT_RE = /[A-Za-z_$][\w$]*/g;

/** Identifier-continuation test, used to reject the `e5` inside `1e5`. */
const IDENT_CHAR = /[\w$]/;

// IDENT_RE is module-scope and stateful (`g` flag). Every use below resets
// lastIndex first, so a throw mid-scan cannot poison the next call.

function buildDecorations(view: EditorView): DecorationSet {
  const doc = view.state.doc.toString();

  // Pass 1: fixture bindings. Collect the bound names, and the exact offset of
  // each declaration site so pass 2 can tell a declaration from a reference.
  // The scan is shared with hover and autocomplete. Each of the three used to
  // keep its own copy of it, and two had never learned about `monoStrip` or
  // `screen`, so a strip of white cells was painted as an ordinary variable.
  const fixtureNames = new Set<string>();
  const declOffsets = new Set<number>();
  let m: RegExpExecArray | null;
  for (const decl of findLights(doc)) {
    fixtureNames.add(decl.name);
    declOffsets.add(decl.nameFrom);
  }

  // Pass 2: one walk over every identifier, classified into at most one
  // category. Matches from a single regex are disjoint and ascending, so the
  // builder's ordering contract holds without any post-hoc overlap fixup.
  const builder = new RangeSetBuilder<Decoration>();
  IDENT_RE.lastIndex = 0;
  while ((m = IDENT_RE.exec(doc)) !== null) {
    const from = m.index;
    const name = m[0];
    const prev = from > 0 ? doc[from - 1] : '';

    // Mid-token start: only reachable inside a numeric literal such as `1e5`,
    // where the scan finds `e5` after the digit. Never a real identifier.
    if (prev !== '' && IDENT_CHAR.test(prev)) continue;

    let deco: Decoration | undefined;
    if (prev === '.') {
      // Receiver position (covers `?.` too, since that also ends in a dot).
      // Method names are looked up here and nowhere else.
      deco = METHOD_TOKENS.get(name);
    } else if (declOffsets.has(from)) {
      deco = fixtureDeclMark;
    } else if (fixtureNames.has(name)) {
      deco = fixtureRefMark;
    } else {
      deco = BARE_TOKENS.get(name);
    }

    if (deco !== undefined) builder.add(from, from + name.length, deco);
  }

  return builder.finish();
}

/**
 * CodeMirror extension. Re-runs the scan on every doc change; skips re-work
 * on pure viewport updates (scroll/resize) because the decorations span the
 * whole doc, not just the visible lines.
 */
export const goboCodeHighlight = ViewPlugin.fromClass(
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
