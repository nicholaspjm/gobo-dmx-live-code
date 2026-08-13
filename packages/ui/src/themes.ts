/**
 * Colour theme presets.
 *
 * Each theme is a flat map of CSS custom-property values written onto
 * `:root` via `applyTheme()`. Everything visible — the page CSS, the
 * CodeMirror editor styles, the hover tooltip — reads these variables,
 * so swapping themes is a single function call with no editor rebuild.
 *
 * Themes share the same variable schema, which means we can also expose
 * `var(--accent)` etc. in user-facing places like the docs panel without
 * theme-specific code paths.
 *
 * The schema is in two halves. The first 14 variables are UI chrome —
 * ground, text, borders, one accent pair. The remaining 24 are the syntax
 * palette: one variable per token class the editor can paint, so the
 * highlighter never has to know which theme is active and no theme needs
 * a per-theme CSS branch.
 *
 * Adding a theme: drop a new entry into THEMES, give it a name + all 38
 * colours. The settings panel populates its dropdown from the keys
 * automatically. Every syntax colour should clear 4.5:1 against that
 * theme's own `bg` — the values below sit at 4.87:1 or better so rounding
 * cannot flip a pass into a fail.
 */

export type ThemeId =
  | 'tungsten'
  | 'moonbox'
  | 'greenroom'
  | 'blacklight'
  | 'bastardAmber'
  | 'blackout'
  | 'glowtape'
  | 'safelight'
  | 'patchbay'
  | 'cyclorama'
  | 'surprisePink'
  | 'worklight'
  | 'followspot';

/** The variables each theme must supply. Every addition here means every
 *  theme needs an update, so a new variable has to earn its place by
 *  naming a distinction the editor genuinely draws. */
export interface ThemeVars {
  // ---- UI chrome (14) ----
  bg: string;
  surface: string;
  border: string;
  text: string;
  textMuted: string;
  accent: string;
  accent2: string;
  sage: string;       // panel accents; no longer used for editor strings
  error: string;
  selection: string;
  lineHighlight: string;
  cursor: string;
  /** Background of code-example blocks inside tooltips. Slightly darker
   *  than `surface` on dark themes; slightly lighter on light themes. */
  codeBg: string;
  /** Selection / bracket-match background for the editor — needs slightly
   *  more contrast than `selection` for dark themes. */
  selectionBg: string;

  // ---- Syntax palette (24) ----
  // Painted by the regex highlighter (packages/ui/src/code-highlight.ts)
  // as .gobo-* classes, except the last five, which are bound to lezer
  // tags in the HighlightStyle.

