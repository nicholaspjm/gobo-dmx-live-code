/**
 * Fixture system for gobo.
 *
 * Fixtures map named channels (red, pan, dim, etc.) to DMX addresses.
 * Users load a fixture at a start channel and get back an object with
 * named setters that call through to uni() / ch().
 *
 * Example:
 *   const par = fixture(1, 'rgb')
 *   par.red(sine())
 *   par.green(0)
 *   par.blue(cosine().slow(2))
 *
 *   const head = fixture(10, 'moving-head-basic')
 *   head.pan(0.5)
 *   head.tilt(square().slow(8))
 *   head.dim(0.8)
 */

import { uni, channelValue, channelValues, levelOf, type PatternOrValue, type PatternLike } from './dmx.js';
import {
  readColor,
  readColorStops,
  readColorRun,
  sampleStops,
  phaseFor,
  isColor,
  isPalette,
  toColorValue,
  checkOptions,
  type Color,
  type ColorComponent,
} from './colors.js';

// ─── Fixture definition types ─────────────────────────────────────────────────

export interface ChannelDef {
  /** 0-based byte offset from the fixture's start channel */
  offset: number;
  /** User-facing name: 'red', 'dim', 'pan', 'tilt', etc. */
  name: string;
  /**
   * Semantic type hint. Most types map 1:1 to a single DMX channel; 'strip'
   * is special: it claims `pixelCount * channelsPerPixel` channels starting
   * at `offset` and exposes a nested StripInstance on the fixture under this name.
   */
  type: 'intensity' | 'color' | 'position' | 'strobe' | 'control' | 'generic' | 'strip';
  /** Human-readable description */
  description?: string;
  /** For type='strip': number of pixels. */
  pixelCount?: number;
  /**
   * For type='strip': channel layout per pixel. 'rgb' (3 chs/pixel, default)
   * or 'rgbw' (4 chs/pixel). 'rgbw' exposes a nested RgbwStripInstance with
   * .fill(r,g,b,w), .pixel(i,r,g,b,w), and a .white(v) setter.
   *
   * 'mono' is one channel per pixel: a row of single-colour cells, which is
   * how a segmented white strobe strip or a bar of plain dimmers is wired.
   * It exposes the same geometry as the others, with one level per cell.
   */
  pixelLayout?: 'rgb' | 'rgbw' | 'mono';
  /**
   * For type='strip': how many pixels make up one row. Omit for a plain line
   * of pixels, which is the same thing with a single row.
   */
  columns?: number;
  /**
   * For type='strip': the wiring snakes back on itself, so odd rows run
   * right-to-left. Common on pixel bars and matrices, and impossible to guess
   * from the channel count, so the fixture has to say.
   */
  serpentine?: boolean;
  /**
   * For type='strip': which physical corner DMX pixel 0 sits in. See
   * {@link StripGeometry.origin}. Default 'top-left'.
   */
  origin?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  /**
   * Named positions on a channel that selects rather than dims: a colour
   * wheel, a gobo wheel, a prism, a control channel with modes. Declaring
   * them lets a scene say `head.color('red')` instead of looking a raw DMX
   * number out of the manual.
   *
   * A channel with slots is a selector, so it is never treated as something
   * that emits light: .off() and .full() leave it where it is, the same way
   * they already leave pan and tilt alone.
   */
  slots?: ChannelSlot[];
}

/**
 * One named position on a selector channel.
 *
 * Manuals give these as ranges, so a range is what this takes. `value` is the
 * shorthand for a slot that is exactly one DMX step.
 */
export interface ChannelSlot {
  name: string;
  /** Single DMX value (0-255). Use instead of from/to. */
  value?: number;
  /** Inclusive start of the DMX range (0-255). */
  from?: number;
  /** Inclusive end of the DMX range (0-255). */
  to?: number;
}

export interface FixtureDef {
  name: string;
  manufacturer: string;
  type: 'dimmer' | 'rgb' | 'rgba' | 'rgbw' | 'moving-head' | 'strobe' | 'generic';
  /** Total channel count */
  channelCount: number;
  channels: ChannelDef[];
}

// ─── Which channels emit light ───────────────────────────────────────────────
//
// .off() and .full() need to know what to drive. They used to walk a hardcoded
// six names, so a fixture whose emitters are called anything else was silently
// skipped: a warm/cold blinder's .full() sent nothing, and worse, its .off()
// left the bulbs lit. A blackout that does not black out is the worst failure
// this API can have.
//
// Two ways in, because fixture defs in the wild use both conventions:
//
//   type: 'intensity'   anything declared as a raw emitter, whatever its name.
//                       Covers warm1 / coldWhite / uv / bulbA without a list.
//   a known colour name for defs that type their colour channels 'color' or
//                       leave them 'generic'.
//
// A channel carrying `slots` is excluded from both: it selects rather than
// emits, so a colour wheel stays put through a blackout the way pan and tilt
// already do.

/**
 * Colour roles recognised by name. Longer than the old six because subtractive
 * and tunable-white fixtures are ordinary now, and a name that is missing here
 * is a light that will not respond to .off().
 */
const EMITTER_NAMES = new Set([
  'red', 'green', 'blue', 'white', 'amber', 'dim', 'dimmer', 'intensity',
  'uv', 'lime', 'cyan', 'magenta', 'yellow', 'indigo', 'mint',
  'warm', 'cold', 'cool', 'warmwhite', 'coldwhite', 'coolwhite', 'ww', 'cw',
]);

/**
 * Does this channel put light out, as opposed to steering or shaping it?
 *
 * A trailing number is dropped before the name check so the bulbs of a blinder
 * (warm1, cold1, warm2, cold2) match the same roles as a single-cell fixture.
 */
export function isEmitterChannel(ch: ChannelDef): boolean {
  if (ch.slots !== undefined && ch.slots.length > 0) return false;
  if (ch.type === 'strip') return true;
  if (ch.type === 'intensity') return true;
  const bare = ch.name.toLowerCase().replace(/[\s_-]/g, '').replace(/\d+$/, '');
  return EMITTER_NAMES.has(bare);
}

// ─── Built-in fixture library ─────────────────────────────────────────────────

export const BUILT_IN_FIXTURES: Record<string, FixtureDef> = {
  // Short names, which user code should reference. The legacy `generic-*`
  // ids resolve to these via FIXTURE_ALIASES below so existing scenes
  // keep working.
  'dim': {
    name: 'Dimmer',
    manufacturer: 'Generic',
    type: 'dimmer',
    channelCount: 1,
    channels: [
      { offset: 0, name: 'dim', type: 'intensity', description: 'Dimmer / intensity' },
    ],
  },

  'rgb': {
    name: 'RGB PAR',
    manufacturer: 'Generic',
    type: 'rgb',
    channelCount: 3,
    channels: [
      { offset: 0, name: 'red',   type: 'color', description: 'Red'   },
      { offset: 1, name: 'green', type: 'color', description: 'Green' },
      { offset: 2, name: 'blue',  type: 'color', description: 'Blue'  },
    ],
  },

  'rgbw': {
    name: 'RGBW PAR',
    manufacturer: 'Generic',
    type: 'rgbw',
    channelCount: 4,
    channels: [
      { offset: 0, name: 'red',   type: 'color', description: 'Red'   },
      { offset: 1, name: 'green', type: 'color', description: 'Green' },
      { offset: 2, name: 'blue',  type: 'color', description: 'Blue'  },
      { offset: 3, name: 'white', type: 'color', description: 'White' },
    ],
  },

  'rgba': {
    name: 'RGBA PAR',
    manufacturer: 'Generic',
    type: 'rgba',
    channelCount: 4,
    channels: [
      { offset: 0, name: 'red',   type: 'color', description: 'Red'   },
      { offset: 1, name: 'green', type: 'color', description: 'Green' },
      { offset: 2, name: 'blue',  type: 'color', description: 'Blue'  },
      { offset: 3, name: 'amber', type: 'color', description: 'Amber' },
    ],
  },

  'dim-rgb': {
    name: 'Dimmer + RGB PAR',
    manufacturer: 'Generic',
    type: 'rgb',
    channelCount: 4,
    channels: [
      { offset: 0, name: 'dim',   type: 'intensity', description: 'Master dimmer' },
      { offset: 1, name: 'red',   type: 'color',     description: 'Red'           },
      { offset: 2, name: 'green', type: 'color',     description: 'Green'         },
      { offset: 3, name: 'blue',  type: 'color',     description: 'Blue'          },
    ],
  },

  'dim-rgbw': {
    name: 'Dimmer + RGBW PAR',
    manufacturer: 'Generic',
    type: 'rgbw',
    channelCount: 5,
    channels: [
      { offset: 0, name: 'dim',   type: 'intensity', description: 'Master dimmer' },
      { offset: 1, name: 'red',   type: 'color',     description: 'Red'           },
      { offset: 2, name: 'green', type: 'color',     description: 'Green'         },
      { offset: 3, name: 'blue',  type: 'color',     description: 'Blue'          },
      { offset: 4, name: 'white', type: 'color',     description: 'White'         },
    ],
  },

  'moving-head-basic': {
    name: 'Moving Head (Basic 8ch)',
    manufacturer: 'Generic',
    type: 'moving-head',
    channelCount: 8,
    channels: [
      { offset: 0, name: 'pan',    type: 'position',  description: 'Pan (0=left, 1=right)'         },
      { offset: 1, name: 'tilt',   type: 'position',  description: 'Tilt (0=front, 1=back)'        },
      { offset: 2, name: 'dim',    type: 'intensity', description: 'Master dimmer'                  },
      { offset: 3, name: 'strobe', type: 'strobe',    description: 'Strobe (0=open, 1=fast strobe)' },
      { offset: 4, name: 'red',    type: 'color',     description: 'Red'                            },
      { offset: 5, name: 'green',  type: 'color',     description: 'Green'                          },
      { offset: 6, name: 'blue',   type: 'color',     description: 'Blue'                           },
      { offset: 7, name: 'white',  type: 'color',     description: 'White / CTO'                    },
    ],
  },

  'moving-head-spot': {
    name: 'Moving Head Spot (12ch)',
    manufacturer: 'Generic',
    type: 'moving-head',
    channelCount: 12,
    channels: [
      { offset: 0,  name: 'pan',    type: 'position',  description: 'Pan coarse'         },
      { offset: 1,  name: 'panFine',type: 'position',  description: 'Pan fine'           },
      { offset: 2,  name: 'tilt',   type: 'position',  description: 'Tilt coarse'        },
      { offset: 3,  name: 'tiltFine',type:'position',  description: 'Tilt fine'          },
      { offset: 4,  name: 'speed',  type: 'control',   description: 'Pan/tilt speed'     },
      { offset: 5,  name: 'dim',    type: 'intensity', description: 'Master dimmer'      },
      { offset: 6,  name: 'strobe', type: 'strobe',    description: 'Strobe'             },
      { offset: 7,  name: 'zoom',   type: 'control',   description: 'Zoom'               },
      { offset: 8,  name: 'gobo',   type: 'control',   description: 'Gobo wheel'         },
      { offset: 9,  name: 'colorWheel', type: 'control', description: 'Colour wheel position' },
      { offset: 10, name: 'prism',  type: 'control',   description: 'Prism'              },
      { offset: 11, name: 'focus',  type: 'control',   description: 'Focus'              },
    ],
  },

  'strobe': {
    name: 'Strobe',
    manufacturer: 'Generic',
    type: 'strobe',
    channelCount: 2,
    channels: [
      { offset: 0, name: 'dim',    type: 'intensity', description: 'Intensity'     },
      { offset: 1, name: 'strobe', type: 'strobe',    description: 'Strobe rate'   },
    ],
  },
};

/**
 * Backward-compat: pre-rename fixture ids resolve to the new short names.
 * Scenes saved against `generic-rgbw` etc. keep working without a forced
 * migration. New code writes `fixture(1, 'rgbw')`.
 */
const FIXTURE_ALIASES: Record<string, string> = {
  'generic-dimmer':   'dim',
  'generic-rgb':      'rgb',
  'generic-rgbw':     'rgbw',
  'generic-rgba':     'rgba',
  'generic-dim-rgb':  'dim-rgb',
  'generic-dim-rgbw': 'dim-rgbw',
  'strobe-basic':     'strobe',
};

// ─── Sim registry ────────────────────────────────────────────────────────────
// Every fixture / strip the user creates in a scene pushes itself onto this
// list, so the UI's sim panel renders what is in play and nothing else.
// Cleared at the start of each evalCode() cycle alongside the pattern
// registry, giving a fresh snapshot per scene.
//
// Each entry carries what the sim renderer needs and nothing else:
//   - how to draw it (globe / dimmer / rgb strip / rgbw strip)
//   - which DMX channels to read for live values
//   - a label for display + tooltip
// Channel offsets are all 0-based within the universe buffer.

export type SimRenderKind = 'globe-rgbw' | 'globe-dim' | 'strip-rgb' | 'strip-rgbw' | 'strip-mono';

/**
 * Optional movement-channel hints. When present, the sim panel applies a
 * CSS transform each tick so the element visibly tracks `pan` / `tilt` /
 * `direction` channel values. Numbers here are *absolute* 1-based DMX
 * channels, which keeps the renderer simple at the cost of one extra add
 * at registration time.
 *
 *  pan        0 → -50% x, 0.5 → centred, 1 → +50% x (horizontal travel)
 *  tilt       0 → -50% y, 0.5 → centred, 1 → +50% y (vertical travel)
 *  direction  0 → -45°,  0.5 → 0°,      1 → +45°    (rotation, for bars)
 */
export interface SimMovement {
  pan?: number;
  tilt?: number;
  direction?: number;
}

/**
 * How a strip is laid out on the light, so the panel can draw it that way.
 *
 * `order` maps picture position to wire position: order[y * columns + x] is
 * the pixel index the hardware puts there. Serpentine wiring and a bottom-right
 * origin both live in that array, so the panel does not have to know the rules,
 * only which cell to read for the square it is painting. Without it a 12 x 4
 * wash drew as one row of 48 in wire order, which is neither its shape nor its
 * arrangement.
 */
export interface SimGrid {
  columns: number;
  rows: number;
  order: readonly number[];
}

