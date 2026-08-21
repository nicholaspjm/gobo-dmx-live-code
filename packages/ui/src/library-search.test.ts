/**
 * Ranking for the fixture library's search.
 *
 * The rule the whole thing hangs off: a fixture is ranked by what it IS
 * before what is written about it. Someone searching a library at a gig has
 * the light in front of them and knows its make, its channel count, or
 * roughly its name, so those beat a word that happens to appear in a sentence
 * about one of its channels.
 *
 * rankFixtures is pure, but it lives in the panel module, whose imports reach
 * the core package index (which builds a bridge URL out of window.location as
 * it loads) and the bundled public library (which Vite fills from the
 * fixtures folder at build time). Neither has anything to do with ranking and
 * neither can run in a test process, so both are stubbed at the import
 * boundary. Nothing the ranking itself touches is faked: the defs below are
 * ordinary fixture definitions, shaped like the ones in fixtures/.
 */

import { describe, it, expect, vi } from 'vitest';
import type { ChannelDef, FixtureDef } from '@gobo/core';
import { rankFixtures } from './library.js';

vi.mock('@gobo/core', () => ({
  getLibraryFixtures: () => [],
  saveToLibrary: () => {},
  removeFromLibrary: () => {},
  isInLibrary: () => false,
  toExportString: () => '',
  parseImportString: () => ({ ok: false }),
  getCustomFixtures: () => ({}),
  defineFixture: () => {},
  isEmitterChannel: () => false,
  defineFixtureSource: () => '',
  BUILT_IN_FIXTURES: {},
}));
vi.mock('./public-fixtures.js', () => ({ getPublicFixtures: () => [] }));

type Chan = [name: string, type: ChannelDef['type'], description?: string];

/** Offsets are not something the search reads, so they are filled in by
 *  position rather than written out. */
function chans(list: Chan[]): ChannelDef[] {
  return list.map(([name, type, description], offset) => ({ offset, name, type, description }));
}

function entry(id: string, def: FixtureDef): { id: string; def: FixtureDef } {
  return { id, def };
}

/**
 * A library with the shape of a real one: a few built-ins, a few public
 * fixtures with real manufacturers on them, one pixel bar and one monster
 * strobe. Channel descriptions carry words that appear nowhere else, which is
 * what the bottom of the ranking is for.
 */
