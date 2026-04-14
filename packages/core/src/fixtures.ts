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
   * is special — it claims `pixelCount * 3` channels starting at `offset` and
   * exposes a nested StripInstance on the fixture under this name.
   */
  type: 'intensity' | 'color' | 'position' | 'strobe' | 'control' | 'generic' | 'strip';
  /** Human-readable description */
  description?: string;
  /** For type='strip': number of RGB pixels (each consumes 3 DMX channels). */
  pixelCount?: number;
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

// ─── Runtime fixture registry (user-defined fixtures) ─────────────────────────

const _customFixtures: Record<string, FixtureDef> = {};

/** Register a custom fixture definition under a given id. */
export function defineFixture(id: string, def: FixtureDef): void {
  _customFixtures[id] = def;
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
  // Named channels: setter function OR nested StripInstance (for type: 'strip')
  [key: string]: unknown;
};

/**
 * Load a fixture at a DMX address and return a named-channel setter object.
 *
 * @param startChannel  1-based DMX channel (first channel of the fixture)
 * @param fixtureId     Built-in id ('generic-rgb', 'moving-head-basic', …) or custom id
 * @param universe      DMX universe, 1-based (default: 1)
 *
 * @example
 *   const par = fixture(1, 'generic-rgb')
 *   par.red(sine())
 *   par.blue(0.5)
 *
 *   const head = fixture(10, 'moving-head-basic', 1)
 *   head.pan(square().slow(4))
 *   head.dim(0.8)
 */
export function fixture(
  startChannel: number,
  fixtureId: string,
  universe = 1,
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
  } as FixtureInstance;

  // Attach named accessors.
  //   - Scalar channels become setter functions: par.red(v)
  //   - 'strip' channels become nested StripInstance objects:
  //         bar.pixels.fill(r, g, b)
  //         bar.pixels.pixel(i, r, g, b)
  for (const ch of def.channels) {
    if (ch.type === 'strip') {
      const pixelCount = ch.pixelCount ?? 0;
      if (pixelCount < 1) {
        throw new Error(
          `Fixture "${def.name}" channel "${ch.name}" is type 'strip' but has no valid pixelCount (got ${ch.pixelCount}).`,
        );
      }
      inst[ch.name] = rgbStrip(startChannel + ch.offset, pixelCount, universe);
    } else {
      inst[ch.name] = (value: PatternOrValue) => inst.set(ch.name, value);
    }
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

export interface StripInstance {
  readonly universe: number;
  readonly startChannel: number;
  readonly pixelCount: number;
  /** Total DMX channels consumed (pixelCount * 3). */
  readonly channelCount: number;

  /** Set every pixel to the same r/g/b. Each arg may be a pattern or number. */
  fill(r: PatternOrValue, g: PatternOrValue, b: PatternOrValue): void;

  /** Set a single pixel (0-indexed) to r/g/b. */
  pixel(
    index: number,
    r: PatternOrValue,
    g: PatternOrValue,
    b: PatternOrValue,
  ): void;

  /** Set just the red channel on every pixel. */
  red(v: PatternOrValue): void;
  /** Set just the green channel on every pixel. */
  green(v: PatternOrValue): void;
  /** Set just the blue channel on every pixel. */
  blue(v: PatternOrValue): void;
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
 * @param universe      DMX universe (default 1)
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
  universe = 1,
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

  return {
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
      const base = startChannel + index * 3;
      uni(universe, base,     r);
      uni(universe, base + 1, g);
      uni(universe, base + 2, b);
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
  };
}