export interface SimFixture {
  /** Short label shown under the element in the sim panel (falls back to
   *  `id` when no better name is available). */
  label: string;
  /** Debug/tooltip detail: the human-readable fixture type. */
  type: string;
  universe: number;
  /** 1-based DMX start channel. */
  startChannel: number;
  /** Total channels this entry occupies. Tooltip-only. */
  channelCount: number;
  /**
   * The id this was patched with, so the tooltip can show the call that made
   * it. Absent for strips built directly rather than from a fixture def.
   */
  fixtureId?: string;
  /**
   * Start channel to print in that call, when it differs from this entry's own
   * `startChannel`. A fixture whose visible part is an embedded strip is drawn
   * from the strip's address, but it was patched at the fixture's.
   */
  patchChannel?: number;
  /**
   * Absolute 1-based channel of a master dimmer sitting over this entry, when
   * the entry is a strip inside a fixture that has one.
   *
   * A globe already scales itself by its own dim channel. A strip drew its
   * pixel values raw, so a 154-channel wash with its master at zero, which
   * emits no light at all, appeared on screen fully lit. The panel exists to
   * be believed, and that is the one way it can be worse than nothing.
   */
  master?: number;
  /**
   * What can be called on it: the named setters, or a strip's methods. Shown
   * on hover, because knowing a fixture is there is not the same as knowing
   * what it answers to, and the alternative is guessing or reading the docs
   * for a fixture you already have in front of you.
   */
  commands?: string[];
  /** Live movement channel hints; absent = element doesn't move. */
  movement?: SimMovement;
  render:
    | { kind: 'globe-rgbw'; r?: number; g?: number; b?: number; w?: number; dim?: number }
    | { kind: 'globe-dim';  dim: number }
    | { kind: 'strip-rgb';  pixelCount: number; grid?: SimGrid }
    | { kind: 'strip-rgbw'; pixelCount: number; grid?: SimGrid }
    | { kind: 'strip-mono'; pixelCount: number; grid?: SimGrid };
}

const _simFixtures: SimFixture[] = [];

export function registerSimFixture(fix: SimFixture): void {
  _simFixtures.push(fix);
}

/** UI-side: read the current fixtures after eval to (re)build the panel. */
export function getSimFixtures(): readonly SimFixture[] {
  return _simFixtures;
}

/** Called from eval.ts at the start of every evalCode(). */
export function clearSimFixtures(): void {
  _simFixtures.length = 0;
}

// ─── pixelGrid helpers ────────────────────────────────────────────────────────
// `values` is a flat array of channel values laid out row-by-row: every
// `stride` consecutive entries describe one pixel. `fill` decides what to
// do for strip positions past the end of the input.

type FillMode = 'none' | 'repeat' | 'hold' | 'mirror';

/**
 * Resolve the source-pixel index for a given strip position under a fill
 * mode. Returns -1 when the position should be blank (only `none` past
 * the input does this).
 */
function pickSourceIdx(strip: number, inputPixels: number, mode: FillMode): number {
  if (strip < inputPixels) return strip;
  if (inputPixels < 1) return -1;
  switch (mode) {
    case 'none':   return -1;
    case 'hold':   return inputPixels - 1;
    case 'repeat': return strip % inputPixels;
    case 'mirror': {
      // Period 2N: positions [0..N-1] use grid forward, [N..2N-1] use it
      // reversed. inputPixels=3 → a b c c b a a b c c b a ...
      const period = inputPixels * 2;
      const pos = strip % period;
      return pos < inputPixels ? pos : period - 1 - pos;
    }
  }
}

/**
 * Write the strip's pixels from an array-of-rows under the given fill
 * mode. Each inner array is one pixel: [r, g, b] for RGB strips,
 * [r, g, b, w] for RGBW. Missing channels default to 0 so callers can
 * be terse: `[1]` is a valid "red only" row.
 *
 * Called once on the initial `pixelGrid(rows)` (mode 'none') and again
 * on each chained .repeat() / .hold() / .mirror() with the appropriate
 * mode; the second pass overwrites the first.
 */
export function applyPixelGrid(
  rows: PatternOrValue[][],
  stride: 3 | 4,
  pixelCount: number,
  startChannel: number,
  universe: number,
  mode: FillMode,
): void {
  const inputPixels = rows.length;
  for (let i = 0; i < pixelCount; i++) {
    const base = startChannel + i * stride;
    const src = pickSourceIdx(i, inputPixels, mode);
    if (src < 0) {
      // Blank pixel: zero every channel in the stride.
      for (let j = 0; j < stride; j++) uni(universe, base + j, 0);
      continue;
    }
    const row = rows[src];
    for (let j = 0; j < stride; j++) {
      uni(
        universe,
        base + j,
        row[j] === undefined ? 0 : channelValue([row[j]], `.pixelGrid() row ${src} ${'rgbw'[j]}`),
      );
    }
  }
}

/**
 * Resolve movement-channel hints for a fixture from its declared channel
 * layout. Picks `pan` / `tilt` / `direction` channels and converts each
 * to an absolute 1-based DMX channel. Returns undefined if none of the
 * three are present, which keeps the SimFixture payload lean for static
 * fixtures.
 */
function collectMovement(def: FixtureDef, startChannel: number): SimMovement | undefined {
  const byName = (n: string): number | undefined =>
    def.channels.find((c) => c.name === n)?.offset;
  const panO       = byName('pan');
  const tiltO      = byName('tilt');
  const directionO = byName('direction');
  if (panO === undefined && tiltO === undefined && directionO === undefined) {
    return undefined;
  }
  const m: SimMovement = {};
  if (panO       !== undefined) m.pan       = startChannel + panO;
  if (tiltO      !== undefined) m.tilt      = startChannel + tiltO;
  if (directionO !== undefined) m.direction = startChannel + directionO;
  return m;
}

// ─── Runtime fixture registry (user-defined fixtures) ─────────────────────────

const _customFixtures: Record<string, FixtureDef> = {};

/** Register a custom fixture definition under a given id. */
export function defineFixture(id: string, def: FixtureDef): void {
  _customFixtures[id] = def;
}

/**
 * Snapshot of currently-registered custom fixtures (those declared via
 * `defineFixture(id, def)` in the user's code or restored from the library
 * on startup). Excludes built-ins. Used by the library panel to show what
 * the user could promote into persistent storage.
 */
export function getCustomFixtures(): Record<string, FixtureDef> {
  // Shallow clone so the caller can't mutate the internal registry.
  return { ..._customFixtures };
}

/**
 * Look up a fixture id without throwing. Returns undefined for an id nobody
 * has defined.
 *
 * Exported for the editor, which resolves ids read out of the buffer while
 * they are still half-typed. A throw is right when a scene patches a fixture
 * that does not exist and wrong when a tooltip is deciding whether it has
 * anything to say.
 */
export function findFixtureDef(id: string): FixtureDef | undefined {
  const canonical = FIXTURE_ALIASES[id] ?? id;
  return BUILT_IN_FIXTURES[canonical] ?? _customFixtures[canonical];
}

/** Resolve fixture id → FixtureDef (alias → built-in first, then custom). */
function resolveFixture(id: string): FixtureDef {
  const def = findFixtureDef(id);
  if (!def) {
    const available = [
      ...Object.keys(BUILT_IN_FIXTURES),
      ...Object.keys(_customFixtures),
    ].join(', ');
    throw new Error(`Unknown fixture "${id}". Available: ${available}`);
  }
  return def;
}

// ─── Fixture instance ─────────────────────────────────────────────────────────

/**
 * A live fixture instance: named accessors bound to real DMX channels.
 *
 * For normal channels (intensity/color/position/strobe/control/generic), the
 * accessor is a setter function: `fixture.red(sine())`.
 *
 * For channels declared with `type: 'strip'`, the accessor is a nested
 * StripInstance: `fixture.pixels.fill(sine(), 0, 0)`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type FixtureInstance = {
  /** The resolved fixture definition */
  readonly def: FixtureDef;
  /** DMX universe (1-based) */
  readonly universe: number;
  /** Start channel (1-based, inclusive) */
  readonly startChannel: number;
  /**
   * Set any scalar channel by name. Throws for strip channels. Omit the value
   * for full. On a channel with named slots, the value may be a slot name, or
   * a pattern of slot names.
   */
  set(channelName: string, ...value: [(PatternOrValue | string)?]): void;
  /** List available channel names */
  channels(): string[];
  /**
   * The slot names declared on a channel, or an empty list if it has none.
   *
   * @example
   *   console.log(head.slots('color'))   // ['open', 'red', 'blue', …]
   */
  slots(channelName: string): string[];
  /**
   * Opt into one or more inline editor visualizations for this fixture.
   * The editor scans the source for `.viz(...)` call sites and drops a
   * live widget at the end of that line. Default kind is 'color'.
   *
   * @example
   *   const washA = fixture(1, 'rgbw').viz('color')
   *   const spot  = fixture(9, 'dim').viz('wave', 'meter')
   */
  viz(...kinds: VizKind[]): FixtureInstance;

  // ── Generic helpers: work on any fixture, ignore channels that don't exist
  /**
   * Set red / green / blue (and optionally white) in one call. Channels
   * absent on this fixture are skipped silently so the same call works
   * across rgb / rgbw / dim-rgb / dim-rgbw / moving-head fixtures.
   *
   * On a fixture whose def gives a slotted channel the name `color`, meaning a
   * colour wheel, a single argument addresses that channel instead: a slot
   * name, a raw DMX value, or a pattern stepping through slots. The arity
   * separates the two calls, since a wheel takes numbers and patterns as well
   * as names.
   *
   * @example
   *   wash.color(1, 0, 0)         // red on an RGB par
   *   wash.color(1, 0, 0, 0.3)    // red + a touch of white (RGBW)
   *   wash.color(sine(), 0, 0)    // animated red
   *   wash.color()                // full white
   *   head.color('open')          // a wheel slot, on a fixture that has one
   */
  color(
    ...args:
      | []
      | [color: Color]
      | [slot: PatternOrValue | string]
      | [r: PatternOrValue, g: PatternOrValue, b: PatternOrValue]
      | [r: PatternOrValue, g: PatternOrValue, b: PatternOrValue, w: PatternOrValue]
  ): void;
  /** Zero every light-emitting channel on the fixture (dim, RGB, RGBW,
   *  embedded strip pixels). Safe on every fixture type. */
  off(): void;
  /** Drive every light-emitting channel to full (1). For dim-RGB(W)
   *  fixtures this brings both the dimmer AND the colour channels to max. */
  full(): void;

  // Named channels: setter function OR nested StripInstance (for type: 'strip')
  [key: string]: unknown;
};

// ─── Named slots on selector channels ────────────────────────────────────────
//
// A moving head picks its colour, gobo and prism by driving one channel to a
// value inside a documented range. Without names, a scene reads
// `head.set('color', 37)` and the manual has to be open next to it.
//
// Slots are resolved at the setter, not in the tick loop, so nothing about the
// per-frame path changes: by the time a value reaches the buffer it is an
// ordinary number or an ordinary pattern.

/** The DMX value to send for a slot. A range aims at its middle. */
function slotValue(slot: ChannelSlot): number {
  if (typeof slot.value === 'number') return slot.value;
  const from = slot.from ?? 0;
  const to = slot.to ?? from;
  // The middle of the range, because manuals quote the edges and hardware
  // often treats the boundary as belonging to the neighbouring slot.
  return Math.round((from + to) / 2);
}

/** Slot name (case and space insensitive) → DMX value. */
function slotMap(slots: readonly ChannelSlot[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const s of slots) m.set(s.name.toLowerCase().replace(/[\s_-]/g, ''), slotValue(s));
  return m;
}

function slotKey(name: string): string {
  return name.toLowerCase().replace(/[\s_-]/g, '');
}

/**
 * Turn a value that may name a slot into one the DMX layer understands.
 *
 * Handles both a bare name and a pattern of names, so `head.color('red')` and
 * `head.color(mini('<red blue green>'))` both work. The pattern case wraps the
 * original rather than rebuilding it: each query maps the names it yields and
 * passes numbers through untouched.
 */
function resolveSlots(
  value: PatternOrValue | string,
  slots: readonly ChannelSlot[],
  what: string,
): PatternOrValue {
  const map = slotMap(slots);
  const names = (): string => slots.map((s) => s.name).join(', ');

  if (typeof value === 'string') {
    const hit = map.get(slotKey(value));
    if (hit === undefined) {
      throw new Error(`${what}: no slot named "${value}". Available: ${names()}.`);
    }
    return hit;
  }

  if (typeof value === 'number' || !isPatternLike(value)) return value as PatternOrValue;

  // A pattern that may carry slot names. Unknown names would otherwise reach
  // the buffer as a non-number and read as 0, which is a dark light and no
  // error, so they are reported the first time one appears.
  //
  // The mapped value is divided by 255 because the two value domains differ:
  // a bare number written to a channel is rescaled from 0-255 by the tick,
  // but a value arriving from a pattern is taken as an already-normalised
  // 0-1 level. Handing the raw slot number straight through put every slot
  // above 1, which clamps, so every named colour came out as full.
  const reported = new Set<string>();
  return {
    queryArc(begin: number, end: number) {
      return (value as PatternLike).queryArc(begin, end).map((hap: { value: unknown }) => {
        const v = (hap as { value: unknown }).value;
        if (typeof v !== 'string') return hap;
        const hit = map.get(slotKey(v));
        if (hit === undefined) {
          if (!reported.has(v)) {
            reported.add(v);
            console.error(`[gobo] ${what}: no slot named "${v}". Available: ${names()}.`);
          }
          return { ...hap, value: 0 };
        }
        return { ...hap, value: hit / 255 };
      });
    },
  };
}

/**
 * A callback that returned a colour means the same as one that returned its
 * three components.
 *
 * Only a branded colour is spread. An array is left exactly as it was, because
 * `[255, 0, 0]` is a raw DMX triple in the 0-255 domain and reading it as a
 * colour would clamp it to 1 and turn full red into almost nothing.
 */
function spreadIfColor(result: unknown): unknown {
  return isColor(result) ? [result.r, result.g, result.b] : result;
}

/** Whether every argument spells a colour, which is what separates a run of
 *  stops from the per-component `r, g, b` spelling. */
function everyArgIsColour(args: readonly unknown[]): boolean {
  return args.length > 0 && args.every((a) => toColorValue(a) !== null);
}

/** The message for a call that paints one position and was handed a run. */
function oneColourOnly(what: string, count: number): Error {
  return new Error(
    `${what}: takes one colour, not ${count}. Take one stop with warm[0], ` +
    `or put the palette in time with cat(...warm).slow(4).`,
  );
}

/** Local shape test, so this file does not need dmx.ts's private helper. */
function isPatternLike(v: unknown): v is PatternLike {
  try {
    return typeof (v as PatternLike)?.queryArc === 'function';
  } catch {
    return false;
  }
}

/**
 * Drive every light-emitting channel of a fixture to one level.
 *
 * Shared by .off() and .full(), which differ only in the level. Channels that
 * steer or shape rather than emit (pan, tilt, gobo, a slotted colour wheel)
 * are left where they are: an operator killing the lights mid-show wants the
 * rig to go dark, not to lose its aim and have to re-find it.
 *
 * A fixture with nothing to drive throws. It used to return quietly, which is
 * how a blinder's .off() could leave both bulbs lit and report success.
 */