const LIBRARY = [
  entry('dim', {
    name: 'Dimmer',
    manufacturer: 'Generic',
    type: 'dimmer',
    channelCount: 1,
    channels: chans([['dim', 'intensity', 'Dimmer / intensity']]),
  }),
  entry('rgbw', {
    name: 'RGBW PAR',
    manufacturer: 'Generic',
    type: 'rgbw',
    channelCount: 4,
    channels: chans([
      ['red', 'color'], ['green', 'color'], ['blue', 'color'], ['white', 'color'],
    ]),
  }),
  entry('strobe', {
    name: 'Strobe',
    manufacturer: 'Generic',
    type: 'strobe',
    channelCount: 2,
    channels: chans([['dim', 'intensity'], ['strobe', 'strobe', 'Flash rate']]),
  }),
  entry('moving-head-basic', {
    name: 'Moving Head (basic)',
    manufacturer: 'Generic',
    type: 'moving-head',
    channelCount: 8,
    channels: chans([
      ['pan', 'position'], ['tilt', 'position'], ['dim', 'intensity'], ['strobe', 'strobe'],
      ['red', 'color'], ['green', 'color'], ['blue', 'color'], ['white', 'color'],
    ]),
  }),
  entry('par-rgbw-7ch', {
    name: 'SlimPAR Pro (7ch)',
    manufacturer: 'Chauvet',
    type: 'rgbw',
    channelCount: 7,
    channels: chans([
      ['dim', 'intensity', 'Master dimmer for the whole wash.'],
      ['red', 'color'], ['green', 'color'], ['blue', 'color'], ['white', 'color'],
      ['strobe', 'strobe', 'Shutter, then rising flash rate.'],
      ['macro', 'control', 'Built-in colour programs; leave at 0 to mix by hand.'],
    ]),
  }),
  entry('spot-12ch', {
    name: 'Moving Head Spot',
    manufacturer: 'Chauvet',
    type: 'moving-head',
    channelCount: 12,
    channels: chans([
      ['pan', 'position'], ['panFine', 'position'], ['tilt', 'position'], ['tiltFine', 'position'],
      ['dim', 'intensity'],
      ['shutter', 'control', 'Closed at 0, then a strobe whose rate rises with the value.'],
      ['gobo', 'control', 'Gobo wheel; the manual lists the slots.'],
      ['goboRotate', 'control'], ['colorWheel', 'control'], ['prism', 'control'],
      ['focus', 'control'], ['zoom', 'control', 'Offset from the beam angle set on the yoke.'],
    ]),
  }),
  entry('wash-14ch', {
    name: 'Moving Head Wash (14ch, 16-bit pan/tilt)',
    manufacturer: 'Robe',
    type: 'moving-head',
    channelCount: 14,
    channels: chans([
      ['pan', 'position'], ['panFine', 'position'], ['tilt', 'position'], ['tiltFine', 'position'],
      ['speed', 'control'], ['dim', 'intensity'], ['strobe', 'strobe'],
      ['red', 'color'], ['green', 'color'], ['blue', 'color'], ['white', 'color'],
      ['macro', 'control'], ['zoom', 'control'], ['control', 'control'],
    ]),
  }),
  entry('pixel-bar-rgbw-8', {
    name: 'Pixel Bar 8',
    manufacturer: 'Martin',
    type: 'generic',
    channelCount: 33,
    channels: [
      { offset: 0, name: 'dim', type: 'intensity' },
      { offset: 1, name: 'pixels', type: 'strip', pixelCount: 8, pixelLayout: 'rgbw' },
    ],
  }),
  entry('atomic-strobe-154ch', {
    name: 'Atomic LED Strobe 48+8 (154ch mode)',
    manufacturer: 'Generic',
    type: 'generic',
    channelCount: 154,
    channels: [
      { offset: 0, name: 'dim', type: 'intensity', description: 'Master dimmer over both halves.' },
      { offset: 1, name: 'strobe', type: 'strobe' },
      {
        offset: 2, name: 'pixels', type: 'strip',
        pixelCount: 48, pixelLayout: 'rgb', columns: 12,
        description: '48 RGB cells as a 12 x 4 grid.',
      },
      {
        offset: 146, name: 'strip', type: 'strip',
        pixelCount: 8, pixelLayout: 'mono',
        description: 'White strobe strip, eight segments at one channel each.',
      },
    ],
  }),
];

/** Ids in rank order. */
function ids(query: string): string[] {
  return rankFixtures(LIBRARY, query).map((h) => h.entry.id);
}

/** Where the query landed on one fixture, or undefined if it missed. */
function where(query: string, id: string): string | undefined {
  return rankFixtures(LIBRARY, query).find((h) => h.entry.id === id)?.where;
}

