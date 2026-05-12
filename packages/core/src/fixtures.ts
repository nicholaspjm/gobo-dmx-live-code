/**
 * Fixture system for lumen.
 *
 * Fixtures map named channels (red, pan, dim, etc.) to DMX addresses.
 * Users load a fixture at a start channel and get back an object with
 * named setters that call through to uni() / ch().
 *
 * Example:
 *   const par = fixture(1, 'generic-rgb')
 *   par.red(sine())
 *   par.green(0)
 *   par.blue(cosine().slow(2))
 *
 *   const head = fixture(10, 'moving-head-basic')
 *   head.pan(0.5)
 *   head.tilt(square().slow(8))
 *   head.dim(0.8)
 */

import { uni, type PatternOrValue } from './dmx.js';

// ─── Fixture definition types ─────────────────────────────────────────────────

export interface ChannelDef {
  /** 0-based byte offset from the fixture's start channel */
  offset: number;
  /** User-facing name: 'red', 'dim', 'pan', 'tilt', etc. */
  name: string;
  /**
   * Semantic type hint. Most types map 1:1 to a single DMX channel; 'strip'
   * is special — it claims `pixelCount * channelsPerPixel` channels starting
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
   */
  pixelLayout?: 'rgb' | 'rgbw';
}

export interface FixtureDef {
  name: string;
  manufacturer: string;
  type: 'dimmer' | 'rgb' | 'rgba' | 'rgbw' | 'moving-head' | 'strobe' | 'generic';
  /** Total channel count */
  channelCount: number;
  channels: ChannelDef[];
}

// ─── Built-in fixture library ─────────────────────────────────────────────────

export const BUILT_IN_FIXTURES: Record<string, FixtureDef> = {
  'generic-dimmer': {
    name: 'Generic Dimmer',
    manufacturer: 'Generic',
    type: 'dimmer',
    channelCount: 1,
    channels: [
      { offset: 0, name: 'dim', type: 'intensity', description: 'Dimmer / intensity' },
    ],
  },

  'generic-rgb': {
    name: 'Generic RGB PAR',
    manufacturer: 'Generic',
    type: 'rgb',
    channelCount: 3,
    channels: [
      { offset: 0, name: 'red',   type: 'color', description: 'Red'   },
      { offset: 1, name: 'green', type: 'color', description: 'Green' },
      { offset: 2, name: 'blue',  type: 'color', description: 'Blue'  },
    ],
  },

  'generic-rgbw': {
    name: 'Generic RGBW PAR',
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

  'generic-rgba': {
    name: 'Generic RGBA PAR',
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

  'generic-dim-rgb': {
    name: 'Generic Dimmer + RGB',
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

  'generic-dim-rgbw': {
    name: 'Generic Dimmer + RGBW',
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
      { offset: 9,  name: 'color',  type: 'control',   description: 'Color wheel'        },
      { offset: 10, name: 'prism',  type: 'control',   description: 'Prism'              },
      { offset: 11, name: 'focus',  type: 'control',   description: 'Focus'              },
    ],
  },

  'strobe-basic': {
    name: 'Generic Strobe',
    manufacturer: 'Generic',
    type: 'strobe',
    channelCount: 2,
    channels: [
      { offset: 0, name: 'dim',    type: 'intensity', description: 'Intensity'     },
      { offset: 1, name: 'strobe', type: 'strobe',    description: 'Strobe rate'   },
    ],
  },
};

// ─── Sim registry ────────────────────────────────────────────────────────────
// Every fixture / strip the user creates in a scene pushes itself onto this
// list so the UI's sim panel can render exactly what's in play — no more,
// no less. Cleared at the start of each evalCode() cycle alongside the
// pattern registry, so you get a fresh snapshot per scene.
//
// Each entry carries what the sim renderer needs and nothing else:
//   - how to draw it (globe / dimmer / rgb strip / rgbw strip)
//   - which DMX channels to read for live values
//   - a label for display + tooltip
// Channel offsets are all 0-based within the universe buffer.

export type SimRenderKind = 'globe-rgbw' | 'globe-dim' | 'strip-rgb' | 'strip-rgbw';

/**
 * Optional movement-channel hints. When present, the sim panel applies a
 * CSS transform each tick so the element visibly tracks `pan` / `tilt` /
 * `direction` channel values. Numbers here are *absolute* 1-based DMX
 * channels — keeps the renderer simple at the cost of one extra add at
 * registration time.
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

export interface SimFixture {
  /** Short label shown under the element in the sim panel (falls back to
   *  `id` when no better name is available). */
  label: string;
  /** Debug/tooltip detail — the human-readable fixture type. */
  type: string;
  universe: number;
  /** 1-based DMX start channel. */
  startChannel: number;
  /** Total channels this entry occupies — tooltip-only. */
  channelCount: number;
  /** Live movement channel hints; absent = element doesn't move. */
  movement?: SimMovement;
  render:
    | { kind: 'globe-rgbw'; r?: number; g?: number; b?: number; w?: number; dim?: number }
    | { kind: 'globe-dim';  dim: number }
    | { kind: 'strip-rgb';  pixelCount: number }
    | { kind: 'strip-rgbw'; pixelCount: number };
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
 * be terse — `[1]` is a valid "red only" row.
 *
 * Called once on the initial `pixelGrid(rows)` (mode 'none') and again
 * on each chained .repeat() / .hold() / .mirror() with the appropriate
 * mode — the second pass overwrites the first.
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
      // Blank pixel — zero every channel in the stride.
      for (let j = 0; j < stride; j++) uni(universe, base + j, 0);
      continue;
    }
    const row = rows[src];
    for (let j = 0; j < stride; j++) {
      uni(universe, base + j, row[j] ?? 0);
    }
  }
}