function driveEmitters(
  inst: FixtureInstance,
  def: FixtureDef,
  level: 0 | 1,
  what: string,
): void {
  let driven = 0;
  for (const ch of def.channels) {
    if (!isEmitterChannel(ch)) continue;
    if (ch.type === 'strip') {
      // A strip channel is a nested strip instance; fill() covers every pixel
      // in one call, with as many values as that layout takes.
      const strip = inst[ch.name] as unknown as { fill: (...vs: number[]) => void } | undefined;
      if (strip && typeof strip.fill === 'function') {
        if (ch.pixelLayout === 'rgbw') strip.fill(level, level, level, level);
        else if (ch.pixelLayout === 'mono') strip.fill(level);
        else strip.fill(level, level, level);
        driven++;
      }
      continue;
    }
    inst.set(ch.name, level);
    driven++;
  }

  if (driven === 0) {
    throw new Error(
      `Fixture "${def.name}"${what}: no channel on this fixture emits light, so this call would do nothing. ` +
      `Channels: ${def.channels.map((c) => `${c.name} (${c.type})`).join(', ')}. ` +
      `Give an emitter channel type 'intensity', or name it for the colour it drives.`,
    );
  }
}

/**
 * What can be called on a fixture, as written.
 *
 * Named setters first, in channel order, then the generic helpers that exist
 * on every fixture. A strip channel is listed by the methods it answers to
 * rather than as a setter, because it is not one.
 *
 * Exported because the library panel and the hover tooltip both need to say
 * this, and two descriptions of one fixture would eventually disagree.
 */
export function fixtureCommands(def: FixtureDef): string[] {
  const out: string[] = [];
  for (const ch of def.channels) {
    if (ch.type === 'strip') {
      const v = ch.pixelLayout === 'rgbw' ? 'r,g,b,w' : ch.pixelLayout === 'mono' ? 'v' : 'r,g,b';
      const chase = ch.pixelLayout === 'mono' ? 'chase()' : 'chase(red)';
      out.push(`${ch.name}.fill(${v})`, `${ch.name}.${chase}`, `${ch.name}.each(fn)`);
      continue;
    }
    if (ch.slots !== undefined && ch.slots.length > 0) {
      // A slotted channel is picked by name, so show the names rather than a
      // value: they are the whole reason it is easier than the manual.
      const names = ch.slots.slice(0, 3).map((s) => `'${s.name}'`).join(' | ');
      const more = ch.slots.length > 3 ? ' | …' : '';
      out.push(`${ch.name}(${names}${more})`);
      continue;
    }
    out.push(`${ch.name}(v)`);
  }
  out.push('color(r,g,b)', 'full()', 'off()', 'set(name, v)', 'viz(kind)');
  return out;
}

/**
 * What can be called on a pixel strip, by pixel layout.
 *
 * The three strips answer to the same methods with different arities, so the
 * list is generated from the value shape rather than written out three times
 * and left to drift.
 */
/**
 * Method names on every fixture. A channel that shares one keeps its channel
 * behaviour reachable through .set(name, v) rather than taking the method.
 */
const RESERVED_METHODS = new Set([
  'set', 'color', 'off', 'full', 'viz',
  'channels', 'def', 'universe', 'startChannel', 'channelCount',
]);

/**
 * The absolute channel of a fixture-wide dimmer, if it has one.
 *
 * Named `dim`, or the only intensity channel: both spellings appear in real
 * definitions. Returns undefined when the fixture has several intensity
 * channels, because then none of them is "the" master and guessing would dim
 * the panel by something that does not dim the light.
 */
function masterDimmerChannel(def: FixtureDef, startChannel: number): number | undefined {
  const named = def.channels.find((c) => c.name === 'dim');
  if (named) return startChannel + named.offset;
  const intensities = def.channels.filter((c) => c.type === 'intensity');
  return intensities.length === 1 ? startChannel + intensities[0].offset : undefined;
}

export function stripCommands(layout: 'rgb' | 'rgbw' | 'mono'): string[] {
  const v = layout === 'rgbw' ? 'r,g,b,w' : layout === 'mono' ? 'v' : 'r,g,b';
  const out = [
    `fill(${v})`, `pixel(i,${v})`, `pixelXY(x,y,${v})`, `row(y,${v})`, `column(x,${v})`,
    'each(fn)', 'eachXY(fn)',
  ];
  // Mono cells have one channel, so there is no colour to name and no rainbow
  // to chase across them.
  out.push(layout === 'mono' ? 'chase()' : 'chase(red)');
  if (layout !== 'mono') {
    out.push('pixelGrid(rows)', 'red(v)', 'green(v)', 'blue(v)');
    if (layout === 'rgbw') out.push('white(v)');
    out.push('rainbowChase()');
  }
  // No off(): strips do not have one, unlike fixtures. `fill(0)` is the way,
  // and listing a method that is not there would be worse than listing none.
  out.push('viz(kind)');
  return out;
}

/**
 * Options common to the three strip constructors.
 *
 * The `sim*` fields exist for strips that belong to something bigger: a strip
 * channel inside a fixture def is the visible part of that fixture, so its
 * element in the sim panel should describe the fixture that owns it rather
 * than the anonymous run of channels underneath.
 */
/** Option keys a scene may pass to a strip constructor. The sim* fields are
 *  set by fixture() and screen() for their embedded strips, never by a scene,
 *  so they are deliberately absent. */
export const STRIP_OPTION_KEYS = ['columns', 'serpentine', 'origin'] as const;

/** Set by fixture() and screen() on the strip they build. Accepted, never
 *  advertised: a scene has no reason to pass one. */
const STRIP_INTERNAL_KEYS = [
  'simLabel', 'movement', 'skipSim', 'simFixtureId', 'simPatchChannel', 'simCommands', 'simMaster',
] as const;

export interface StripOptions extends StripGeometry {
  simLabel?: string;
  movement?: SimMovement;
  skipSim?: boolean;
  /** Owning fixture's patch id, when this strip is one channel of a fixture. */
  simFixtureId?: string;
  /** Owning fixture's start channel, which is not this strip's start. */
  simPatchChannel?: number;
  /** Owning fixture's full command list, replacing the strip's own. */
  simCommands?: string[];
  /** Absolute channel of a master dimmer the owning fixture puts over this
   *  strip, so the panel dims with it. */
  simMaster?: number;
}

/**
 * Load a fixture at a DMX address and return a named-channel setter object.
 *
 * @param startChannel  1-based DMX channel (first channel of the fixture). The
 *                      whole fixture must fit inside the universe. A patch
 *                      that would run past channel 512 throws rather than
 *                      dropping the channels that don't fit.
 * @param fixtureId     Built-in id ('rgbw', 'dim-rgb', 'moving-head-basic', …) or custom id
 * @param universe      DMX universe (default: 0). Art-Net / TouchDesigner
 *                      label the first universe as "Universe 0", so a node
 *                      configured for universe 0 works out of the box.
 *                      Pass 1, 2, 3, … to address additional universes. Note
 *                      sACN E1.31 requires universe ≥ 1.
 *
 * @example
 *   const par = fixture(1, 'rgb')
 *   par.red(sine())
 *   par.blue(0.5)
 *
 *   // Second universe
 *   const head = fixture(10, 'moving-head-basic', 1)
 *   head.pan(square().slow(4))
 *   head.dim(0.8)
 */
export function fixture(
  startChannel: number,
  fixtureId: string,
  universe = 0,
): FixtureInstance {
  const def = resolveFixture(fixtureId);

  // Patch-address guard, same contract as rgbStrip/rgbwStrip: a fixture that
  // does not fit the universe is a patching mistake, not something to clamp.
  // Clamping would light the channels that fit and drop the rest, which reads
  // as a broken fixture rather than a bad patch. Throwing surfaces the address
  // in the editor's error banner before the scene goes out.
  if (!Number.isInteger(universe) || universe < 0) {
    throw new Error(`fixture: universe must be a non-negative integer (got ${universe})`);
  }
  if (!Number.isInteger(startChannel) || startChannel < 1) {
    throw new Error(`fixture: startChannel must be an integer >= 1 (got ${startChannel})`);
  }
  const lastChannel = startChannel + def.channelCount - 1;
  if (lastChannel > 512) {
    throw new Error(
      `fixture: "${fixtureId}" (${def.channelCount} channels) starting at ${startChannel} would run to channel ${lastChannel}, which exceeds 512 by ${lastChannel - 512}. Move it to a lower address or split across universes.`,
    );
  }

  // A channel named `color` that has slots is a colour wheel, and .color()
  // dispatches a slot name to it. Resolved once, here, rather than per call.
  const slotChannel = def.channels.find(
    (c) => c.name === 'color' && c.slots !== undefined && c.slots.length > 0,
  )?.name;

  const inst: FixtureInstance = {
    def,
    universe,
    startChannel,

    set(channelName: string, ...args: [PatternOrValue?]): void {
      const ch = def.channels.find((c) => c.name === channelName);
      if (!ch) {
        throw new Error(
          `Fixture "${def.name}" has no channel "${channelName}". Available: ${def.channels.map((c) => c.name).join(', ')}`,
        );
      }
      if (ch.type === 'strip') {
        throw new Error(
          `Fixture "${def.name}" channel "${channelName}" is a pixel strip segment. Use .${channelName}.fill(r,g,b), .${channelName}.pixel(i, r, g, b), or .${channelName}.red(v) instead of .set().`,
        );
      }
      // Named for the channel rather than for set(), because the named setters
      // below all route through here and `.red()` is how it was written.
      const what = `.${channelName}()`;
      // A slotted channel accepts the slot's name as well as a raw level, so
      // resolve before the value contract is applied: a name is legitimate
      // here and would otherwise be rejected as a string.
      const raw = ch.slots !== undefined && ch.slots.length > 0
        ? resolveSlots(args[0] as PatternOrValue | string, ch.slots, what)
        : args[0];
      uni(universe, startChannel + ch.offset, channelValue(args.length === 0 ? [] : [raw], what));
    },

    slots(channelName: string): string[] {
      const ch = def.channels.find((c) => c.name === channelName);
      if (!ch) {
        throw new Error(
          `Fixture "${def.name}" has no channel "${channelName}". Available: ${def.channels.map((c) => c.name).join(', ')}`,
        );
      }
      return (ch.slots ?? []).map((s) => s.name);
    },

    channels(): string[] {
      return def.channels.map((c) => c.name);
    },

    viz(...kinds: VizKind[]): FixtureInstance {
      const list: VizKind[] = kinds.length > 0 ? kinds : ['color'];
      const { rgbw, dim } = extractChannelLayout(def);
      _vizRegistry.push({
        kinds: list,
        universe,
        startChannel,
        channelCount: def.channelCount,
        rgbw,
        dim,
      });
      return inst;
    },

    color(...args) {
      // A colour value spreads into the three components it already holds, so
      // `wash.color(red)` and `wash.color(pick('warm'))` reach the same place
      // as `wash.color(1, 0, 0)`. Checked before the wheel branch below, which
      // also takes a single argument.
      // One light is one position, so a run of stops has nowhere to go.
      // Refused rather than quietly painted with the first one, and refused
      // BEFORE the single-colour branch below, which would otherwise take the
      // first argument and drop the rest without saying so.
      if (isPalette(args[0])) {
        throw oneColourOnly(`Fixture "${def.name}".color()`, (args[0] as unknown[]).length);
      }
      if (args.length > 1 && everyArgIsColour(args)) {
        throw oneColourOnly(`Fixture "${def.name}".color()`, args.length);
      }
      if (isColor(args[0])) {
        const c = args[0] as Color;
        inst.color(c.r as PatternOrValue, c.g as PatternOrValue, c.b as PatternOrValue);
        return;
      }
      // A colour wheel is picked by slot name, by raw DMX value, or by a
      // pattern stepping through slots, and a def is free to call that channel
      // `color`. On a fixture that has one, a single argument is that channel;
      // a mix is three, and full is none. Counting arguments separates them
      // where inspecting types would not: a wheel takes numbers and patterns
      // too, so only the arity says which call this is.
      //
      // This stays ahead of the colour-token rule below. On a fixture with a
      // slotted wheel, `head.color(mini('<red blue>'))` means slot names, which
      // is the documented case resolveSlots() exists for.
      if (args.length === 1 && slotChannel !== undefined) {
        inst.set(slotChannel, args[0] as PatternOrValue | string);
        return;
      }
      // A pattern of colour names on a fixture with no wheel: one colour that
      // changes with the pattern, so `wash.color(mini('r - g - b'))` works.
      if (args.length === 1 && isPatternLike(args[0])) {
        const c = readColor(args, `Fixture "${def.name}".color()`);
        inst.color(c.r as PatternOrValue, c.g as PatternOrValue, c.b as PatternOrValue);
        return;
      }
      // Skip channels that don't exist on this fixture so the same call
      // is portable across rgb / rgbw / dim-rgbw / moving-head etc. Each
      // channel is set independently; patterns and constants both flow
      // through inst.set() the same way as a named-channel setter would.
      const [r, g, b] = channelValues(args.slice(0, 3), ['r', 'g', 'b'], '.color()');
      const has = (name: string): boolean =>
        def.channels.some((c) => c.name === name && c.type !== 'strip');
      let painted = 0;
      const paint = (name: string, v: PatternOrValue): void => {
        if (!has(name)) return;
        inst.set(name, v);
        painted++;
      };
      paint('red', r);
      paint('green', g);
      paint('blue', b);
      // White stays opt-in: a three-argument call is a colour mix that the
      // fixture's own white channel would wash out.
      if (args.length > 3) paint('white', channelValue([args[3]], '.color() w'));
      // A fixture with no colour channels at all cannot honour this, and
      // returning quietly would leave the scene looking correct and the light
      // unchanged.
      if (painted === 0) {
        throw new Error(
          `Fixture "${def.name}".color(): this fixture has no red/green/blue channels. ` +
          `Channels: ${def.channels.map((c) => c.name).join(', ')}.`,
        );
      }
    },

    off() {
      driveEmitters(inst, def, 0, '.off()');
    },

    full() {
      driveEmitters(inst, def, 1, '.full()');
    },
  } as FixtureInstance;

  // Resolve movement channels once so both the embedded strip (if any)
  // and the globe registration (if any) can share the same SimMovement.
  const movement = collectMovement(def, startChannel);

  // Attach named accessors.
  //   - Scalar channels become setter functions: par.red(v)
  //   - 'strip' channels become nested Rgb/Rgbw StripInstance objects:
  //         bar.pixels.fill(r, g, b)      // pixelLayout: 'rgb'  (default)
  //         bar.pixels.fill(r, g, b, w)   // pixelLayout: 'rgbw'
  for (const ch of def.channels) {
    if (ch.type === 'strip') {
      const pixelCount = ch.pixelCount ?? 0;
      if (pixelCount < 1) {
        throw new Error(
          `Fixture "${def.name}" channel "${ch.name}" is type 'strip' but has no valid pixelCount (got ${ch.pixelCount}).`,
        );
      }
      const stripStart = startChannel + ch.offset;
      const stripOpts: StripOptions = {
        simLabel: `${fixtureId} · ${ch.name}`,
        movement,
        // This strip is the fixture's visible part, so its tooltip speaks for
        // the whole fixture: the call that patched it and every channel it
        // answers to, not just the pixels. Without this a 154-channel wash
        // hovers as an anonymous run of pixels with its strobe channels
        // nowhere in sight.
        simFixtureId: fixtureId,
        simPatchChannel: startChannel,
        simCommands: fixtureCommands(def),
        // A master dimmer over the whole fixture dims its pixels too, on the
        // rig and therefore on screen.
        simMaster: masterDimmerChannel(def, startChannel),
        // A grid declared on the channel travels with the fixture, so a scene
        // says pixelXY without repeating the wash's dimensions.
        columns: ch.columns,
        serpentine: ch.serpentine,
        origin: ch.origin,
      };
      inst[ch.name] =
        ch.pixelLayout === 'rgbw'
          ? rgbwStrip(stripStart, pixelCount, universe, stripOpts)
          : ch.pixelLayout === 'mono'
            ? monoStrip(stripStart, pixelCount, universe, stripOpts)
            : rgbStrip(stripStart, pixelCount, universe, stripOpts);
    } else {
      // A channel must not take a generic method's name away from it. A def
      // with a channel called `color`, which is what the docs recommend for a
      // colour wheel, used to overwrite the r,g,b mixer: `head.color(1, 0, 0)`
      // then drove the wheel channel to full and dropped the green and blue
      // arguments, with no error and the wrong light. The generic call stays,
      // and dispatches to the channel when handed a slot name; anything else
      // named after a method is still reachable through .set().
      if (RESERVED_METHODS.has(ch.name)) continue;
      // Rest parameter, not a single value: a call with no argument has to stay
      // distinguishable from one that passed undefined, so `par.red()` can mean
      // full while `par.red(somethingBroken)` still reports.
      inst[ch.name] = (...args: [(PatternOrValue | string)?]) => inst.set(ch.name, ...args);
    }
  }

  // ── Register with the sim panel ──
  // If the fixture has a strip channel the embedded rgbStrip/rgbwStrip call
  // above registers the visible element, so skip the "main" globe here to
  // avoid showing an extra ghost face for dim/strobe control channels.
  // Otherwise, pick a renderer based on whichever standard channels the
  // def exposes (rgb/w preferred; fall back to just a dimmer).
  const hasStrip = def.channels.some((c) => c.type === 'strip');
  if (!hasStrip) {
    const byName = (n: string): number | undefined =>
      def.channels.find((c) => c.name === n)?.offset;
    const r = byName('red');
    const g = byName('green');
    const b = byName('blue');
    const w = byName('white');
    const dimOffset = byName('dim');
    const hasColor =
      r !== undefined || g !== undefined || b !== undefined || w !== undefined;

    if (hasColor) {
      registerSimFixture({
        label: fixtureId,
        type: def.name,
        universe,
        startChannel,
        channelCount: def.channelCount,
        fixtureId,
        commands: fixtureCommands(def),
        movement,
        render: { kind: 'globe-rgbw', r, g, b, w, dim: dimOffset },
      });
    } else if (dimOffset !== undefined) {
      registerSimFixture({
        label: fixtureId,
        type: def.name,
        universe,
        startChannel,
        channelCount: def.channelCount,
        fixtureId,
        commands: fixtureCommands(def),
        movement,
        render: { kind: 'globe-dim', dim: dimOffset },
      });
    }
    // else: nothing visible to render (no colour, no dim), so nothing is
    // added to the sim. Movement-only fixtures (rare) need a colour or dim
    // channel to get an element to track.
  }

  return inst;
}

