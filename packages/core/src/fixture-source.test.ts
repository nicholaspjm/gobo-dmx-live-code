/**
 * The generated template has to be the fixture, not a description of it. The
 * first thing anyone does with a template is change one number and run it, so
 * every built-in is round-tripped: written out, read back, compared.
 */

import { describe, it, expect } from 'vitest';
import { defineFixtureSource } from './fixture-source.js';
import { BUILT_IN_FIXTURES, defineFixture, findFixtureDef, type FixtureDef } from './fixtures.js';

/** Run generated source through the real defineFixture and hand back the def
 *  it registered, under a throwaway id. */
function roundTrip(id: string, def: FixtureDef): FixtureDef | undefined {
  const source = defineFixtureSource(`${id}-copy`, def);
  // The generated text is a defineFixture(...) call and nothing else, so it
  // can be run directly with defineFixture in scope.
  new Function('defineFixture', source)(defineFixture);
  return findFixtureDef(`${id}-copy`);
}

describe('defineFixtureSource', () => {
  for (const [id, def] of Object.entries(BUILT_IN_FIXTURES)) {
    it(`round-trips ${id}`, () => {
      expect(roundTrip(id, def)).toEqual(def);
    });
  }

  it('round-trips a strip channel with its grid', () => {
    // The geometry is the part worth copying and the part nobody guesses.
    const def: FixtureDef = {
      name: 'Grid wash', manufacturer: 'Test', type: 'generic', channelCount: 146,
      channels: [
        { offset: 0, name: 'dim', type: 'intensity' },
        {
          offset: 2, name: 'pixels', type: 'strip',
          pixelCount: 48, pixelLayout: 'rgb', columns: 12, origin: 'bottom-right', serpentine: true,
        },
      ],
    };
    expect(roundTrip('grid', def)).toEqual(def);
  });

  it('round-trips slots on a wheel', () => {
    const def: FixtureDef = {
      name: 'Wheel', manufacturer: 'Test', type: 'moving-head', channelCount: 1,
      channels: [
        {
          offset: 0, name: 'color', type: 'color',
          slots: [
            { name: 'open', value: 0 },
            { name: 'red', from: 10, to: 19 },
            { name: 'red/blue', from: 20, to: 29 },
          ],
        },
      ],
    };
    expect(roundTrip('wheel', def)).toEqual(def);
  });

  it('quotes a channel name that is not an identifier', () => {
    const src = defineFixtureSource('odd', {
      name: 'Odd', manufacturer: 'Test', type: 'generic', channelCount: 1,
      channels: [{ offset: 0, name: 'strobe rate', type: 'control' }],
    });
    expect(src).toContain("name: 'strobe rate'");
  });

  it('escapes a quote inside a name rather than breaking the literal', () => {
    const def: FixtureDef = {
      name: "Bob's light", manufacturer: 'Test', type: 'generic', channelCount: 1,
      channels: [{ offset: 0, name: 'dim', type: 'intensity' }],
    };
    expect(roundTrip('quoted', def)).toEqual(def);
  });

  it('reads as the code someone would have written', () => {
    const src = defineFixtureSource('rgb', BUILT_IN_FIXTURES.rgb);
    expect(src.startsWith("defineFixture('rgb', {")).toBe(true);
    expect(src.trimEnd().endsWith('})')).toBe(true);
    expect(src).toContain("{ offset: 0, name: 'red', type: 'color', description: 'Red' },");
  });
});