/**
 * Resolve movement-channel hints for a fixture from its declared channel
 * layout. Picks `pan` / `tilt` / `direction` channels and converts each
 * to an absolute 1-based DMX channel. Returns undefined if none of the
 * three are present — keeps the SimFixture payload lean for static
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

/** Resolve fixture id → FixtureDef (built-in first, then custom). */
function resolveFixture(id: string): FixtureDef {
  const def = BUILT_IN_FIXTURES[id] ?? _customFixtures[id];
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
 * A live fixture instance — named accessors bound to real DMX channels.
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
  /** Set any scalar channel by name. Throws for strip channels. */
  set(channelName: string, value: PatternOrValue): void;
  /** List available channel names */
  channels(): string[];
  /**
   * Opt into one or more inline editor visualizations for this fixture.
   * The editor scans the source for `.viz(...)` call sites and drops a
   * live widget at the end of that line. Default kind is 'color'.
   *
   * @example
   *   const washA = fixture(1, 'generic-rgbw').viz('color')
   *   const spot  = fixture(9, 'generic-dimmer').viz('wave', 'meter')
   */
  viz(...kinds: VizKind[]): FixtureInstance;
  // Named channels: setter function OR nested StripInstance (for type: 'strip')
  [key: string]: unknown;
};

/**
 * Load a fixture at a DMX address and return a named-channel setter object.
 *
 * @param startChannel  1-based DMX channel (first channel of the fixture)
 * @param fixtureId     Built-in id ('generic-rgb', 'moving-head-basic', …) or custom id
 * @param universe      DMX universe (default: 0). Art-Net / TouchDesigner
 *                      label the first universe as "Universe 0" — if your node
 *                      is configured for universe 0 this works out of the box.
 *                      Pass 1, 2, 3, … to address additional universes. Note
 *                      sACN E1.31 requires universe ≥ 1.
 *
 * @example
 *   const par = fixture(1, 'generic-rgb')
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

  const inst: FixtureInstance = {
    def,
    universe,
    startChannel,

    set(channelName: string, value: PatternOrValue): void {
      const ch = def.channels.find((c) => c.name === channelName);
      if (!ch) {
        throw new Error(
          `Fixture "${def.name}" has no channel "${channelName}". Available: ${def.channels.map((c) => c.name).join(', ')}`,
        );
      }
      if (ch.type === 'strip') {
        throw new Error(
          `Fixture "${def.name}" channel "${channelName}" is a pixel strip segment — use .${channelName}.fill(r,g,b), .${channelName}.pixel(i, r, g, b), or .${channelName}.red(v) instead of .set().`,
        );
      }
      uni(universe, startChannel + ch.offset, value);
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
      const stripOpts = { simLabel: `${fixtureId} · ${ch.name}`, movement };
      inst[ch.name] =
        ch.pixelLayout === 'rgbw'
          ? rgbwStrip(stripStart, pixelCount, universe, stripOpts)
          : rgbStrip(stripStart, pixelCount, universe, stripOpts);
    } else {
      inst[ch.name] = (value: PatternOrValue) => inst.set(ch.name, value);
    }
  }

  // ── Register with the sim panel ──
  // If the fixture has a strip channel the embedded rgbStrip/rgbwStrip call
  // above registers the visible element — skip the "main" globe here to
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
        movement,
        render: { kind: 'globe-dim', dim: dimOffset },
      });
    }
    // else: nothing visible to render (no colour, no dim) — don't clutter
    // the sim. Movement-only fixtures (rare) need a colour or dim channel
    // to get an element to track.
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

/**
 * Chainable result of `strip.pixelGrid(values)`. The grid is already
 * applied (default: explicit pixels, rest at 0). Call one of the methods
 * to overwrite with a fill mode:
 *
 *   .repeat()  tile the input pattern across the strip
 *   .hold()    keep the last input pixel for every pixel after it
 *   .mirror()  reflect the input back so the pattern reads symmetrically
 *
 * Returns `void` from the chain methods — the operation is destructive,
 * not a transform you can keep chaining onto.
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

  /** Set every pixel to the same r/g/b. Each arg may be a pattern or number. */
  fill(r: PatternOrValue, g: PatternOrValue, b: PatternOrValue): void;

  /**
   * Set a single pixel (0-indexed). Two shapes:
   *   pixel(i, brightness)         → monochrome (R = G = B = brightness)
   *   pixel(i, r, g, b)            → full RGB
   * The monochrome form is the typical chase-loop shorthand — saves
   * repeating the same pattern three times.
   */
  pixel(
    index: number,
    r: PatternOrValue,
    g?: PatternOrValue,
    b?: PatternOrValue,
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
   * The callback receives `(phase, i, count)` — phase is `i / count`,
   * the common chase parameter you'd otherwise hand-compute every time.
   *
   * @example
   *   strip.each(p => cosine().early(p).slow(2).range(-7, 1))   // monochrome walk
   *   strip.each(p => [sine().early(p), 0, cosine().early(p)])  // colour chase
   */
  each(fn: (phase: number, i: number, count: number) => PatternOrValue | PatternOrValue[]): void;

  /** Set just the red channel on every pixel. */
  red(v: PatternOrValue): void;
  /** Set just the green channel on every pixel. */
  green(v: PatternOrValue): void;
  /** Set just the blue channel on every pixel. */
  blue(v: PatternOrValue): void;

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
   * Built-in rainbow chase — a single bright pixel sweeps across the strip
   * while its colour slowly walks through the full hue wheel. Options:
   * `speed` (beats/pass), `narrow` (peak sharpness), `rainbowSpeed`
   * (beats/cycle), `packets` (simultaneous chase dots). See 'effects' in
   * the docs for the mechanics.
   */
  rainbowChase(opts?: RainbowChaseOptions): void;
}