/** List all available fixture ids (built-in + custom). */
export function listFixtures(): string[] {
  return [
    ...Object.keys(BUILT_IN_FIXTURES),
    ...Object.keys(_customFixtures),
  ];
}

// ─── RGB pixel strip ──────────────────────────────────────────────────────────
// A variable-length fixture: N pixels × 3 channels (R, G, B).
// Not stored as a FixtureDef because the channel count is user-specified.

// ─── Strip geometry ──────────────────────────────────────────────────────────
//
// A 12x4 pixel wash is one strip channel as far as DMX is concerned, and every
// scene that wanted a column sweep had to write `i % 12` and
// `Math.floor(i / 12)` by hand. Declaring the width once moves that arithmetic
// into the fixture, where it can also account for how the thing is wired.
//
// A plain line of pixels is the same model with one row, so nothing needs a
// special case: width defaults to pixelCount and height to 1.

export interface StripGeometry {
  /** Pixels per row. Defaults to the whole strip, i.e. a single row. */
  columns?: number;
  /**
   * The wiring snakes, so odd rows run right to left. Physically the norm on
   * matrices built from a single strip folded back on itself, and the only way
   * to tell is from the fixture, so it has to be declared.
   */
  serpentine?: boolean;
  /**
   * Which physical corner DMX pixel 0 sits in. Default 'top-left', the way an
   * image is read.
   *
   * Plenty of fixtures scan the other way. A cheap matrix strobe can start at
   * the bottom right and run right to left then upward, which makes every
   * scene written against it mirrored and upside down unless the fixture says
   * so. Declaring the corner means `pixelXY(0, 0)` is the top left of the
   * picture on every fixture, whatever its wiring does.
   *
   * A single-row strip uses only the horizontal half, so 'top-right' is how
   * you reverse one.
   */
  origin?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
}

/**
 * Resolve a strip's grid, and give it a way to turn (x, y) into a pixel index.
 *
 * Returned as a small object rather than free functions so both strip kinds
 * share one implementation of the serpentine flip, which is the part that is
 * easy to get subtly wrong and invisible until the hardware is in front of you.
 */
/** Picture-order to wire-order map, for the sim panel. */
function simGrid(geo: { width: number; height: number; index(x: number, y: number): number }): SimGrid {
  const order: number[] = [];
  for (let y = 0; y < geo.height; y++) {
    for (let x = 0; x < geo.width; x++) order.push(geo.index(x, y));
  }
  return { columns: geo.width, rows: geo.height, order };
}

function resolveGeometry(pixelCount: number, geo: StripGeometry, what: string) {
  const columns = geo.columns ?? pixelCount;
  if (!Number.isInteger(columns) || columns < 1) {
    throw new Error(`${what}: columns must be an integer >= 1 (got ${geo.columns})`);
  }
  if (pixelCount % columns !== 0) {
    throw new Error(
      `${what}: ${pixelCount} pixels do not divide into rows of ${columns}. ` +
      `A partial row would put the grid out of step with the hardware, so pick a width that divides ${pixelCount}.`,
    );
  }
  const width = columns;
  const height = pixelCount / columns;
  const serpentine = geo.serpentine === true;

  const origin = geo.origin ?? 'top-left';
  const ORIGINS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
  if (!ORIGINS.includes(origin)) {
    throw new Error(`${what}: origin must be one of ${ORIGINS.join(', ')} (got ${geo.origin})`);
  }
  const flipX = origin.endsWith('right');
  const flipY = origin.startsWith('bottom');

  return {
    width,
    height,
    /**
     * Grid position to pixel index.
     *
     * Two independent facts about the hardware, applied in order:
     *
     *   origin      where pixel 0 physically is, which fixes the direction the
     *               run travels in both axes
     *   serpentine  whether the run then folds back on alternate rows
     *
     * Callers always address the picture: (0, 0) is its top left. Everything
     * below converts that to whatever order the strip is actually wired in.
     */
    index(x: number, y: number): number {
      if (!Number.isInteger(x) || x < 0 || x >= width) {
        throw new Error(`${what}: x ${x} out of range [0, ${width - 1}]`);
      }
      if (!Number.isInteger(y) || y < 0 || y >= height) {
        throw new Error(`${what}: y ${y} out of range [0, ${height - 1}]`);
      }
      // Into wire space: which row and column of the RUN this picture position
      // falls on.
      let wx = flipX ? width - 1 - x : x;
      const wy = flipY ? height - 1 - y : y;
      // A serpentine run reverses every other row of the run itself, so this
      // is measured on wy rather than on the caller's y.
      if (serpentine && wy % 2 === 1) wx = width - 1 - wx;
      return wy * width + wx;
    },
    /**
     * Picture-sequential position to pixel index on the wire.
     *
     * The whole API speaks in picture order: position 0 is the top left, and
     * counting runs along the top row. Only the geometry knows where that
     * lands on the wire. Without this, .pixel(i) and .each() would address raw
     * DMX order while pixelXY addressed the picture, so a reversed strip would
     * come out corrected through one method and not the other.
     *
     * With the default origin and no serpentine this is the identity, so
     * nothing written before grids existed changes.
     */
    seq(i: number): number {
      return this.index(i % width, Math.floor(i / width));
    },
    /**
     * Grid position to picture-sequential position.
     *
     * Deliberately NOT the wire index: callers hand this to .pixel(), which
     * applies the wiring itself. Doing it here as well would transform twice
     * and land on the wrong pixel whenever the origin is not the default.
     */
    pos(x: number, y: number): number {
      if (!Number.isInteger(x) || x < 0 || x >= width) {
        throw new Error(`${what}: x ${x} out of range [0, ${width - 1}]`);
      }
      if (!Number.isInteger(y) || y < 0 || y >= height) {
        throw new Error(`${what}: y ${y} out of range [0, ${height - 1}]`);
      }
      return y * width + x;
    },
  };
}

/**
 * Chainable result of `strip.pixelGrid(values)`. The grid is already
 * applied (default: explicit pixels, rest at 0). Call one of the methods
 * to overwrite with a fill mode:
 *
 *   .repeat()  tile the input pattern across the strip
 *   .hold()    keep the last input pixel for every pixel after it
 *   .mirror()  reflect the input back so the pattern reads symmetrically
 *
 * The chain methods return `void`: the operation is destructive, not a
 * transform you can keep chaining onto.
 */
export interface PixelGridFill {
  repeat(): void;
  hold(): void;
  mirror(): void;
}

export interface StripInstance {
  readonly universe: number;
  readonly startChannel: number;
  readonly pixelCount: number;
  /** Total DMX channels consumed (pixelCount * 3). */
  readonly channelCount: number;

  /** Pixels across one row. A plain line of pixels is width = pixelCount. */
  readonly width: number;
  /** Rows. A plain line of pixels is height = 1. */
  readonly height: number;

  /**
   * Set one pixel by grid position. x runs left to right, y top to bottom,
   * both 0-indexed. Same value shapes as pixel().
   *
   * @example
   *   wash.pixels.pixelXY(3, 1, 1, 0, 0)   // column 3, row 1, red
   */
  pixelXY(
    x: number,
    y: number,
    ...args:
      | []
      | [brightness: PatternOrValue]
      | [r: PatternOrValue, g: PatternOrValue, b: PatternOrValue]
  ): void;

  /** Set every pixel in one row (0-indexed from the top). */
  row(
    y: number,
    ...args:
      | []
      | [brightness: PatternOrValue]
      | [r: PatternOrValue, g: PatternOrValue, b: PatternOrValue]
  ): void;

  /** Set every pixel in one column (0-indexed from the left). */
  column(
    x: number,
    ...args:
      | []
      | [brightness: PatternOrValue]
      | [r: PatternOrValue, g: PatternOrValue, b: PatternOrValue]
  ): void;

  /**
   * Run a callback per pixel with its grid position.
   *
   * The callback gets `(x, y, w, h)`. Return a level or `[r, g, b]`, the same
   * as each(). This is each() for anything where the shape matters: a sweep
   * across the columns, a wipe down the rows, a diagonal.
   *
   * @example
   *   wash.pixels.eachXY((x, y, w) => sine().early(x / w).slow(4))
   */
  eachXY(
    fn: (x: number, y: number, w: number, h: number) => PatternOrValue | PatternOrValue[],
  ): void;

  /**
   * Set every pixel to the same r/g/b. Each arg may be a pattern or number.
   * Omit all three for full white.
   */
  fill(...args:
    | []
    | [color: Color]
    | [r: PatternOrValue, g: PatternOrValue, b: PatternOrValue]): void;

  /**
   * Set a single pixel (0-indexed). Three shapes:
   *   pixel(i)                     → monochrome at full
   *   pixel(i, brightness)         → monochrome (R = G = B = brightness)
   *   pixel(i, r, g, b)            → full RGB
   * The monochrome form is the usual chase-loop shorthand: it saves
   * repeating the same pattern three times.
   */
  pixel(
    index: number,
    ...args:
      | []
      | [brightness: PatternOrValue]
      | [r: PatternOrValue, g: PatternOrValue, b: PatternOrValue]
  ): void;

  /**
   * Set pixels from an array-of-rows. Each inner array is one pixel:
   * `[r, g, b]`. Missing channels default to 0. Pixels beyond the input
   * stay at 0; chain .repeat() / .hold() / .mirror() to fill them.
   *
   * @example
   *   strip.pixelGrid([
   *     [1, 0, 0],   // red
   *     [0, 1, 0],   // green
   *     [0, 0, 1],   // blue
   *   ]).repeat()
   */
  pixelGrid(rows: PatternOrValue[][]): PixelGridFill;

  /**
   * Run a callback per pixel. Return a single value for a monochrome
   * chase (applied to R=G=B) or `[r, g, b]` for full colour control.
   * The callback receives `(phase, i, count)`, where phase is `i / count`,
   * the common chase parameter you'd otherwise hand-compute every time.
   *
   * @example
   *   strip.each(p => cosine().early(p).slow(2).range(-7, 1))   // monochrome walk
   *   strip.each(p => [sine().early(p), 0, cosine().early(p)])  // colour chase
   */
  each(fn: (phase: number, i: number, count: number) => PatternOrValue | PatternOrValue[]): void;

  /** Set just the red channel on every pixel. Omit the value for full. */
  red(...v: [PatternOrValue?]): void;
  /** Set just the green channel on every pixel. Omit the value for full. */
  green(...v: [PatternOrValue?]): void;
  /** Set just the blue channel on every pixel. Omit the value for full. */
  blue(...v: [PatternOrValue?]): void;

  /**
   * Opt into one or more inline editor visualizations for this strip. The
   * editor scans the source for `.viz(...)` call sites and drops a live
   * mini-preview widget at the end of that line. Default kind is 'strip'.
   *
   * @example
   *   const strip = rgbStrip(12, 10).viz('strip')
   */
  viz(...kinds: VizKind[]): StripInstance;

  /**
   * Built-in rainbow chase: a single bright pixel sweeps across the strip
   * while its colour slowly walks through the full hue wheel. Options:
   * `speed` (beats/pass), `narrow` (peak sharpness), `rainbowSpeed`
   * (beats/cycle), `packets` (simultaneous chase dots). See 'effects' in
   * the docs for the mechanics.
   */
  /**
   * A band of colour travelling along the strip. No callback needed.
   *
   * @example
   *   strip.chase(red)                       // one lap every 4 cycles
   *   strip.chase(blue, { cycles: 2 })       // faster
   *   strip.chase(white, { width: 0.2 })     // tight moving band
   *   strip.chase(1, 0.4, 0)                 // a mix, spelled as .color() spells it
   */
  chase(color: Color, opts?: ChaseOptions): ChaseHandle;
  chase(r: number, g: number, b: number, opts?: ChaseOptions): ChaseHandle;
  rainbowChase(opts?: RainbowChaseOptions): void;
}

