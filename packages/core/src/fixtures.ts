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
  /** Semantic type hint */
  type: 'intensity' | 'color' | 'position' | 'strobe' | 'control' | 'generic';
  /** Human-readable description */
  description?: string;
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

/** A live fixture instance — named setters bound to real DMX channels. */
export type FixtureInstance = {
  /** The resolved fixture definition */
  readonly def: FixtureDef;
  /** DMX universe (1-based) */
  readonly universe: number;
  /** Start channel (1-based, inclusive) */
  readonly startChannel: number;
  /** Set any channel by name */
  set(channelName: string, value: PatternOrValue): void;
  /** List available channel names */
  channels(): string[];
} & Record<string, (value: PatternOrValue) => void>;

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
      uni(universe, startChannel + ch.offset, value);
    },

    channels(): string[] {
      return def.channels.map((c) => c.name);
    },
  } as FixtureInstance;

  // Attach named setters: par.red(v) → inst.set('red', v)
  for (const ch of def.channels) {
    (inst as Record<string, unknown>)[ch.name] = (value: PatternOrValue) =>
      inst.set(ch.name, value);
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