/**
 * Create an RGB pixel strip starting at a DMX address.
 *
 * Each pixel is 3 channels (R, G, B), laid out contiguously. A 40-pixel strip
 * occupies 120 channels. The pattern engine queries each channel on every tick,
 * so per-pixel patterns (e.g. phase-shifted chases) work just like PARs.
 *
 * @param startChannel  1-based DMX channel of the first pixel's red channel
 * @param pixelCount    Number of pixels (>= 1)
 * @param universe      DMX universe (default 0, matching Art-Net convention)
 *
 * @example
 *   const strip = rgbStrip(1, 40)
 *   strip.fill(sine().slow(4), 0, cosine().slow(4))
 *
 *   // Per-pixel chase
 *   for (let i = 0; i < strip.pixelCount; i++) {
 *     strip.pixel(i, sine().slow(4).add(i / strip.pixelCount), 0, 0)
 *   }
 */
export function rgbStrip(
  startChannel: number,
  pixelCount: number,
  universe = 0,
  opts: { simLabel?: string; movement?: SimMovement } = {},
): StripInstance {
  if (!Number.isFinite(pixelCount) || pixelCount < 1) {
    throw new Error(`rgbStrip: pixelCount must be >= 1 (got ${pixelCount})`);
  }
  const channelCount = pixelCount * 3;
  const lastChannel = startChannel + channelCount - 1;
  if (startChannel < 1) {
    throw new Error(`rgbStrip: startChannel must be >= 1 (got ${startChannel})`);
  }
  if (lastChannel > 512) {
    throw new Error(
      `rgbStrip: ${pixelCount} pixels starting at ${startChannel} would run to channel ${lastChannel} — exceeds 512. Split across universes.`,
    );
  }

  const inst: StripInstance = {
    universe,
    startChannel,
    pixelCount,
    channelCount,

    fill(r, g, b) {
      for (let i = 0; i < pixelCount; i++) {
        const base = startChannel + i * 3;
        uni(universe, base,     r);
        uni(universe, base + 1, g);
        uni(universe, base + 2, b);
      }
    },

    pixel(index, r, g, b) {
      if (!Number.isInteger(index) || index < 0 || index >= pixelCount) {
        throw new Error(
          `rgbStrip: pixel index ${index} out of range [0, ${pixelCount - 1}]`,
        );
      }
      // Monochrome shortcut: pixel(i, value) replicates `value` across R/G/B.
      // Saves repeating the brightness pattern three times in chase loops.
      if (g === undefined && b === undefined) { g = r; b = r; }
      const base = startChannel + index * 3;
      uni(universe, base,     r);
      uni(universe, base + 1, g ?? 0);
      uni(universe, base + 2, b ?? 0);
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
        const result = fn(phase, i, pixelCount);
        const base = startChannel + i * 3;
        if (Array.isArray(result)) {
          uni(universe, base,     result[0] ?? 0);
          uni(universe, base + 1, result[1] ?? 0);
          uni(universe, base + 2, result[2] ?? 0);
        } else {
          // Single value → monochrome (R = G = B = value).
          uni(universe, base,     result);
          uni(universe, base + 1, result);
          uni(universe, base + 2, result);
        }
      }
    },

    red(v) {
      for (let i = 0; i < pixelCount; i++) {
        uni(universe, startChannel + i * 3, v);
      }
    },

    green(v) {
      for (let i = 0; i < pixelCount; i++) {
        uni(universe, startChannel + i * 3 + 1, v);
      }
    },

    blue(v) {
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

    rainbowChase(opts: RainbowChaseOptions = {}): void {
      rainbowChaseImpl(inst, opts);
    },
  };
  registerSimFixture({
    label: opts.simLabel ?? `rgbStrip ×${pixelCount}`,
    type: 'RGB pixel strip',
    universe,
    startChannel,
    channelCount,
    movement: opts.movement,
    render: { kind: 'strip-rgb', pixelCount },
  });
  return inst;
}