/**
 * Create an RGB pixel strip starting at a DMX address.
 *
 * Each pixel is 3 channels (R, G, B), laid out contiguously. A 40-pixel strip
 * occupies 120 channels. The pattern engine queries each channel on every tick,
 * so per-pixel patterns (e.g. phase-shifted chases) work just like PARs.
 *
 * Pass `columns` to treat it as a grid: a 48-pixel wash wired 12 across is
 * `rgbStrip(1, 48, 0, { columns: 12 })`, and gains pixelXY / row / column /
 * eachXY. Without it the strip is a single row, which the same methods still
 * work on.
 *
 * @param startChannel  1-based DMX channel of the first pixel's red channel
 * @param pixelCount    Number of pixels (>= 1)
 * @param universe      DMX universe (default 0, matching Art-Net convention)
 * @param opts          columns / serpentine for a grid; sim metadata
 *
 * @example
 *   const strip = rgbStrip(1, 40)
 *   strip.fill(sine().slow(4), 0, cosine().slow(4))
 *
 *   // Per-pixel chase
 *   strip.each(p => sine().early(p).slow(4))
 *
 *   // As a grid
 *   const wash = rgbStrip(1, 48, 0, { columns: 12 })
 *   wash.eachXY((x, y, w) => sine().early(x / w).slow(4))
 */
export function rgbStrip(
  startChannel: number,
  pixelCount: number,
  universe = 0,
  opts: StripOptions = {},
): StripInstance {
  if (!Number.isFinite(pixelCount) || pixelCount < 1) {
    throw new Error(`rgbStrip: pixelCount must be >= 1 (got ${pixelCount})`);
  }
  checkOptions(opts as Record<string, unknown>, STRIP_OPTION_KEYS, 'rgbStrip()', STRIP_INTERNAL_KEYS);
  const geo = resolveGeometry(pixelCount, opts, 'rgbStrip');
  const channelCount = pixelCount * 3;
  const lastChannel = startChannel + channelCount - 1;
  if (startChannel < 1) {
    throw new Error(`rgbStrip: startChannel must be >= 1 (got ${startChannel})`);
  }
  if (lastChannel > 512) {
    throw new Error(
      `rgbStrip: ${pixelCount} pixels starting at ${startChannel} would run to channel ${lastChannel}, which exceeds 512. Split across universes.`,
    );
  }

  const inst: StripInstance = {
    universe,
    startChannel,
    pixelCount,
    channelCount,
    width: geo.width,
    height: geo.height,

    pixelXY(x, y, ...args) {
      inst.pixel(geo.pos(x, y), ...(args as []));
    },

    row(y, ...args) {
      for (let x = 0; x < geo.width; x++) inst.pixel(geo.pos(x, y), ...(args as []));
    },

    column(x, ...args) {
      for (let y = 0; y < geo.height; y++) inst.pixel(geo.pos(x, y), ...(args as []));
    },

    eachXY(fn) {
      for (let y = 0; y < geo.height; y++) {
        for (let x = 0; x < geo.width; x++) {
          const result = spreadIfColor(fn(x, y, geo.width, geo.height));
          const i = geo.index(x, y);
          const base = startChannel + i * 3;
          if (Array.isArray(result)) {
            for (let c = 0; c < 3; c++) {
              uni(universe, base + c, c < result.length
                ? channelValue([result[c]], `.eachXY() (${x}, ${y}) ${'rgb'[c]}`)
                : 0);
            }
          } else {
            const v = channelValue([result], `.eachXY() (${x}, ${y})`);
            uni(universe, base,     v);
            uni(universe, base + 1, v);
            uni(universe, base + 2, v);
          }
        }
      }
    },

    fill(...args) {
      // Nothing at all is full, and three or more values that are not colours
      // is the per-component spelling. Both keep the rung they always had, so
      // the documented `.fill(sine(), 0, cosine())` cannot be captured below.
      if (args.length === 0 || (args.length >= 3 && !everyArgIsColour(args))) {
        const [r, g, b] = channelValues(args, ['r', 'g', 'b'], '.fill()');
        for (let i = 0; i < pixelCount; i++) {
          const base = startChannel + i * 3;
          uni(universe, base,     r);
          uni(universe, base + 1, g);
          uni(universe, base + 2, b);
        }
        return;
      }
      // A colour, several colours, a palette, or a pattern of colour tokens.
      // Several stops spread across the strip, endpoint to endpoint. One stop
      // repeats, by identity, so `.fill(red)` writes what it always wrote.
      const run = readColorRun(args, pixelCount, '.fill()');
      for (let i = 0; i < pixelCount; i++) {
        const base = startChannel + i * 3;
        const c = run[i];
        const [r, g, b] = channelValues([c.r, c.g, c.b], ['r', 'g', 'b'], `.fill() pixel ${i}`);
        uni(universe, base,     r);
        uni(universe, base + 1, g);
        uni(universe, base + 2, b);
      }
    },

    pixel(index, ...args) {
      if (!Number.isInteger(index) || index < 0 || index >= pixelCount) {
        throw new Error(
          `rgbStrip: pixel index ${index} out of range [0, ${pixelCount - 1}]`,
        );
      }
      // One position, so a run of stops has nowhere to go. Refused rather than
      // quietly painted with the first one.
      if (isPalette(args[0])) {
        throw oneColourOnly(`.pixel(${index})`, (args[0] as unknown[]).length);
      }
      // A colour spreads into its components. Left alone it would be taken as
      // the monochrome shortcut below and the channel writer would refuse it.
      if (args.length === 1 && isColor(args[0])) {
        const c = args[0] as Color;
        args = [c.r, c.g, c.b] as unknown as typeof args;
      }
      // Monochrome shortcut: pixel(i, value) replicates `value` across R/G/B.
      // Saves repeating the brightness pattern three times in chase loops.
      // pixel(i) on its own is that shortcut at full.
      const mono = args.length < 2;
      const [r, g, b] = mono
        ? Array(3).fill(channelValue(args, `.pixel(${index})`))
        : channelValues(args, ['r', 'g', 'b'], `.pixel(${index})`);
      const base = startChannel + geo.seq(index) * 3;
      uni(universe, base,     r);
      uni(universe, base + 1, g);
      uni(universe, base + 2, b);
    },

    pixelGrid(values) {
      // Initial application: explicit pixels, rest blank. The chain
      // methods (repeat/hold/mirror) overwrite with the same values
      // under a different fill mode.
      applyPixelGrid(values, 3, pixelCount, startChannel, universe, 'none');
      return {
        repeat: () => applyPixelGrid(values, 3, pixelCount, startChannel, universe, 'repeat'),
        hold:   () => applyPixelGrid(values, 3, pixelCount, startChannel, universe, 'hold'),
        mirror: () => applyPixelGrid(values, 3, pixelCount, startChannel, universe, 'mirror'),
      };
    },

    each(fn) {
      for (let i = 0; i < pixelCount; i++) {
        const phase = i / pixelCount;
        const result = spreadIfColor(fn(phase, i, pixelCount));
        // Picture order in, wire order out, so a chase runs left to right on
        // the light whatever direction the strip is wired in.
        const base = startChannel + geo.seq(i) * 3;
        if (Array.isArray(result)) {
          // A short array is a colour written to the channels it names, so the
          // rest stay off. Only the values present are checked.
          uni(universe, base,     result.length > 0 ? channelValue([result[0]], `.each() pixel ${i} r`) : 0);
          uni(universe, base + 1, result.length > 1 ? channelValue([result[1]], `.each() pixel ${i} g`) : 0);
          uni(universe, base + 2, result.length > 2 ? channelValue([result[2]], `.each() pixel ${i} b`) : 0);
        } else {
          // Single value → monochrome (R = G = B = value). A callback that
          // returns nothing is a missing return rather than a request for
          // full, so this one takes the value as given.
          const v = channelValue([result], `.each() pixel ${i}`);
          uni(universe, base,     v);
          uni(universe, base + 1, v);
          uni(universe, base + 2, v);
        }
      }
    },

    red(...args) {
      const v = channelValue(args, '.red()');
      for (let i = 0; i < pixelCount; i++) {
        uni(universe, startChannel + i * 3, v);
      }
    },

    green(...args) {
      const v = channelValue(args, '.green()');
      for (let i = 0; i < pixelCount; i++) {
        uni(universe, startChannel + i * 3 + 1, v);
      }
    },

    blue(...args) {
      const v = channelValue(args, '.blue()');
      for (let i = 0; i < pixelCount; i++) {
        uni(universe, startChannel + i * 3 + 2, v);
      }
    },

    viz(...kinds: VizKind[]): StripInstance {
      const list: VizKind[] = kinds.length > 0 ? kinds : ['strip'];
      _vizRegistry.push({
        kinds: list,
        universe,
        startChannel,
        channelCount,
        pixelCount,
        channelsPerPixel: 3,
      });
      return inst;
    },

    chase(...args: unknown[]): ChaseHandle {
      const { stops, opts } = splitChaseArgs(args);
      return chaseWithHandle(inst, stops, opts);
    },

    rainbowChase(opts: RainbowChaseOptions = {}): void {
      rainbowChaseImpl(inst, opts);
    },
  };
  // A screen light draws itself, so it opts out of the hardware panel rather
  // than showing up there as a fixture nobody patched.
  if (opts.skipSim !== true) registerSimFixture({
    label: opts.simLabel ?? `rgbStrip ×${pixelCount}`,
    type: 'RGB pixel strip',
    universe,
    startChannel,
    channelCount,
    fixtureId: opts.simFixtureId,
    patchChannel: opts.simPatchChannel,
    master: opts.simMaster,
    commands: opts.simCommands ?? stripCommands('rgb'),
    movement: opts.movement,
    render: { kind: 'strip-rgb', pixelCount, grid: simGrid(geo) },
  });
  return inst;
}

// ─── Mono pixel strip ────────────────────────────────────────────────────────
//
// One channel per cell. A segmented white strobe strip, a bar of plain
// dimmers, a row of single-colour cells: all the same shape, and none of them
// expressible as rgb or rgbw without wasting two thirds of the channels and
// getting the addressing wrong.
//
// Same geometry surface as the colour strips, so a chase written for one works
// here; only the value shape differs, since there is nothing to mix.

export interface MonoStripInstance {
  readonly universe: number;
  readonly startChannel: number;
  readonly pixelCount: number;
  /** Total DMX channels consumed (one per pixel). */
  readonly channelCount: number;
  /** Cells across one row. A plain line is width = pixelCount. */
  readonly width: number;
  /** Rows. A plain line is height = 1. */
  readonly height: number;

  /** Set every cell to the same level. Omit the value for full. */
  fill(...v: [PatternOrValue?]): void;
  /** Set one cell by index. Omit the value for full. */
  pixel(index: number, ...v: [PatternOrValue?]): void;
  /** Set one cell by grid position. Omit the value for full. */
  pixelXY(x: number, y: number, ...v: [PatternOrValue?]): void;
  /** Set every cell in one row. Omit the value for full. */
  row(y: number, ...v: [PatternOrValue?]): void;
  /** Set every cell in one column. Omit the value for full. */
  column(x: number, ...v: [PatternOrValue?]): void;
  /** Run a callback per cell; `(phase, i, count)` as on the colour strips. */
  each(fn: (phase: number, i: number, count: number) => PatternOrValue): void;
  /** Run a callback per cell with its grid position `(x, y, w, h)`. */
  eachXY(fn: (x: number, y: number, w: number, h: number) => PatternOrValue): void;
  /**
   * A band of light travelling along the cells. No colour to name, because
   * every cell here is one channel.
   *
   * @example
   *   cells.chase()                    // one lap every 4 cycles
   *   cells.chase({ width: 0.2 })      // a tight moving band
   */
  chase(opts?: ChaseOptions): ChaseHandle;
  /** Opt into an inline editor visualization (default kind 'strip'). */
  viz(...kinds: VizKind[]): MonoStripInstance;
}

/**
 * Create a strip of single-channel cells.
 *
 * @example
 *   const seg = monoStrip(147, 8)           // eight white strobe segments
 *   seg.each(p => mini('1 - - -').early(p))
 */
export function monoStrip(
  startChannel: number,
  pixelCount: number,
  universe = 0,
  opts: StripOptions = {},
): MonoStripInstance {
  if (!Number.isFinite(pixelCount) || pixelCount < 1) {
    throw new Error(`monoStrip: pixelCount must be >= 1 (got ${pixelCount})`);
  }
  if (startChannel < 1) {
    throw new Error(`monoStrip: startChannel must be >= 1 (got ${startChannel})`);
  }
  const channelCount = pixelCount;
  const lastChannel = startChannel + channelCount - 1;
  if (lastChannel > 512) {
    throw new Error(
      `monoStrip: ${pixelCount} cells starting at ${startChannel} would run to channel ${lastChannel}, which exceeds 512. Split across universes.`,
    );
  }
  checkOptions(opts as Record<string, unknown>, STRIP_OPTION_KEYS, 'monoStrip()', STRIP_INTERNAL_KEYS);
  const geo = resolveGeometry(pixelCount, opts, 'monoStrip');

  const set = (i: number, v: PatternOrValue): void => uni(universe, startChannel + i, v);

  const inst: MonoStripInstance = {
    universe,
    startChannel,
    pixelCount,
    channelCount,
    width: geo.width,
    height: geo.height,

    fill(...v) {
      // A single-channel strip has one level per pixel and no colour to put
      // anywhere. Refused by name, because a palette left to fall through
      // lands in the options bag and comes back as "no options named 0, 1, 2",
      // which teaches the wrong thing entirely.
      if (isColor(v[0]) || isPalette(v[0])) {
        throw new Error(
          `.fill(): a single-channel strip has no colour. Write a level with .fill(0.5), ` +
          `or drive the pixels one at a time with .each().`,
        );
      }
      const level = channelValue(v, '.fill()');
      for (let i = 0; i < pixelCount; i++) set(i, level);
    },

    pixel(index, ...v) {
      if (!Number.isInteger(index) || index < 0 || index >= pixelCount) {
        throw new Error(`monoStrip: pixel index ${index} out of range [0, ${pixelCount - 1}]`);
      }
      // A single-channel strip has one level per pixel and no colour to put
      // anywhere. Refused by name, because a palette left to fall through
      // lands in the options bag and comes back as "no options named 0, 1, 2",
      // which teaches the wrong thing entirely.
      if (isColor(v[0]) || isPalette(v[0])) {
        throw new Error(
          `.pixel(): a single-channel strip has no colour. Write a level with .pixel(i, 0.5), ` +
          `or drive the pixels one at a time with .each().`,
        );
      }
      set(geo.seq(index), channelValue(v, `.pixel(${index})`));
    },

    pixelXY(x, y, ...v) {
      set(geo.index(x, y), channelValue(v, `.pixelXY(${x}, ${y})`));
    },

    row(y, ...v) {
      const level = channelValue(v, `.row(${y})`);
      for (let x = 0; x < geo.width; x++) set(geo.index(x, y), level);
    },

    column(x, ...v) {
      const level = channelValue(v, `.column(${x})`);
      for (let y = 0; y < geo.height; y++) set(geo.index(x, y), level);
    },

    each(fn) {
      for (let i = 0; i < pixelCount; i++) {
        set(geo.seq(i), channelValue([fn(i / pixelCount, i, pixelCount)], `.each() cell ${i}`));
      }
    },

    eachXY(fn) {
      for (let y = 0; y < geo.height; y++) {
        for (let x = 0; x < geo.width; x++) {
          set(geo.index(x, y), channelValue([fn(x, y, geo.width, geo.height)], `.eachXY() (${x}, ${y})`));
        }
      }
    },

    chase(opts: ChaseOptions = {}): ChaseHandle {
      // Named here too. Left to fall through, a colour or a palette would be
      // read as the options bag and come back as "no options named 0, 1, 2",
      // which points at the wrong thing entirely.
      if (isColor(opts) || isPalette(opts)) {
        throw new Error(
          '.chase(): a single-channel strip has no colour, so the chase takes only options. ' +
          'Write .chase({ cycles: 2 }), or drive the pixels one at a time with .each().',
        );
      }
      return chaseWithHandle(inst, null, opts);
    },

    viz(...kinds: VizKind[]): MonoStripInstance {
      _vizRegistry.push({
        kinds: kinds.length > 0 ? kinds : ['strip'],
        universe,
        startChannel,
        channelCount,
        pixelCount,
        channelsPerPixel: 1,
      });
      return inst;
    },
  };

  if (opts.skipSim !== true) registerSimFixture({
    label: opts.simLabel ?? `monoStrip ×${pixelCount}`,
    type: 'Single-channel cells',
    universe,
    startChannel,
    channelCount,
    fixtureId: opts.simFixtureId,
    patchChannel: opts.simPatchChannel,
    master: opts.simMaster,
    commands: opts.simCommands ?? stripCommands('mono'),
    movement: opts.movement,
    render: { kind: 'strip-mono', pixelCount, grid: simGrid(geo) },
  });
  return inst;
}