describe('rankFixtures', () => {
  it('ranks nothing for a blank query, so the panel keeps its grouped list', () => {
    expect(rankFixtures(LIBRARY, '')).toEqual([]);
    expect(rankFixtures(LIBRARY, '   ')).toEqual([]);
  });

  it('returns nothing for a word the library does not have', () => {
    expect(ids('hazer')).toEqual([]);
  });

  it('puts a fixture called the word above one that only mentions it', () => {
    // The rule the whole ranking exists for: one fixture is called a wash,
    // the other says the word in a sentence about its dimmer.
    expect(ids('wash')).toEqual(['wash-14ch', 'par-rgbw-7ch']);
    expect(where('wash', 'wash-14ch')).toBe('id');
    expect(where('wash', 'par-rgbw-7ch')).toBe('description');
    // And a name on its own is enough to be found by.
    expect(where('slimpar', 'par-rgbw-7ch')).toBe('name');
  });

  it('walks down the ladder: the id, then the name, then what it has', () => {
    const found = ids('strobe');
    expect(found[0]).toBe('strobe');                 // called exactly that
    expect(found[1]).toBe('atomic-strobe-154ch');    // says it in its name
    // Fixtures that merely carry a strobe channel come after both, and the
    // one whose only claim is a sentence about its shutter comes last.
    expect(found.indexOf('par-rgbw-7ch')).toBeGreaterThan(1);
    expect(found[found.length - 1]).toBe('spot-12ch');
  });

  it('reads a bare number as a channel count first', () => {
    expect(ids('8')[0]).toBe('moving-head-basic');
    expect(where('8', 'moving-head-basic')).toBe('channelCount');
    // The 8-pixel bar is 33 channels, so it is found but ranked under it.
    expect(ids('8')).toContain('pixel-bar-rgbw-8');
    expect(ids('154')[0]).toBe('atomic-strobe-154ch');
  });

  it('takes the unit someone would say out loud', () => {
    expect(ids('14ch')[0]).toBe('wash-14ch');
    expect(ids('12 channels')[0]).toBe('spot-12ch');
    expect(ids('8ch')[0]).toBe('moving-head-basic');
  });

  it('counts pixels when the query asks for pixels', () => {
    expect(ids('48px')).toEqual(['atomic-strobe-154ch']);
    expect(where('48px', 'atomic-strobe-154ch')).toBe('pixelCount');
    expect(ids('8 pixels')).toEqual(['atomic-strobe-154ch', 'pixel-bar-rgbw-8']);
  });

  it('finds a manufacturer, and only that manufacturer', () => {
    expect(ids('chauvet')).toEqual(['par-rgbw-7ch', 'spot-12ch']);
    expect(where('chauvet', 'spot-12ch')).toBe('manufacturer');
    expect(ids('mart')).toEqual(['pixel-bar-rgbw-8']);
  });

  it('reads the colour mix off the channels, whatever the fixture is called', () => {
    // Nothing in this def says rgbw; it has red, green, blue and white
    // channels, which is what someone means when they type it.
    expect(ids('rgbw')).toContain('moving-head-basic');
    expect(where('rgbw', 'moving-head-basic')).toBe('tag');
    // The one actually called rgbw still leads.
    expect(ids('rgbw')[0]).toBe('rgbw');
  });

  it('finds a fixture by a channel it has', () => {
    expect(ids('gobo')).toEqual(['spot-12ch']);
    expect(where('gobo', 'spot-12ch')).toBe('channel');
    expect(ids('prism')).toEqual(['spot-12ch']);
    expect(ids('zoom')).toEqual(['spot-12ch', 'wash-14ch']);
  });

  it('ANDs the terms, so two words narrow rather than widen', () => {
    expect(ids('chauvet moving')).toEqual(['spot-12ch']);
    expect(ids('chauvet 12')).toEqual(['spot-12ch']);
    expect(ids('robe 14ch')).toEqual(['wash-14ch']);
  });

  it('does not care how a name is spaced or hyphenated', () => {
    expect(ids('moving-head').sort()).toEqual(ids('moving head').sort());
    expect(ids('movinghead').sort()).toEqual(ids('moving head').sort());
  });

  it('ignores punctuation typed around a term', () => {
    expect(ids('(7ch)')).toEqual(['par-rgbw-7ch']);
  });

  it('matches a description word only as that word', () => {
    // 'off' inside 'Offset' is the failure that makes a prose tier useless:
    // it would put the moving head in front of anything actually named off.
    expect(ids('off')).toEqual([]);
    // A plural still reads as the word, so prose stays prose.
    expect(ids('segment')).toEqual(['atomic-strobe-154ch']);
    expect(where('segment', 'atomic-strobe-154ch')).toBe('description');
  });

  it('breaks ties on id, so nothing jumps while you type', () => {
    // moving-head-basic is named it; the other two carry it in their names.
    expect(ids('moving')).toEqual(['moving-head-basic', 'spot-12ch', 'wash-14ch']);
    expect(ids('moving')).toEqual(ids('moving'));
  });
});