  /** `.gobo-fixture-decl` — the name being BOUND to a fixture, at its
   *  declaration site only. The brightest, boldest thing on the line. */
  synFixtureDecl: string;
  /** `.gobo-fixture-ref` — every later use of a bound fixture name, i.e.
   *  the receiver of a method chain. Same hue as the declaration, one
   *  clear step dimmer. */
  synFixtureRef: string;
  /** `.gobo-factory` — the calls that create fixtures and fixture types:
   *  fixture, rgbStrip, rgbwStrip, defineFixture, listFixtures. */
  synFactory: string;
  /** `.gobo-output` — output / wire configuration (artnet, sacn, osc,
   *  mock). Changes where light physically goes, so it is the loudest
   *  token in the buffer: bold plus an underline, so it never depends on
   *  hue alone to separate from --syn-clock and --syn-color-red. */
  synOutput: string;
  /** `.gobo-clock` — tempo (setBPM). One call retimes the whole show, so
   *  it shares the warm consequential family with output, a step below. */
  synClock: string;
  /** `.gobo-pattern` — pattern / waveform SOURCES: where movement in a
   *  scene comes from (sine, saw, rand, mini, sequence, stack, …). */
  synPattern: string;
  /** `.gobo-pattern-chain` — pattern TRANSFORMS (.slow .fast .range …
   *  plus `register`). Same hue as the sources at much lower chroma, so a
   *  chain reads as one gesture: bright head, quiet tail. */
  synPatternChain: string;
  /** `.gobo-color` — `.color`, the multi-channel setter that is not any
   *  one hue: the neutral member of the colour-setter family. */
  synColor: string;
  /** `.gobo-color-red` — the `.red` channel setter, tinted red. */
  synColorRed: string;
  /** `.gobo-color-green` — the `.green` channel setter, tinted green. */
  synColorGreen: string;
  /** `.gobo-color-blue` — the `.blue` channel setter, tinted blue. */
  synColorBlue: string;
  /** `.gobo-color-white` — the `.white` channel setter. The neutral of
   *  the hue-hinted set: near-zero chroma, same contrast band as the
   *  others so no setter outranks another. */
  synColorWhite: string;
  /** `.gobo-color-amber` — the `.amber` channel setter (rgba fixtures),
   *  tinted amber. */
  synColorAmber: string;
  /** `.gobo-intensity` — intensity and shutter (.dim .strobe .full .off):
   *  how much light, not what colour. The BARE `dim` is the low-level DMX
   *  function and takes --syn-dmx instead. */
  synIntensity: string;
  /** `.gobo-move` — movement, beam and optics (.pan .tilt .zoom .gobo
   *  .prism …): channels that aim or shape the beam without changing its
   *  colour or level. */
  synMove: string;
  /** `.gobo-pixel` — strip / pixel methods (.pixel .fill .each …) plus
   *  the pixelGrid fill-mode chain: addressing many emitters at once. */
  synPixel: string;
  /** `.gobo-viz` — editor-only decorations (.viz .flash .glow .wave).
   *  These change nothing on the rig, so they are the only gobo tokens in
   *  italic at deliberately low chroma: annotation, not command. */
  synViz: string;
  /** `.gobo-dmx` — low-level DMX (ch, uni, dim, rgb, .set): raw channel
   *  writes that bypass the fixture layer. Utilitarian: plumbing, not
   *  language. */
  synDmx: string;
  /** `.gobo-meta` — read-only introspection (.channels .def .universe
   *  .startChannel .channelCount .pixelCount). Reading a fixture never
   *  changes output, so these recede. Italic. */
  synMeta: string;
  /** `.gobo-keyword` — JavaScript keywords. Same hue as --syn-factory at
   *  roughly half the chroma, because `const wash = fixture(…)` is one
   *  gesture: the binding word and the factory belong together. */
  synKeyword: string;
  /** `.gobo-number` — numeric literals, the values you nudge live. Given
   *  their own hue rather than an accent so they stay findable without
   *  competing with the verbs. */
  synNumber: string;
  /** `.gobo-string` — string literals: fixture ids and mini-notation. Hue
   *  adjacent to --syn-pattern. Replaces the old use of `sage`. */
  synString: string;
  /** `.gobo-comment` — comments. The lowest-chroma colour in every
   *  palette so it recedes, but still held at >= 4.5:1 rather than the
   *  usual near-invisible grey. Italic. */
  synComment: string;
  /** `.gobo-operator` — operators, punctuation and separators: structure
   *  you read past. Replaces the old use of `textMuted`. */
  synOperator: string;
}

/** Human-readable name + the variable values. */
export interface ThemeDef {
  id: ThemeId;
  label: string;
  vars: ThemeVars;
}