// ─── RGBW pixel strip ─────────────────────────────────────────────────────────
// Same shape as rgbStrip but 4 channels per pixel (R, G, B, W). Matches the
// layout used by RGBW pixel bars. The dedicated white channel on top of RGB
// gives warm/cool highlights without fighting the colour mix.

export interface RgbwStripInstance {
  readonly universe: number;
  readonly startChannel: number;
  readonly pixelCount: number;
  /** Total DMX channels consumed (pixelCount * 4). */
  readonly channelCount: number;

  /** Pixels across one row. A plain line of pixels is width = pixelCount. */
  readonly width: number;
  /** Rows. A plain line of pixels is height = 1. */
  readonly height: number;

  /** Set one pixel by grid position, x left to right and y top to bottom. */
  pixelXY(
    x: number,
    y: number,
    ...args:
      | []
      | [brightness: PatternOrValue]
      | [r: PatternOrValue, g: PatternOrValue, b: PatternOrValue, w: PatternOrValue]
  ): void;

  /** Set every pixel in one row (0-indexed from the top). */
  row(
    y: number,
    ...args:
      | []
      | [brightness: PatternOrValue]
      | [r: PatternOrValue, g: PatternOrValue, b: PatternOrValue, w: PatternOrValue]
  ): void;

  /** Set every pixel in one column (0-indexed from the left). */
  column(
    x: number,
    ...args:
      | []
      | [brightness: PatternOrValue]
      | [r: PatternOrValue, g: PatternOrValue, b: PatternOrValue, w: PatternOrValue]
  ): void;

  /**
   * Run a callback per pixel with its grid position `(x, y, w, h)`. Return a
   * level or `[r, g, b, w]`. See {@link StripInstance.eachXY}.
   */
  eachXY(
    fn: (x: number, y: number, w: number, h: number) => PatternOrValue | PatternOrValue[],
  ): void;

  /** Set every pixel to the same r/g/b/w. Omit all four for full. */
  fill(
    ...args:
      | []
      | [color: Color]
      | [r: PatternOrValue, g: PatternOrValue, b: PatternOrValue, w: PatternOrValue]
  ): void;

  /**
   * Set a single pixel (0-indexed). Three shapes:
   *   pixel(i)                         → monochrome at full
   *   pixel(i, brightness)             → monochrome (R = G = B = brightness, W = 0)
   *   pixel(i, r, g, b, w)             → full RGBW
   * The monochrome form is the usual chase-loop shorthand: it saves
   * repeating the same pattern four times.
   */
  pixel(
    index: number,
    ...args:
      | []
      | [brightness: PatternOrValue]
      | [r: PatternOrValue, g: PatternOrValue, b: PatternOrValue, w: PatternOrValue]
  ): void;

  /**
   * Set pixels from an array-of-rows. Each inner array is one pixel:
   * `[r, g, b, w]`. Missing channels default to 0. Pixels beyond the
   * input stay at 0; chain .repeat() / .hold() / .mirror() to fill them.
   *
   * @example
   *   strip.pixelGrid([
   *     [1, 0, 0, 0],   // red
   *     [0, 0, 1, 0],   // blue
   *   ]).mirror()
   */
  pixelGrid(rows: PatternOrValue[][]): PixelGridFill;

  /**
   * Run a callback per pixel. Return a single value for a monochrome
   * chase (applied to R=G=B with W=0) or `[r, g, b, w]` for full colour
   * control. The callback receives `(phase, i, count)`, where phase is
   * `i / count`, the common chase parameter you'd otherwise hand-compute.
   *
   * @example
   *   bar.pixels.each(p => cosine().early(p).slow(2).range(-7, 1))           // walk
   *   bar.pixels.each(p => [0, sine().early(p), cosine().early(p), 0])       // chase
   */
  each(fn: (phase: number, i: number, count: number) => PatternOrValue | PatternOrValue[]): void;

  /** Set just the red channel on every pixel. Omit the value for full. */
  red(...v: [PatternOrValue?]): void;
  /** Set just the green channel on every pixel. Omit the value for full. */
  green(...v: [PatternOrValue?]): void;
  /** Set just the blue channel on every pixel. Omit the value for full. */
  blue(...v: [PatternOrValue?]): void;
  /** Set just the white channel on every pixel. Omit the value for full. */
  white(...v: [PatternOrValue?]): void;

  /** Opt into an inline editor visualization (default kind 'strip'). */
  viz(...kinds: VizKind[]): RgbwStripInstance;

  /** Built-in rainbow chase. See {@link StripInstance.rainbowChase}. */
  /**
   * A band of colour travelling along the strip. No callback needed.
   *
   * @example
   *   strip.chase(red)                       // one lap every 4 cycles
   *   strip.chase(blue, { cycles: 2 })       // faster
   *   strip.chase(white, { width: 0.2 })     // tight moving band
   *   strip.chase(1, 0.4, 0)                 // a mix, spelled as .color() spells it
   */
  chase(color: Color, opts?: ChaseOptions): ChaseHandle;
  chase(r: number, g: number, b: number, opts?: ChaseOptions): ChaseHandle;
  rainbowChase(opts?: RainbowChaseOptions): void;
}

/**
 * Create an RGBW pixel strip starting at a DMX address. 4 channels per pixel
 * laid out R, G, B, W. 8 pixels = 32 channels, 16 pixels = 64 channels, etc.
 *
 * @param startChannel  1-based DMX channel of the first pixel's red channel
 * @param pixelCount    Number of pixels (>= 1)
 * @param universe      DMX universe (default 0)
 */
export function rgbwStrip(
  startChannel: number,
  pixelCount: number,
  universe = 0,
  opts: StripOptions = {},
): RgbwStripInstance {
  if (!Number.isFinite(pixelCount) || pixelCount < 1) {
    throw new Error(`rgbwStrip: pixelCount must be >= 1 (got ${pixelCount})`);
  }
  checkOptions(opts as Record<string, unknown>, STRIP_OPTION_KEYS, 'rgbwStrip()', STRIP_INTERNAL_KEYS);
  const geo = resolveGeometry(pixelCount, opts, 'rgbwStrip');
  const STRIDE = 4;
  const channelCount = pixelCount * STRIDE;
  const lastChannel = startChannel + channelCount - 1;
  if (startChannel < 1) {
    throw new Error(`rgbwStrip: startChannel must be >= 1 (got ${startChannel})`);
  }
  if (lastChannel > 512) {
    throw new Error(
      `rgbwStrip: ${pixelCount} pixels starting at ${startChannel} would run to channel ${lastChannel}, which exceeds 512. Split across universes.`,
    );
  }

  const inst: RgbwStripInstance = {
    universe,
    startChannel,
    pixelCount,
    channelCount,

    width: geo.width,
    height: geo.height,

    pixelXY(x, y, ...args) {
      inst.pixel(geo.pos(x, y), ...(args as []));
    },

    row(y, ...args) {
      for (let x = 0; x < geo.width; x++) inst.pixel(geo.pos(x, y), ...(args as []));
    },

    column(x, ...args) {
      for (let y = 0; y < geo.height; y++) inst.pixel(geo.pos(x, y), ...(args as []));
    },

    eachXY(fn) {
      for (let y = 0; y < geo.height; y++) {
        for (let x = 0; x < geo.width; x++) {
          const result = spreadIfColor(fn(x, y, geo.width, geo.height));
          const base = startChannel + geo.index(x, y) * STRIDE;
          if (Array.isArray(result)) {
            for (let c = 0; c < STRIDE; c++) {
              uni(universe, base + c, c < result.length
                ? channelValue([result[c]], `.eachXY() (${x}, ${y}) ${'rgbw'[c]}`)
                : 0);
            }
          } else {
            // Monochrome, white held off, matching each().
            const v = channelValue([result], `.eachXY() (${x}, ${y})`);
            uni(universe, base,     v);
            uni(universe, base + 1, v);
            uni(universe, base + 2, v);
            uni(universe, base + 3, 0);
          }
        }
      }
    },

    fill(...args) {
      // A colour value spreads into its components, so `strip.fill(red)` and
      // `strip.fill(pick('warm'))` reach the same place as fill(1, 0, 0, 0).
      //
      // A colour is three components, and the fourth is a dedicated white LED,
      // which a three-component mix has no business touching: that is the rule
      // .color() has always followed on an RGBW fixture. So this writes r, g
      // and b and leaves w wherever the scene last put it. `.full()` is still
      // the call that lights every emitter.
      // Several stops spread across the strip; one repeats by identity.
      if (args.length > 0 && (everyArgIsColour(args) || isPalette(args[0]) || isPatternLike(args[0]))) {
        const run = readColorRun(args, pixelCount, '.fill()');
        for (let i = 0; i < pixelCount; i++) {
          const base = startChannel + i * STRIDE;
          const c = run[i];
          const [r, g, b] = channelValues([c.r, c.g, c.b], ['r', 'g', 'b'], `.fill() pixel ${i}`);
          uni(universe, base,     r);
          uni(universe, base + 1, g);
          uni(universe, base + 2, b);
        }
        return;
      }
      const [r, g, b, w] = channelValues(args, ['r', 'g', 'b', 'w'], '.fill()');
      for (let i = 0; i < pixelCount; i++) {
        const base = startChannel + i * STRIDE;
        uni(universe, base,     r);
        uni(universe, base + 1, g);
        uni(universe, base + 2, b);
        uni(universe, base + 3, w);
      }
    },

    pixel(index, ...args) {
      if (!Number.isInteger(index) || index < 0 || index >= pixelCount) {
        throw new Error(
          `rgbwStrip: pixel index ${index} out of range [0, ${pixelCount - 1}]`,
        );
      }
      if (isPalette(args[0])) {
        throw oneColourOnly(`.pixel(${index})`, (args[0] as unknown[]).length);
      }
      // A colour is three components, and the fourth is a dedicated white LED
      // that a three-component mix has no business touching. So W is left
      // where the scene last put it, which is the rule .fill() states above.
      if (args.length === 1 && isColor(args[0])) {
        const c = args[0] as Color;
        const [r, g, b] = channelValues([c.r, c.g, c.b], ['r', 'g', 'b'], `.pixel(${index})`);
        const base = startChannel + geo.seq(index) * STRIDE;
        uni(universe, base,     r);
        uni(universe, base + 1, g);
        uni(universe, base + 2, b);
        return;
      }
      // Monochrome shortcut: pixel(i, value) sets R = G = B = value with
      // W = 0. The four-arg call is the verbose form for explicit colour
      // control. pixel(i) on its own is the shortcut at full.
      const mono = args.length < 2;
      const [r, g, b, w] = mono
        ? [...Array(3).fill(channelValue(args, `.pixel(${index})`)), 0]
        : channelValues(args, ['r', 'g', 'b', 'w'], `.pixel(${index})`);
      const base = startChannel + geo.seq(index) * STRIDE;
      uni(universe, base,     r);
      uni(universe, base + 1, g);
      uni(universe, base + 2, b);
      uni(universe, base + 3, w);
    },

    pixelGrid(values) {
      applyPixelGrid(values, 4, pixelCount, startChannel, universe, 'none');
      return {
        repeat: () => applyPixelGrid(values, 4, pixelCount, startChannel, universe, 'repeat'),
        hold:   () => applyPixelGrid(values, 4, pixelCount, startChannel, universe, 'hold'),
        mirror: () => applyPixelGrid(values, 4, pixelCount, startChannel, universe, 'mirror'),
      };
    },

    each(fn) {
      for (let i = 0; i < pixelCount; i++) {
        const phase = i / pixelCount;
        const result = spreadIfColor(fn(phase, i, pixelCount));
        // Picture order in, wire order out. See rgbStrip.each().
        const base = startChannel + geo.seq(i) * STRIDE;
        if (Array.isArray(result)) {
          // A short array names the channels it sets; the rest stay off.
          for (let c = 0; c < STRIDE; c++) {
            uni(universe, base + c, c < result.length ? channelValue([result[c]], `.each() pixel ${i} ${'rgbw'[c]}`) : 0);
          }
        } else {
          // Single value → monochrome (R = G = B = value, W = 0). A callback
          // that returns nothing is a missing return rather than a request for
          // full, so this one takes the value as given.
          const v = channelValue([result], `.each() pixel ${i}`);
          uni(universe, base,     v);
          uni(universe, base + 1, v);
          uni(universe, base + 2, v);
          uni(universe, base + 3, 0);
        }
      }
    },

    red(...a)   { const v = channelValue(a, '.red()');   for (let i = 0; i < pixelCount; i++) uni(universe, startChannel + i * STRIDE,     v); },
    green(...a) { const v = channelValue(a, '.green()'); for (let i = 0; i < pixelCount; i++) uni(universe, startChannel + i * STRIDE + 1, v); },
    blue(...a)  { const v = channelValue(a, '.blue()');  for (let i = 0; i < pixelCount; i++) uni(universe, startChannel + i * STRIDE + 2, v); },
    white(...a) { const v = channelValue(a, '.white()'); for (let i = 0; i < pixelCount; i++) uni(universe, startChannel + i * STRIDE + 3, v); },

    viz(...kinds: VizKind[]): RgbwStripInstance {
      const list: VizKind[] = kinds.length > 0 ? kinds : ['strip'];
      _vizRegistry.push({
        kinds: list,
        universe,
        startChannel,
        channelCount,
        pixelCount,
        channelsPerPixel: STRIDE,
      });
      return inst;
    },

    chase(...args: unknown[]): ChaseHandle {
      const { stops, opts } = splitChaseArgs(args);
      return chaseWithHandle(inst, stops, opts);
    },

    rainbowChase(opts: RainbowChaseOptions = {}): void {
      rainbowChaseImpl(inst, opts);
    },
  };
  if (opts.skipSim !== true) registerSimFixture({
    label: opts.simLabel ?? `rgbwStrip ×${pixelCount}`,
    type: 'RGBW pixel strip',
    universe,
    startChannel,
    channelCount,
    fixtureId: opts.simFixtureId,
    patchChannel: opts.simPatchChannel,
    master: opts.simMaster,
    commands: opts.simCommands ?? stripCommands('rgbw'),
    movement: opts.movement,
    render: { kind: 'strip-rgbw', pixelCount, grid: simGrid(geo) },
  });
  return inst;
}