// ─── RGBW pixel strip ─────────────────────────────────────────────────────────
// Same shape as rgbStrip but 4 channels per pixel (R, G, B, W). Matches the
// layout used by RGBW pixel bars — adds a dedicated white channel on top of
// RGB so you can dial in true warm/cool highlights without fighting colour mix.

export interface RgbwStripInstance {
  readonly universe: number;
  readonly startChannel: number;
  readonly pixelCount: number;
  /** Total DMX channels consumed (pixelCount * 4). */
  readonly channelCount: number;

  /** Set every pixel to the same r/g/b/w. */
  fill(
    r: PatternOrValue,
    g: PatternOrValue,
    b: PatternOrValue,
    w: PatternOrValue,
  ): void;

  /**
   * Set a single pixel (0-indexed). Two shapes:
   *   pixel(i, brightness)             → monochrome (R = G = B = brightness, W = 0)
   *   pixel(i, r, g, b, w)             → full RGBW
   * The monochrome form is the typical chase-loop shorthand — saves
   * repeating the same pattern four times.
   */
  pixel(
    index: number,
    r: PatternOrValue,
    g?: PatternOrValue,
    b?: PatternOrValue,
    w?: PatternOrValue,
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
   * control. The callback receives `(phase, i, count)` — phase is
   * `i / count`, the common chase parameter you'd otherwise hand-compute.
   *
   * @example
   *   bar.pixels.each(p => cosine().early(p).slow(2).range(-7, 1))           // walk
   *   bar.pixels.each(p => [0, sine().early(p), cosine().early(p), 0])       // chase
   */
  each(fn: (phase: number, i: number, count: number) => PatternOrValue | PatternOrValue[]): void;

  /** Set just the red channel on every pixel. */
  red(v: PatternOrValue): void;
  /** Set just the green channel on every pixel. */
  green(v: PatternOrValue): void;
  /** Set just the blue channel on every pixel. */
  blue(v: PatternOrValue): void;
  /** Set just the white channel on every pixel. */
  white(v: PatternOrValue): void;

  /** Opt into an inline editor visualization (default kind 'strip'). */
  viz(...kinds: VizKind[]): RgbwStripInstance;

  /** Built-in rainbow chase — see {@link StripInstance.rainbowChase}. */
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
  opts: { simLabel?: string; movement?: SimMovement } = {},
): RgbwStripInstance {
  if (!Number.isFinite(pixelCount) || pixelCount < 1) {
    throw new Error(`rgbwStrip: pixelCount must be >= 1 (got ${pixelCount})`);
  }
  const STRIDE = 4;
  const channelCount = pixelCount * STRIDE;
  const lastChannel = startChannel + channelCount - 1;
  if (startChannel < 1) {
    throw new Error(`rgbwStrip: startChannel must be >= 1 (got ${startChannel})`);
  }
  if (lastChannel > 512) {
    throw new Error(
      `rgbwStrip: ${pixelCount} pixels starting at ${startChannel} would run to channel ${lastChannel} — exceeds 512. Split across universes.`,
    );
  }

  const inst: RgbwStripInstance = {
    universe,
    startChannel,
    pixelCount,
    channelCount,

    fill(r, g, b, w) {
      for (let i = 0; i < pixelCount; i++) {
        const base = startChannel + i * STRIDE;
        uni(universe, base,     r);
        uni(universe, base + 1, g);
        uni(universe, base + 2, b);
        uni(universe, base + 3, w);
      }
    },

    pixel(index, r, g, b, w) {
      if (!Number.isInteger(index) || index < 0 || index >= pixelCount) {
        throw new Error(
          `rgbwStrip: pixel index ${index} out of range [0, ${pixelCount - 1}]`,
        );
      }
      // Monochrome shortcut: pixel(i, value) sets R = G = B = value with
      // W = 0. Repeated four-arg call is the verbose form for explicit
      // colour control.
      if (g === undefined && b === undefined) { g = r; b = r; w = 0; }
      const base = startChannel + index * STRIDE;
      uni(universe, base,     r);
      uni(universe, base + 1, g ?? 0);
      uni(universe, base + 2, b ?? 0);
      uni(universe, base + 3, w ?? 0);
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
        const result = fn(phase, i, pixelCount);
        const base = startChannel + i * STRIDE;
        if (Array.isArray(result)) {
          uni(universe, base,     result[0] ?? 0);
          uni(universe, base + 1, result[1] ?? 0);
          uni(universe, base + 2, result[2] ?? 0);
          uni(universe, base + 3, result[3] ?? 0);
        } else {
          // Single value → monochrome (R = G = B = value, W = 0).
          uni(universe, base,     result);
          uni(universe, base + 1, result);
          uni(universe, base + 2, result);
          uni(universe, base + 3, 0);
        }
      }
    },

    red(v)   { for (let i = 0; i < pixelCount; i++) uni(universe, startChannel + i * STRIDE,     v); },
    green(v) { for (let i = 0; i < pixelCount; i++) uni(universe, startChannel + i * STRIDE + 1, v); },
    blue(v)  { for (let i = 0; i < pixelCount; i++) uni(universe, startChannel + i * STRIDE + 2, v); },
    white(v) { for (let i = 0; i < pixelCount; i++) uni(universe, startChannel + i * STRIDE + 3, v); },

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

    rainbowChase(opts: RainbowChaseOptions = {}): void {
      rainbowChaseImpl(inst, opts);
    },
  };
  registerSimFixture({
    label: opts.simLabel ?? `rgbwStrip ×${pixelCount}`,
    type: 'RGBW pixel strip',
    universe,
    startChannel,
    channelCount,
    movement: opts.movement,
    render: { kind: 'strip-rgbw', pixelCount },
  });
  return inst;
}