export const THEMES: Record<ThemeId, ThemeDef> = {
  // An incandescent tungsten lamp at ~3200K — the warm brown-amber ground
  // every theatre still measures colour against. Kept as default and kept
  // first in the list, so existing users see no visible change: the 14
  // chrome values are byte-identical to the old 'ember'.
  tungsten: {
    id: 'tungsten',
    label: 'tungsten (default)',
    vars: {
      bg: '#1a1714',
      surface: '#211e1b',
      border: '#2e2a26',
      text: '#e8dfd0',
      textMuted: '#8a8078',
      accent: '#c4724a',
      accent2: '#b8956a',
      sage: '#7a8c6e',
      error: '#c45a5a',
      selection: '#2e2a2680',
      lineHighlight: '#211e1b88',
      cursor: '#c4724a',
      codeBg: '#1e1b18',
      selectionBg: '#3a342e',
      synFixtureDecl: '#c5b520',
      synFixtureRef: '#aea23a',
      synFactory: '#cc76cf',
      synOutput: '#f4844c',
      synClock: '#d88b18',
      synPattern: '#2aa69e',
      synPatternChain: '#56928e',
      synColor: '#b9889c',
      synColorRed: '#cd817f',
      synColorGreen: '#48a95f',
      synColorBlue: '#7c95cf',
      synColorWhite: '#92969c',
      synColorAmber: '#ab9449',
      synIntensity: '#84a92d',
      synMove: '#9883d1',
      synPixel: '#3d98c0',
      synViz: '#9281a4',
      synDmx: '#778a9c',
      synMeta: '#918679',
      synKeyword: '#ae78b0',
      synNumber: '#6aa451',
      synString: '#4e9e80',
      synComment: '#928474',
      synOperator: '#8f867c',
    },
  },
  // The moonbox — the cold blue-white fixture hung high to fake moonlight
  // over a set. A cool blue-grey room with a pale blue accent is exactly
  // what one throws. Chrome values byte-identical to the old 'slate'.
  moonbox: {
    id: 'moonbox',
    label: 'moonbox',
    vars: {
      bg: '#16181c',
      surface: '#1d2026',
      border: '#2c3038',
      text: '#d8dde6',
      textMuted: '#7a8190',
      accent: '#6aa9d8',
      accent2: '#94b8d1',
      sage: '#7ab5a6',
      error: '#d65a6a',
      selection: '#2c303880',
      lineHighlight: '#1d202688',
      cursor: '#6aa9d8',
      codeBg: '#1a1d22',
      selectionBg: '#2f3640',
      synFixtureDecl: '#dbac4f',
      synFixtureRef: '#bf9b53',
      synFactory: '#ba81ce',
      synOutput: '#f18478',
      synClock: '#e4844c',
      synPattern: '#31a985',
      synPatternChain: '#5a9382',
      synColor: '#b689a5',
      synColorRed: '#ca8290',
      synColorGreen: '#4ea94e',
      synColorBlue: '#6c9bc3',
      synColorWhite: '#91979b',
      synColorAmber: '#b68f62',
      synIntensity: '#9ca332',
      synMove: '#8a88cf',
      synPixel: '#3a9da4',
      synViz: '#8c84a3',
      synDmx: '#728c96',
      synMeta: '#7f8995',
      synKeyword: '#a37eb0',
      synNumber: '#7da154',
      synString: '#539e71',
      synComment: '#7c8796',
      synOperator: '#818993',
    },
  },
  // The greenroom — the offstage room performers wait in, traditionally
  // painted green to rest the eye after stage light. A deep green room
  // with a mint accent already was one. Chrome values byte-identical to
  // the old 'forest'.
  greenroom: {
    id: 'greenroom',
    label: 'greenroom',
    vars: {
      bg: '#141815',
      surface: '#1a1f1c',
      border: '#283028',
      text: '#d8e0d2',
      textMuted: '#7a8a7a',
      accent: '#6abe7a',
      accent2: '#a5c490',
      sage: '#b8a868',
      error: '#c46a5a',
      selection: '#28302880',
      lineHighlight: '#1a1f1c88',
      cursor: '#6abe7a',
      codeBg: '#171c18',
      selectionBg: '#2c382e',
      synFixtureDecl: '#d2b027',
      synFixtureRef: '#b69e41',
      synFactory: '#c37bce',
      synOutput: '#f18463',
      synClock: '#e28528',
      synPattern: '#2ea793',
      synPatternChain: '#589288',
      synColor: '#b788a0',
      synColorRed: '#cb8186',
      synColorGreen: '#4ba858',
      synColorBlue: '#7697c9',
      synColorWhite: '#91969b',
      synColorAmber: '#b19151',
      synIntensity: '#8ea630',
      synMove: '#9185cf',
      synPixel: '#3c9ab2',
      synViz: '#8f82a3',
      synDmx: '#748a99',
      synMeta: '#758d79',
      synKeyword: '#a87baf',
      synNumber: '#73a253',
      synString: '#509d79',
      synComment: '#708d75',
      synOperator: '#798c7c',
    },
  },
  // A UV blacklight wash — the violet-into-pink glow of a blacklit stage.
  // A violet room with a purple accent and a pink accent2 is precisely
  // what a blacklight does to a room, and it is an honest replacement for
  // a name that only meant 'dark blue'. Chrome values byte-identical to
  // the old 'midnight'.
  blacklight: {
    id: 'blacklight',
    label: 'blacklight',
    vars: {
      bg: '#15131c',
      surface: '#1c1929',
      border: '#2a253a',
      text: '#ddd8e8',
      textMuted: '#88809a',
      accent: '#b07ad8',
      accent2: '#d8a5c0',
      sage: '#7ab5b0',
      error: '#d65a6a',
      selection: '#2a253a80',
      lineHighlight: '#1c192988',
      cursor: '#b07ad8',
      codeBg: '#181522',
      selectionBg: '#332a45',
      synFixtureDecl: '#bab51a',
      synFixtureRef: '#a5a133',
      synFactory: '#d070cd',
      synOutput: '#f77f2e',
      synClock: '#cc8e12',
      synPattern: '#25a3a3',
      synPatternChain: '#528f8f',
      synColor: '#b98596',
      synColorRed: '#cd7e76',
      synColorGreen: '#44a661',
      synColorBlue: '#7d91d2',
      synColorWhite: '#90949b',
      synColorAmber: '#a49443',
      synIntensity: '#79a829',
      synMove: '#9a7ed2',
      synPixel: '#3e94c6',
      synViz: '#937da3',
      synDmx: '#76879d',
      synMeta: '#8e8199',
      synKeyword: '#b074ae',
      synNumber: '#61a34d',
      synString: '#499b83',
      synComment: '#8d7e9b',
      synOperator: '#8c8295',
    },
  },
  // Rosco Bastard Amber (R02) — the pale warm gel that flatters skin and
  // reads as 'no colour at all'. A warm cream light theme with a
  // burnt-orange accent is what it looks like on a white cyc. Chrome
  // values byte-identical to the old 'paper'.
  bastardAmber: {
    id: 'bastardAmber',
    label: 'bastard amber (light)',
    vars: {
      bg: '#f4eede',
      surface: '#ebe3ce',
      border: '#d4c8af',
      text: '#2a241c',
      textMuted: '#6a6253',
      accent: '#a85a30',
      accent2: '#8a7048',
      sage: '#5a7050',
      error: '#b04040',
      selection: '#d4c8afa0',
      lineHighlight: '#ebe3ce88',
      cursor: '#a85a30',
      codeBg: '#e0d6bc',
      selectionBg: '#d4c8af',
      synFixtureDecl: '#605610',
      synFixtureRef: '#6f6525',
      synFactory: '#a13ba8',
      synOutput: '#ae3c0b',
      synClock: '#925a10',
      synPattern: '#1d736a',
      synPatternChain: '#416f6a',
      synColor: '#90556e',
      synColorRed: '#ae4444',
      synColorGreen: '#32743f',
      synColorBlue: '#4065ae',
      synColorWhite: '#63676d',
      synColorAmber: '#776533',
      synIntensity: '#596e1d',
      synMove: '#6d54c0',
      synPixel: '#2b6e87',
      synViz: '#716084',
      synDmx: '#576978',
      synMeta: '#6e665a',
      synKeyword: '#89538d',
      synNumber: '#4a7037',
      synString: '#38715a',
      synComment: '#6f6657',
      synOperator: '#6c665c',
    },
  },
  // A house blackout — every instrument dead, and the only thing still lit
  // is the red panic lamp. Monochrome by design: the six colour setters
  // collapse to one value rather than a fake brightness ladder, because a
  // ladder would falsely imply one channel matters more than another.
  // Chrome values byte-identical to the old 'ikeda'.
  blackout: {
    id: 'blackout',
    label: 'blackout',
    vars: {
      bg: '#000000',
      surface: '#070707',
      border: '#1a1a1a',
      text: '#ffffff',
      textMuted: '#888888',
      accent: '#ff0033',
      accent2: '#ffffff',
      sage: '#00ff66',
      error: '#ff3344',
      selection: '#ff003322',
      lineHighlight: '#ffffff08',
      cursor: '#ff0033',
      codeBg: '#040404',
      selectionBg: '#1f1f1f',
      synFixtureDecl: '#dadada',
      synFixtureRef: '#b1b1b1',
      synFactory: '#9e9e9e',
      synOutput: '#fb708c',
      synClock: '#fa486b',
      synPattern: '#bfc6cd',
      synPatternChain: '#7f8d9a',
      synColor: '#b1b1b1',
      synColorRed: '#b1b1b1',
      synColorGreen: '#b1b1b1',
      synColorBlue: '#b1b1b1',
      synColorWhite: '#b1b1b1',
      synColorAmber: '#b1b1b1',
      synIntensity: '#c5c5c5',
      synMove: '#939faa',
      synPixel: '#a9b3bb',
      synViz: '#6e7e8c',
      synDmx: '#f60636',
      synMeta: '#6e7e8c',
      synKeyword: '#8b8b8b',
      synNumber: '#9e9e9e',
      synString: '#939faa',
      synComment: '#6e7e8c',
      synOperator: '#6e7e8c',
    },
  },
  // Photoluminescent glow tape — the green strips stuck to stage edges and
  // set legs so the crew can find their marks in a blackout. Green
  // phosphor on black, so the old aesthetic survives intact. Monochrome:
  // the colour setters share one value. Chrome values byte-identical to
  // the old 'datamatrix'.
  glowtape: {
    id: 'glowtape',
    label: 'glow tape',
    vars: {
      bg: '#000000',
      surface: '#050807',
      border: '#143218',
      text: '#c8ffd0',
      textMuted: '#4a7050',
      accent: '#00ff66',
      accent2: '#66ff99',
      sage: '#00cc88',
      error: '#ff5566',
      selection: '#00ff662e',
      lineHighlight: '#00ff660c',
      cursor: '#00ff66',
      codeBg: '#030504',
      selectionBg: '#103018',
      synFixtureDecl: '#a6e9c2',
      synFixtureRef: '#32ca72',
      synFactory: '#2db465',
      synOutput: '#f87486',
      synClock: '#f64f65',
      synPattern: '#b3cac7',
      synPatternChain: '#67948e',
      synColor: '#32ca72',
      synColorRed: '#32ca72',
      synColorGreen: '#32ca72',
      synColorBlue: '#32ca72',
      synColorWhite: '#32ca72',
      synColorAmber: '#32ca72',
      synIntensity: '#6ddb9b',
      synMove: '#7ea6a0',
      synPixel: '#98b7b3',
      synViz: '#5b837e',
      synDmx: '#f31936',
      synMeta: '#5b837e',
      synKeyword: '#289f5a',
      synNumber: '#2db465',
      synString: '#7ea6a0',
      synComment: '#5b837e',
      synOperator: '#5b837e',
    },
  },
  // A darkroom safelight — the amber-red lamp you can work under without
  // spoiling anything, which is exactly what a warm amber CRT is for. The
  // old name collided with a theme name in another live-coding tool, so it
  // had to go. Monochrome: the colour setters share one value. Chrome
  // values byte-identical to the old 'terminal'.
  safelight: {
    id: 'safelight',
    label: 'safelight',
    vars: {
      bg: '#0a0500',
      surface: '#14100a',
      border: '#2a200a',
      text: '#ffb83d',
      textMuted: '#886030',
      accent: '#ffc966',
      accent2: '#ff9933',
      sage: '#e8a548',
      error: '#ff5538',
      selection: '#ffb83d2e',
      lineHighlight: '#ffb83d0c',
      cursor: '#ffb83d',
      codeBg: '#050300',
      selectionBg: '#2e2310',
      synFixtureDecl: '#f5d9b5',
      synFixtureRef: '#e8a854',
      synFactory: '#e18e21',
      synOutput: '#f97b72',
      synClock: '#f7564b',
      synPattern: '#cdc9ba',
      synPatternChain: '#978e70',
      synColor: '#e8a854',
      synColorRed: '#e8a854',
      synColorGreen: '#e8a854',
      synColorBlue: '#e8a854',
      synColorWhite: '#e8a854',
      synColorAmber: '#e8a854',
      synIntensity: '#eec186',
      synMove: '#a8a187',
      synPixel: '#bab4a0',
      synViz: '#877e61',
      synDmx: '#f52516',
      synMeta: '#877e61',
      synKeyword: '#c87d1b',
      synNumber: '#e18e21',
      synString: '#a8a187',
      synComment: '#877e61',
      synOperator: '#877e61',
    },
  },
  // A dimmer-rack patchbay — grey steel panel, blue and orange jumper
  // leads, everything labelled and nothing decorative. Replaces another
  // audio product's name; stays a light theme for projection. Chrome
  // values byte-identical to the old 'puredata'.
  patchbay: {
    id: 'patchbay',
    label: 'patchbay (light)',
    vars: {
      bg: '#f0f0f0',
      surface: '#e0e0e0',
      border: '#909090',
      text: '#000000',
      textMuted: '#555555',
      accent: '#0066cc',
      accent2: '#cc6600',
      sage: '#007030',
      error: '#cc0000',
      selection: '#c8d8e8',
      lineHighlight: '#e8e8e8',
      cursor: '#0066cc',
      codeBg: '#d8d8d8',
      selectionBg: '#c8d8e8',
      synFixtureDecl: '#665513',
      synFixtureRef: '#736429',
      synFactory: '#9d40ab',
      synOutput: '#b53710',
      synClock: '#995715',
      synPattern: '#207466',
      synPatternChain: '#447069',
      synColor: '#8f5673',
      synColorRed: '#ac474d',
      synColorGreen: '#34753d',
      synColorBlue: '#4068a4',
      synColorWhite: '#63686d',
      synColorAmber: '#7b6537',
      synIntensity: '#5f6e20',
      synMove: '#6958be',
      synPixel: '#2c7081',
      synViz: '#706285',
      synDmx: '#586a77',
      synMeta: '#5f6973',
      synKeyword: '#87568e',
      synNumber: '#50713a',
      synString: '#3b7258',
      synComment: '#5d6975',
      synOperator: '#616971',
    },
  },
  // New below this line. Appended rather than inserted so the dropdown
  // order THEME_LIST produces stays stable for existing users.

  // A cyclorama wash — the deep saturated blue field the back wall throws
  // when the whole cyc is one colour. A real cyc blue rather than a UI
  // blue-grey; the accent is the pale sky-blue you get where the cyc meets
  // the floor lights.
  cyclorama: {
    id: 'cyclorama',
    label: 'cyclorama',
    vars: {
      bg: '#0b1836',
      surface: '#122045',
      border: '#1d3160',
      text: '#d8e4ff',
      textMuted: '#8195c4',
      accent: '#5fa8ff',
      accent2: '#9fc6ff',
      sage: '#6fd0c0',
      error: '#ff6b7a',
      selection: '#1d316080',
      lineHighlight: '#12204588',
      cursor: '#5fa8ff',
      codeBg: '#081230',
      selectionBg: '#24396e',
      synFixtureDecl: '#dfad3a',
      synFixtureRef: '#c19c46',
      synFactory: '#bf7fd2',
      synOutput: '#f68371',
      synClock: '#ea833e',
      synPattern: '#2baa88',
      synPatternChain: '#579484',
      synColor: '#ba89a6',
      synColorRed: '#ce828f',
      synColorGreen: '#49ab4d',
      synColorBlue: '#6d9bc9',
      synColorWhite: '#92989c',
      synColorAmber: '#b9905b',
      synIntensity: '#99a62c',
      synMove: '#8d88d3',
      synPixel: '#359ea9',
      synViz: '#8e84a6',
      synDmx: '#728d99',
      synMeta: '#808a97',
      synKeyword: '#a67eb3',
      synNumber: '#7aa350',
      synString: '#4fa072',
      synComment: '#7d8899',
      synOperator: '#828a95',
    },
  },
  // Rosco Surprise Pink (R337) — a hot pink gel burning against a
  // plum-dark house. Rendered as a dark plum ground with a hot magenta
  // accent rather than a pink background, so it stays a surface you can
  // read for hours while still being unmistakably pink.
  surprisePink: {
    id: 'surprisePink',
    label: 'surprise pink',
    vars: {
      bg: '#24102a',
      surface: '#2e1636',
      border: '#452250',
      text: '#ffe2f3',
      textMuted: '#b98cae',
      accent: '#ff5fb0',
      accent2: '#ffa6d6',
      sage: '#8fd0b8',
      error: '#ff5a6e',
      selection: '#45225080',
      lineHighlight: '#2e163688',
      cursor: '#ff5fb0',
      codeBg: '#1e0c24',
      selectionBg: '#55295f',
      synFixtureDecl: '#b5bb1a',
      synFixtureRef: '#a2a634',
      synFactory: '#d175c8',
      synOutput: '#f68521',
      synClock: '#c59511',
      synPattern: '#28a5ae',
      synPatternChain: '#569296',
      synColor: '#bb8996',
      synColorRed: '#cc8475',
      synColorGreen: '#45a96a',
      synColorBlue: '#8592d5',
      synColorWhite: '#93969e',
      synColorAmber: '#a29842',
      synIntensity: '#74ac2a',
      synMove: '#a180d3',
      synPixel: '#4f95cb',
      synViz: '#9780a4',
      synDmx: '#7b89a1',
      synMeta: '#998191',
      synKeyword: '#b278ac',
      synNumber: '#5ea74f',
      synString: '#4b9d8a',
      synComment: '#9b7e92',
      synOperator: '#96838f',
    },
  },
  // Worklight — the undesigned white practical that comes up when the show
  // stops and you can see the whole room. Nearly white rather than cream,
  // because bastard amber already owns warm cream: the two light themes
  // need to read as clearly different rooms.
  worklight: {
    id: 'worklight',
    label: 'worklight (light)',
    vars: {
      bg: '#fbfaf7',
      surface: '#f1efe9',
      border: '#d6d2c7',
      text: '#24211c',
      textMuted: '#66625a',
      accent: '#b63808',
      accent2: '#6a5b0f',
      sage: '#3a795e',
      error: '#b32a34',
      selection: '#d6d2c7a0',
      lineHighlight: '#f1efe988',
      cursor: '#b63808',
      codeBg: '#eeebe3',
      selectionBg: '#d6d2c7',
      synFixtureDecl: '#6a5b0f',
      synFixtureRef: '#786a25',
      synFactory: '#ac3db8',
      synOutput: '#be3808',
      synClock: '#a15c0e',
      synPattern: '#1c7b6e',
      synPatternChain: '#447670',
      synColor: '#9b5978',
      synColorRed: '#bb464a',
      synColorGreen: '#337c3f',
      synColorBlue: '#406db9',
      synColorWhite: '#696e74',
      synColorAmber: '#826b35',
      synIntensity: '#60751c',
      synMove: '#725dc6',
      synPixel: '#2a778e',
      synViz: '#78668f',
      synDmx: '#5b7080',
      synMeta: '#746d5e',
      synKeyword: '#93589a',
      synNumber: '#507839',
      synString: '#3a795e',
      synComment: '#766d5b',
      synOperator: '#736d61',
    },
  },
  // A followspot in a dead house — one brilliant straw-white beam and
  // nothing else lit anywhere. Distinguished from blackout by what is
  // still on: blackout keeps a red panic lamp and a mid-grey ladder,
  // followspot runs a near-white base at very high contrast with a single
  // straw beam for the consequential tokens. Monochrome: the colour
  // setters share one value.
  followspot: {
    id: 'followspot',
    label: 'followspot',
    vars: {
      bg: '#000000',
      surface: '#0a0a09',
      border: '#26261f',
      text: '#f7f4ea',
      textMuted: '#8f8b7e',
      accent: '#f6c84b',
      accent2: '#ffffff',
      sage: '#b9c7d2',
      error: '#ff5a4a',
      selection: '#f6c84b22',
      lineHighlight: '#ffffff08',
      cursor: '#f6c84b',
      codeBg: '#050504',
      selectionBg: '#26261f',
      synFixtureDecl: '#dcdad5',
      synFixtureRef: '#b5b1a6',
      synFactory: '#a29e90',
      synOutput: '#f6c84b',
      synClock: '#eaaf0c',
      synPattern: '#b9c7d2',
      synPatternChain: '#728fa5',
      synColor: '#b5b1a6',
      synColorRed: '#b5b1a6',
      synColorGreen: '#b5b1a6',
      synColorBlue: '#b5b1a6',
      synColorWhite: '#b5b1a6',
      synColorAmber: '#b5b1a6',
      synIntensity: '#c8c5bd',
      synMove: '#88a1b3',
      synPixel: '#a0b4c2',
      synViz: '#608096',
      synDmx: '#d19c0b',
      synMeta: '#608096',
      synKeyword: '#918c7b',
      synNumber: '#a29e90',
      synString: '#88a1b3',
      synComment: '#608096',
      synOperator: '#608096',
    },
  },
};