// ─── Groups ──────────────────────────────────────────────────────────────────
//
// The one thing that cannot be written at any length otherwise: a single move
// across a mixed rig. A phase ramp over a strip is `strip.each(…)`, over a
// bar's pixels is `bar.pixels.each(…)`, and over two pars is two hand-written
// offsets. Three vocabularies for one gesture, and no way at all to run one
// ramp through all of them in order.
//
// A group is a flat list of things that can be lit, and it answers the same
// verbs a fixture does. The counting rule is the only thing to remember:
//
//   a fixture      one element, however many channels it has
//   a strip        one element per pixel
//
// so `group(washA, washB, bar.pixels)` is 2 + however many pixels, in the
// order written. Pass the fixture to move it as a unit, pass its `.pixels` to
// move the pixels.

/** Anything group() accepts. Groups nest, and flatten when they do. */
export type GroupMember =
  | FixtureInstance
  | StripInstance
  | RgbwStripInstance
  | MonoStripInstance
  | GroupInstance;

/**
 * One addressable element of a group: a whole fixture, or one pixel.
 *
 * Named roles rather than channel numbers, so a par's `red` and a pixel's
 * first channel answer to the same word. That equivalence is the entire point
 * of the type.
 */
interface GroupCell {
  /** Roles this element can actually set. */
  roles: ReadonlySet<string>;
  set(role: string, value: PatternOrValue): void;
  /**
   * Overall brightness, however this element expresses one: a dimmer if it has
   * one, otherwise its colour channels together. What a single-value `each()`
   * callback drives.
   */
  level(value: PatternOrValue): void;
}

/** Colour roles, in the order the array form of `each()` uses. */
const COLOUR_ROLES = ['red', 'green', 'blue', 'white'] as const;

function isStrip(v: unknown): v is StripInstance | RgbwStripInstance {
  const s = v as StripInstance;
  return typeof s?.pixelCount === 'number' && typeof s?.fill === 'function';
}

function isFixtureInstance(v: unknown): v is FixtureInstance {
  const f = v as FixtureInstance;
  return typeof f?.set === 'function' && typeof f?.channels === 'function';
}

function isGroup(v: unknown): v is GroupInstance {
  return (v as GroupInstance)?.[GROUP_BRAND] === true;
}

/** Marks a group so nested groups can be recognised without instanceof. */
const GROUP_BRAND = Symbol.for('gobo.group');

/** One pixel of a strip, presented as a cell. */
function pixelCell(
  universe: number,
  base: number,
  stride: number,
): GroupCell {
  // A one-channel cell has no colour to speak of: it is a level, and the only
  // honest role for it is white, so a group asking for red skips it rather
  // than lighting it a colour it cannot produce.
  if (stride === 1) {
    return {
      roles: new Set(['white']),
      set(role, value) {
        if (role === 'white') uni(universe, base, value);
      },
      level(value) {
        uni(universe, base, value);
      },
    };
  }
  const roles = new Set(COLOUR_ROLES.slice(0, stride === 4 ? 4 : 3));
  return {
    roles,
    set(role, value) {
      const offset = COLOUR_ROLES.indexOf(role as (typeof COLOUR_ROLES)[number]);
      if (offset < 0 || offset >= stride) return;
      uni(universe, base + offset, value);
    },
    level(value) {
      // Matches what strip.each() already does with a single value: R = G = B,
      // and a white channel held off so it does not wash out the mix.
      uni(universe, base,     value);
      uni(universe, base + 1, value);
      uni(universe, base + 2, value);
      if (stride === 4) uni(universe, base + 3, 0);
    },
  };
}

/** A whole fixture, presented as a cell. */
function fixtureCell(inst: FixtureInstance): GroupCell {
  const scalars = new Set(
    inst.def.channels.filter((c) => c.type !== 'strip').map((c) => c.name),
  );
  // A fixture with a built-in strip still answers to `red`: the group sets the
  // role on the fixture's own channel if it has one, and on every pixel of
  // every embedded strip. Passing the fixture means "move this as one thing",
  // which for a pixel bar means all its pixels together.
  const strips = inst.def.channels
    .filter((c) => c.type === 'strip')
    .map((c) => inst[c.name] as StripInstance | RgbwStripInstance)
    .filter(isStrip);

  const roles = new Set(scalars);
  for (const s of strips) {
    roles.add('red');
    roles.add('green');
    roles.add('blue');
    if (typeof (s as RgbwStripInstance).white === 'function') roles.add('white');
  }

  const setOn = (role: string, value: PatternOrValue): void => {
    if (scalars.has(role)) inst.set(role, value);
    for (const s of strips) {
      const fn = (s as unknown as Record<string, (v: PatternOrValue) => void>)[role];
      if (typeof fn === 'function') fn.call(s, value);
    }
  };

  return {
    roles,
    set: setOn,
    level(value) {
      // A dimmer is what "brightness" means on a fixture that has one, and
      // leaving the colour alone is the whole reason to prefer it: the look
      // survives the fade. Only a fixture with no dimmer falls back to
      // driving its colour channels together.
      if (scalars.has('dim')) {
        inst.set('dim', value);
        return;
      }
      let lit = false;
      for (const role of ['red', 'green', 'blue'] as const) {
        if (roles.has(role)) {
          setOn(role, value);
          lit = true;
        }
      }
      if (!lit && roles.has('white')) setOn('white', value);
    },
  };
}

export interface GroupInstance {
  /** Marks this as a group. Present so nested groups flatten. */
  readonly [GROUP_BRAND]: true;
  /** How many elements the group has, counting each pixel separately. */
  readonly size: number;
  /** The members as passed in, before flattening. */
  readonly members: readonly GroupMember[];

  /** Set a role on every element that has one. Omit the value for full. */
  set(role: string, ...value: [PatternOrValue?]): void;
  /** Set red on everything that has a red. Omit the value for full. */
  red(...v: [PatternOrValue?]): void;
  /** Set green on everything that has a green. Omit the value for full. */
  green(...v: [PatternOrValue?]): void;
  /** Set blue on everything that has a blue. Omit the value for full. */
  blue(...v: [PatternOrValue?]): void;
  /** Set white on everything that has a white. Omit the value for full. */
  white(...v: [PatternOrValue?]): void;
  /** Set the dimmer on everything that has one. Omit the value for full. */
  dim(...v: [PatternOrValue?]): void;

  /**
   * Set r/g/b (and optionally w) across the group, skipping roles a given
   * element does not have. Omit everything for full white.
   */
  color(
    ...args:
      | []
      | [r: PatternOrValue, g: PatternOrValue, b: PatternOrValue]
      | [r: PatternOrValue, g: PatternOrValue, b: PatternOrValue, w: PatternOrValue]
  ): void;

  /** Zero every light-emitting role across the group. */
  off(): void;
  /** Drive every light-emitting role across the group to full. */
  full(): void;

  /**
   * Run a callback per element, in the order the members were written.
   *
   * The callback gets `(phase, i, count)` with `phase = i / count`, the same
   * signature the strips already use, so a chase written for one strip works
   * unchanged across a whole rig. Return a single value for brightness, or
   * `[r, g, b]` / `[r, g, b, w]` for colour.
   *
   * @example
   *   const rig = group(washA, washB, bar.pixels, strip)
   *   rig.each(p => sine().early(p).slow(4))
   */
  each(fn: (phase: number, i: number, count: number) => PatternOrValue | PatternOrValue[]): void;
}

/**
 * What can be called on a group. Fixed, unlike a fixture's: a group answers to
 * roles rather than channels, and skips members that do not have the one asked
 * for.
 */
export function groupCommands(): string[] {
  return [
    'red(v)', 'green(v)', 'blue(v)', 'white(v)', 'dim(v)',
    'color(r,g,b)', 'set(role, v)', 'each(fn)', 'full()', 'off()', 'size',
  ];
}

/**
 * Treat several fixtures, strips and pixels as one addressable thing.
 *
 * @example
 *   const rig = group(washA, washB, bar.pixels)
 *   rig.red(sine().slow(4))                  // same verb as a single fixture
 *   rig.each(p => sine().early(p).slow(4))   // one ramp across the whole rig
 */
export function group(...members: GroupMember[]): GroupInstance {
  if (members.length === 0) {
    throw new Error('group: needs at least one fixture, strip or group');
  }

  const cells: GroupCell[] = [];
  const collect = (m: GroupMember, path: string): void => {
    if (isGroup(m)) {
      for (const inner of m.members) collect(inner, path);
      return;
    }
    if (isStrip(m)) {
      const stride = m.channelCount / m.pixelCount;
      for (let i = 0; i < m.pixelCount; i++) {
        cells.push(pixelCell(m.universe, m.startChannel + i * stride, stride));
      }
      return;
    }
    if (isFixtureInstance(m)) {
      cells.push(fixtureCell(m));
      return;
    }
    throw new Error(
      `group: ${path} is not a fixture, a strip or a group. Pass what fixture() / rgbStrip() / rgbwStrip() returned, or a fixture's .pixels.`,
    );
  };
  members.forEach((m, i) => collect(m, `argument ${i + 1}`));

  /**
   * Apply a role to every element that has it.
   *
   * Skipping elements that lack the role is what makes one line work across a
   * mixed rig. A role no element has is a different thing: nothing would
   * happen and nothing would say so, which is the failure this whole pass
   * exists to remove, so that one throws.
   */
  const applyRole = (role: string, value: PatternOrValue, what: string): void => {
    let applied = 0;
    for (const cell of cells) {
      if (cell.roles.has(role)) {
        cell.set(role, value);
        applied++;
      }
    }
    if (applied === 0) {
      const available = [...new Set(cells.flatMap((c) => [...c.roles]))].sort().join(', ');
      throw new Error(
        `${what}: no member of this group has a "${role}" channel. Available across the group: ${available || 'none'}.`,
      );
    }
  };

  const roleSetter = (role: string) => (...v: [PatternOrValue?]) => {
    applyRole(role, channelValue(v, `group.${role}()`), `group.${role}()`);
  };

  const inst: GroupInstance = {
    [GROUP_BRAND]: true,
    size: cells.length,
    members,

    set(role, ...v) {
      applyRole(role, channelValue(v, `group.set(${JSON.stringify(role)})`), `group.set(${JSON.stringify(role)})`);
    },

    red: roleSetter('red'),
    green: roleSetter('green'),
    blue: roleSetter('blue'),
    white: roleSetter('white'),
    dim: roleSetter('dim'),

    color(...args) {
      // A colour, a palette, or a pattern of colour names. A run of stops
      // spreads across the members in order, so `rig.color(warm)` puts the
      // first colour on the first light and the last on the last. A single
      // colour repeats, which is also what makes `rig.color(red)` work: it
      // used to reach channelValues as one argument and come back asking for
      // all three of r, g and b.
      if (args.length > 0 && (everyArgIsColour(args) || isPalette(args[0]) || isPatternLike(args[0]))) {
        const run = readColorRun(args, cells.length, 'group.color()');
        let painted = 0;
        cells.forEach((cell, i) => {
          const c = run[i];
          for (const [role, value] of [['red', c.r], ['green', c.g], ['blue', c.b]] as const) {
            if (!cell.roles.has(role)) continue;
            cell.set(role, channelValue([value], `group.color() ${role}`));
            painted++;
          }
        });
        if (painted === 0) {
          throw new Error('group.color(): no member of this group has a colour channel.');
        }
        return;
      }
      const [r, g, b] = channelValues(args.slice(0, 3), ['r', 'g', 'b'], 'group.color()');
      // Unlike a single role, a colour that lands on nothing is worth
      // reporting once for the call rather than three times for its parts, so
      // these are counted together.
      let applied = 0;
      const paint = (role: string, value: PatternOrValue): void => {
        for (const cell of cells) {
          if (cell.roles.has(role)) {
            cell.set(role, value);
            applied++;
          }
        }
      };
      paint('red', r);
      paint('green', g);
      paint('blue', b);
      if (args.length > 3) paint('white', channelValue([args[3]], 'group.color() w'));
      if (applied === 0) {
        throw new Error('group.color(): no member of this group has a colour channel.');
      }
    },

    off() {
      for (const cell of cells) {
        for (const role of cell.roles) {
          if (role === 'dim' || (COLOUR_ROLES as readonly string[]).includes(role)) {
            cell.set(role, 0);
          }
        }
      }
    },

    full() {
      for (const cell of cells) {
        for (const role of cell.roles) {
          if (role === 'dim' || (COLOUR_ROLES as readonly string[]).includes(role)) {
            cell.set(role, 1);
          }
        }
      }
    },

    each(fn) {
      const count = cells.length;
      for (let i = 0; i < count; i++) {
        const result = spreadIfColor(fn(i / count, i, count));
        if (Array.isArray(result)) {
          // The array names roles positionally, r/g/b/w, and stops where it
          // stops: [1, 0, 0] leaves white alone rather than zeroing it.
          for (let c = 0; c < result.length && c < COLOUR_ROLES.length; c++) {
            const role = COLOUR_ROLES[c];
            if (cells[i].roles.has(role)) {
              cells[i].set(role, channelValue([result[c]], `group.each() element ${i} ${role}`));
            }
          }
        } else {
          cells[i].level(channelValue([result], `group.each() element ${i}`));
        }
      }
    },
  };

  return inst;
}

// ─── Effect helpers (strip methods) ──────────────────────────────────────────
// Higher-level scene recipes exposed as methods on the strip instances. They
// need access to the waveform factories (sine / cosine), which live in the
// eval sandbox, so eval.ts injects them here via setStripEffectWaveforms()
// once strudel is loaded. rainbowChase() called before that is a no-op rather
// than a thrown error, since the setup is otherwise automatic.