// ─── Effect helpers (strip methods) ──────────────────────────────────────────
// Higher-level scene recipes exposed as methods on the strip instances. They
// need access to the waveform factories (sine / cosine), which live in the
// eval sandbox — so eval.ts injects them here via setStripEffectWaveforms()
// once strudel (or the fallback) is loaded. If a user calls rainbowChase()
// before that's happened the method is a no-op rather than a thrown error,
// since the setup is otherwise automatic.

export interface RainbowChaseOptions {
  /** Beats per packet pass across the strip (default 2). */
  speed?: number;
  /** Peak narrowness — bigger = narrower lit window (default 8). */
  narrow?: number;
  /** Beats per full rainbow cycle (default 12). */
  rainbowSpeed?: number;
  /** Simultaneous chase packets across the strip (default 1). */
  packets?: number;
}

// The waveform types are `any` because sine() / cosine() return values carry
// chain methods added dynamically by strudel's prototype or by our fallback
// factory — they don't fit the static PatternLike interface.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _sineFactory: (() => any) | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _cosineFactory: (() => any) | null = null;

/**
 * Inject the waveform factories. Called from eval.ts right after strudel
 * (or the fallback) is set up.
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

/**
 * Shared rainbow-chase implementation used by both RGB and RGBW strip
 * instances. Builds a thresholded-cosine brightness envelope per pixel
 * and multiplies it by a shared three-phase RGB colour cycle — see the
 * 'effects' section of the docs for the full mechanism.
 */
function rainbowChaseImpl(
  strip: StripInstance | RgbwStripInstance,
  opts: RainbowChaseOptions,
): void {
  const sine = _sineFactory;
  const cosine = _cosineFactory;
  if (!sine || !cosine) return;

  const speed = opts.speed ?? 2;
  const narrow = opts.narrow ?? 8;
  const rainbowSpeed = opts.rainbowSpeed ?? 12;
  const packets = opts.packets ?? 1;

  const hueR = sine().slow(rainbowSpeed).range(0, 1);
  const hueG = sine().early(1 / 3).slow(rainbowSpeed).range(0, 1);
  const hueB = sine().early(2 / 3).slow(rainbowSpeed).range(0, 1);

  const isRgbw = strip.channelCount === strip.pixelCount * 4;

  for (let i = 0; i < strip.pixelCount; i++) {
    const phase = (i * packets) / strip.pixelCount;
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
// module only stores the runtime-derived channel layout — it has no idea
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
 * actually care about. Handles plain RGB/RGBW/RGBA PARs, dim-RGB(W), and
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
    // 'amber' falls through — treated as red-ish but we don't try to fake it
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