/**
 * Old theme id → current theme id.
 *
 * DO NOT DELETE THIS AS DEAD CODE. Every theme above was renamed, but
 * settings.ts persists the raw id string to localStorage, so anyone who
 * saved a theme before the rename has a now-unknown id sitting in their
 * browser. `applyTheme()` falls back to the default for an unknown id, so
 * without this map those users silently lose their chosen theme on the
 * next load. Read the stored value through here before handing it to
 * `applyTheme()`.
 *
 * Keyed by plain `string`, not by a union of the old ids, precisely
 * because the caller is looking up an untrusted value out of storage.
 */
export const LEGACY_THEME_IDS: Record<string, ThemeId> = {
  ember: 'tungsten',
  slate: 'moonbox',
  forest: 'greenroom',
  midnight: 'blacklight',
  paper: 'bastardAmber',
  ikeda: 'blackout',
  datamatrix: 'glowtape',
  terminal: 'safelight',
  puredata: 'patchbay',
};

/**
 * Concrete colour values for the active theme. Mutable so canvas consumers
 * (the visualizer) can keep a stable reference and just re-read it after
 * a theme change — no observer plumbing needed. Mirrors the CSS variables
 * for code that can't use them (canvas 2D context only accepts hex/rgb,
 * not `var()` references).
 */
export const COLORS: ThemeVars = { ...THEMES.tungsten.vars };

/** Write a theme's variables onto `:root` so all `var(--...)` lookups
 *  pick them up, and refresh the shared COLORS object for canvas/JS
 *  consumers. Idempotent. */
export function applyTheme(id: ThemeId): void {
  const t = THEMES[id] ?? THEMES.tungsten;
  const root = document.documentElement;
  // Map camelCase → kebab-case so the CSS variable names stay readable
  // (--text-muted, not --textMuted; --syn-fixture-decl, not
  // --synFixtureDecl).
  for (const [key, value] of Object.entries(t.vars)) {
    const cssName = '--' + key.replace(/([A-Z])/g, '-$1').toLowerCase();
    root.style.setProperty(cssName, value);
  }
  // A boolean attribute on <html> lets CSS make tiny per-theme tweaks
  // without inventing a new variable for every nuance.
  root.setAttribute('data-theme', id);
  // Re-sync the shared colour bag for canvas/JS consumers.
  Object.assign(COLORS, t.vars);
}

/** Stable list for dropdowns (preserves insertion order of THEMES). */
export const THEME_LIST: ThemeDef[] = Object.values(THEMES);