/**
 * Spelled the way .chase() spells the same three ideas.
 *
 * They used to be `speed`, `narrow` and `packets` here and `cycles`, `width`
 * and `waves` next door, which made reaching for the neighbour's word the
 * likeliest mistake on the surface. `narrow` was also inverted against
 * `width`: bigger meant less lit, where width is the fraction that is.
 */
export interface RainbowChaseOptions {
  /** Cycles for one lap of the strip (default 2). Bigger is slower. */
  cycles?: number;
  /** How much of the strip is lit at once, 0 to 1 (default 0.11). */
  width?: number;
  /** Crests on the strip at once (default 1). */
  waves?: number;
  /** Cycles for one full turn of the hue wheel (default 12). */
  hue?: number;
}

// The waveform types are `any` because sine() / cosine() return values carry
// chain methods added dynamically by strudel's prototype, which don't fit the
// static PatternLike interface.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _sineFactory: (() => any) | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _cosineFactory: (() => any) | null = null;

/**
 * Inject the waveform factories. Called from eval.ts right after strudel
 * is set up.
 */
export function setStripEffectWaveforms(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sine: () => any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cosine: () => any,
): void {
  _sineFactory = sine;
  _cosineFactory = cosine;
}

export interface ChaseOptions {
  /** Cycles for one full lap of the strip (default 4). Bigger is slower. */
  cycles?: number;
  /** Travel the other way: right to left, or bottom to top with `down`. */
  reverse?: boolean;
  /**
   * How much of the strip is lit at once, 0 to 1 (default 0.5). At 1 it is a
   * smooth swell with no dark part; small values give a tight moving band.
   */
  width?: number;
  /** Crests on the strip at once (default 1). */
  waves?: number;
  /** Run top to bottom down the rows, instead of left to right across the
   *  columns. Needs a grid. */
  down?: boolean;
  /**
   * Start the chase this many cycles ahead, so two of them can run out of step
   * with each other. A negative number starts it later.
   *
   * This is an option rather than a `.early()` on the end of the call, because
   * `.early()` belongs to patterns and a chase is not one: it is a command that
   * writes every channel on the strip. `strip.chase(green).early(1)` reads as
   * though it should work and cannot.
   */
  early?: number;
}

/**
 * Split a chase call into its colour and its options.
 *
 * Both spellings of a mix land here, so `.chase(red)`, `.chase(1, 0, 0)` and
 * `.chase(red, { cycles: 2 })` all read the same way as `.color(1, 0, 0)`
 * does. The options bag is whichever trailing argument is a plain object.
 */
function splitChaseArgs(args: readonly unknown[]): { stops: Color[]; opts: ChaseOptions } {
  const last = args[args.length - 1];
  // An array is a palette and a pattern answers queries, so neither is the
  // options bag. Without the pattern test .chase(mini('r g')) would have its
  // only argument read as options and come back asking for a colour.
  const hasOpts =
    typeof last === 'object' && last !== null &&
    !Array.isArray(last) && !isColor(last) && !isPatternLike(last);
  const colorArgs = hasOpts ? args.slice(0, -1) : args;
  return {
    stops: readColorStops(colorArgs, '.chase()'),
    opts: (hasOpts ? last : {}) as ChaseOptions,
  };
}

/**
 * A band of one colour travelling along a strip, without writing a function.
 *
 * The same thing `.eachXY((x, y, w) => [sine.early(x / w).slow(4), 0, 0])`
 * does, which is the shape of every chase and the shape most people cannot
 * write from memory. Arrow functions, a phase expressed as a fraction of the
 * width, and a waveform chained three deep are a lot to know before your first
 * moving light.
 */

/**
 * What `.chase()` hands back.
 *
 * A chase is a command that writes every channel on the strip, not a pattern,
 * so `.slow()` and `.early()` had nothing to chain onto and threw a raw
 * TypeError. People reach for those verbs anyway, twice in one week here, and
 * telling them the option bag exists is losing an argument with the language
 * they already know.
 *
 * So the verbs work, by meaning what they mean: each returns a fresh handle
 * with one option changed and re-applies the chase. Re-applying overwrites the
 * same channel definitions, so the last spelling of a chain is what runs, and
 * they compose in any order.
 */
export interface ChaseHandle {
  /** Longer lap: .slow(2) takes twice as many cycles. */
  slow(n: number): ChaseHandle;
  /** Shorter lap. */
  fast(n: number): ChaseHandle;
  /** Start this many cycles ahead. */
  early(n: number): ChaseHandle;
  /** Start this many cycles behind. */
  late(n: number): ChaseHandle;
  /** The other way: right to left, or bottom to top with .down(). */
  reverse(): ChaseHandle;
  /** Along the rows instead of the columns. */
  down(): ChaseHandle;
  /** How much of the strip is lit at once, 0 to 1. */
  width(n: number): ChaseHandle;
  /** Crests on the strip at once. */
  waves(n: number): ChaseHandle;
}

/** Apply a chase and hand back the handle that can restate it. */
function chaseWithHandle(
  strip: StripInstance | RgbwStripInstance | MonoStripInstance,
  stops: readonly Color[] | null,
  opts: ChaseOptions,
): ChaseHandle {
  chaseImpl(strip, stops, opts);
  const next = (change: ChaseOptions): ChaseHandle =>
    chaseWithHandle(strip, stops, { ...opts, ...change });
  return {
    slow: (n) => next({ cycles: (opts.cycles ?? 4) * n }),
    fast: (n) => next({ cycles: (opts.cycles ?? 4) / n }),
    early: (n) => next({ early: (opts.early ?? 0) + n }),
    late: (n) => next({ early: (opts.early ?? 0) - n }),
    reverse: () => next({ reverse: !opts.reverse }),
    down: () => next({ down: true }),
    width: (n) => next({ width: n }),
    waves: (n) => next({ waves: n }),
  };
}

export const CHASE_OPTION_KEYS = ['cycles', 'width', 'waves', 'reverse', 'down', 'early'] as const;

function chaseImpl(
  strip: StripInstance | RgbwStripInstance | MonoStripInstance,
  stops: readonly Color[] | null,
  opts: ChaseOptions,
): void {
  checkOptions(opts as Record<string, unknown>, CHASE_OPTION_KEYS, '.chase()');
  const sine = _sineFactory;
  if (!sine) return;

  const cycles = opts.cycles ?? 4;
  const waves = opts.waves ?? 1;
  const width = Math.min(1, Math.max(0.02, opts.width ?? 0.5));
  // range(lo, 1) on a 0..1 sine: everything below zero is clamped away at the
  // channel, so a lower floor leaves a narrower lit band.
  const lo = 1 - 1 / width;

  const count = opts.down ? strip.height : strip.width;
  const brightAt = (step: number): unknown => {
    // Negative, so a cell further along the strip runs LATER and the crest
    // travels left to right, or top to bottom with `down`. Positive made each
    // successive cell lead the one before it, which ran the whole thing
    // backwards: correct as a wave, and the wrong way round as a light.
    const phase = ((step * waves) / count) * (opts.reverse ? 1 : -1);
    // Per-cell phase goes on before .slow(), so it is a fraction of one lap.
    // The scene's own offset goes on after, so `early: 1` is one cycle of real
    // time, which is what .early() means everywhere else.
    const wave = sine().early(phase).slow(cycles);
    return (opts.early ? wave.early(opts.early) : wave).range(lo, 1);
  };

  for (let y = 0; y < strip.height; y++) {
    for (let x = 0; x < strip.width; x++) {
      const step = opts.down ? y : x;
      const bright = brightAt(step);
      if (stops === null) {
        (strip as MonoStripInstance).pixelXY(x, y, bright as PatternOrValue);
        continue;
      }
      // Where this cell sits along the axis the chase runs on, so a palette
      // spreads across the strip and re-spreads onto the rows under .down().
      // One stop comes back by identity, which is what keeps the short cuts
      // below firing and .chase(red) writing exactly what it always wrote.
      const { r, g, b } = sampleStops(stops, phaseFor(step, count));
      // A component is usually a number, and 0 and 1 are worth short-cutting:
      // no multiply, and a dark component stays exactly dark.
      const scale = (c: ColorComponent): PatternOrValue => {
        if (c === 0) return 0 as PatternOrValue;
        if (c === 1) return bright as PatternOrValue;
        if (typeof c === 'number') {
          return (bright as { mul(n: unknown): unknown }).mul(c) as PatternOrValue;
        }
        return scaleByPattern(bright as PatternLike, c as unknown as PatternLike) as PatternOrValue;
      };
      if (strip.channelCount === strip.pixelCount * 4) {
        (strip as RgbwStripInstance).pixelXY(x, y, scale(r), scale(g), scale(b), 0);
      } else {
        (strip as StripInstance).pixelXY(x, y, scale(r), scale(g), scale(b));
      }
    }
  }
}

/**
 * Scale a brightness envelope by a colour component that is itself a pattern.
 *
 * `.mul()` reads like the right verb here and is not. Strudel reifies a
 * duck-typed component with `pure()`, so the multiply becomes a union of two
 * control objects rather than a product: the result carries the envelope's own
 * level, with the colour hanging off it under a key nothing reads. The channel
 * then sees the envelope alone, which is a chase at full brightness in white.
 * It never threw and never queried wrong, so nothing said so, and the example
 * in the docs advertised it.
 *
 * Querying both sides over the same arc and multiplying the levels is what the
 * multiply was meant to be. Several haps in one arc reduce by taking the
 * highest, which is how tick() already merges anything that overlaps.
 */
function scaleByPattern(bright: PatternLike, c: PatternLike): PatternLike {
  return {
    queryArc(begin: number, end: number) {
      let k = 0;
      for (const hap of c.queryArc(begin, end)) {
        const v = levelOf((hap as { value: unknown }).value);
        if (v !== null && v > k) k = v;
      }
      return bright.queryArc(begin, end).map((hap: { value: unknown }) => {
        const v = levelOf(hap.value);
        return v === null ? hap : { ...hap, value: v * k };
      });
    },
  };
}

/**
 * Shared rainbow-chase implementation used by both RGB and RGBW strip
 * instances. Builds a thresholded-cosine brightness envelope per pixel
 * and multiplies it by a shared three-phase RGB colour cycle. See the
 * 'effects' section of the docs for the full mechanism.
 */
function rainbowChaseImpl(
  strip: StripInstance | RgbwStripInstance,
  opts: RainbowChaseOptions,
): void {
  const sine = _sineFactory;
  const cosine = _cosineFactory;
  if (!sine || !cosine) return;

  checkOptions(opts as Record<string, unknown>,
    ['cycles', 'width', 'waves', 'hue'], '.rainbowChase()');
  const speed = opts.cycles ?? 2;
  // width is the lit fraction, the way .chase() means it. The envelope below
  // wants the old inverted floor, so it is derived rather than asked for.
  const width = Math.min(1, Math.max(0.02, opts.width ?? 1 / 9));
  const narrow = 1 / width - 1;
  const rainbowSpeed = opts.hue ?? 12;
  const packets = opts.waves ?? 1;

  const hueR = sine().slow(rainbowSpeed).range(0, 1);
  const hueG = sine().early(1 / 3).slow(rainbowSpeed).range(0, 1);
  const hueB = sine().early(2 / 3).slow(rainbowSpeed).range(0, 1);

  const isRgbw = strip.channelCount === strip.pixelCount * 4;

  for (let i = 0; i < strip.pixelCount; i++) {
    // Negative for the same reason as .chase(): a pixel further along runs
    // later, so the packet travels left to right rather than back to front.
    const phase = -(i * packets) / strip.pixelCount;
    const bright = cosine().early(phase).slow(speed).range(-narrow, 1);
    if (isRgbw) {
      (strip as RgbwStripInstance).pixel(
        i,
        bright.mul(hueR),
        bright.mul(hueG),
        bright.mul(hueB),
        0,
      );
    } else {
      (strip as StripInstance).pixel(
        i,
        bright.mul(hueR),
        bright.mul(hueG),
        bright.mul(hueB),
      );
    }
  }
}

// ─── Inline visualization registry ────────────────────────────────────────────
// `.viz(kind)` on a fixture or strip opts into an inline editor widget. This
// module only stores the runtime-derived channel layout; it has no idea
// where in the source the call lives. The UI-side extension scans the doc
// text for `.viz(...)` occurrences in the same top-to-bottom order the eval
// pushes entries and zips them 1:1, which avoids fragile stack-trace parsing.

/** Kinds of inline visualization a fixture/strip can opt into. */
export type VizKind = 'color' | 'wave' | 'strip' | 'meter';

/**
 * Runtime viz metadata. `rgbw` / `dim` offsets are 0-based relative to
 * `startChannel` so the widget can read the right bytes out of the universe
 * buffer without re-resolving the fixture definition.
 */
export interface VizEntry {
  kinds: VizKind[];
  universe: number;
  startChannel: number;     // 1-based DMX address
  channelCount: number;
  /** Relative offsets of RGB/W channels if the fixture has them. */
  rgbw?: { r?: number; g?: number; b?: number; w?: number };
  /** Relative offset of a dimmer/intensity channel, if present. */
  dim?: number;
  /** Present for pixel strips: number of pixels laid out contiguously. */
  pixelCount?: number;
  /**
   * Channels per pixel for strip viz. 3 for RGB (default), 4 for RGBW.
   * The strip widget uses this to stride through the universe buffer.
   */
  channelsPerPixel?: number;
}

const _vizRegistry: VizEntry[] = [];

/** Called by eval.ts before running new user code. */
export function clearVizRegistry(): void {
  _vizRegistry.length = 0;
}

/** UI-side: read the current registry to place editor widgets after eval. */
export function getVizEntries(): readonly VizEntry[] {
  return _vizRegistry;
}

/**
 * Walk a FixtureDef and pick out the channel offsets the visualizations
 * care about. Handles plain RGB/RGBW/RGBA PARs, dim-RGB(W), and
 * moving heads with an embedded color engine.
 */
function extractChannelLayout(def: FixtureDef): {
  rgbw?: { r?: number; g?: number; b?: number; w?: number };
  dim?: number;
} {
  const rgbw: { r?: number; g?: number; b?: number; w?: number } = {};
  let dim: number | undefined;
  for (const c of def.channels) {
    if      (c.name === 'red')   rgbw.r = c.offset;
    else if (c.name === 'green') rgbw.g = c.offset;
    else if (c.name === 'blue')  rgbw.b = c.offset;
    else if (c.name === 'white') rgbw.w = c.offset;
    // 'amber' falls through: treated as red-ish, not faked as a colour channel
    else if (c.name === 'dim')   dim = c.offset;
  }
  const hasAnyColor =
    rgbw.r !== undefined || rgbw.g !== undefined ||
    rgbw.b !== undefined || rgbw.w !== undefined;
  return {
    rgbw: hasAnyColor ? rgbw : undefined,
    dim,
  };
}
