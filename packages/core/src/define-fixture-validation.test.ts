/**
 * defineFixture checks what it is given.
 *
 * fixture-validator.ts has always held the rules and the messages, and nothing
 * in the editor reached them: it ran in CI over the JSON in fixtures/, while a
 * def written in a scene went into the registry unexamined.
 *
 * Two of those silences were expensive. A channelCount smaller than the real
 * span patched happily and surfaced later as the NEXT light misbehaving. And
 * redefining a built-in id — the most natural first move from "my par is not
 * the built-in one" — was accepted and then ignored, because resolveFixture()
 * takes built-ins first: the scene kept using the built-in, and the first call
 * to a channel only the real fixture has came back as "par.dim is not a
 * function", which names the variable and says nothing about the definition.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { clearDefs } from './dmx.js';
import { defineFixture, fixture, clearSimFixtures } from './fixtures.js';

const good = {
  name: 'My Par',
  manufacturer: 'Acme',
  type: 'rgbw',
  channelCount: 4,
  channels: [
    { offset: 0, name: 'red', type: 'color' as const },
    { offset: 1, name: 'green', type: 'color' as const },
    { offset: 2, name: 'blue', type: 'color' as const },
    { offset: 3, name: 'white', type: 'color' as const },
  ],
};

beforeEach(() => { clearDefs(); clearSimFixtures(); });

describe('defineFixture validation', () => {
  it('accepts a sound definition under an id of its own', () => {
    expect(() => defineFixture('my-par', good)).not.toThrow();
    expect(() => fixture(1, 'my-par')).not.toThrow();
  });

  it('refuses an id a built-in already owns, rather than ignoring the def', () => {
    expect(() => defineFixture('rgbw', { ...good, channelCount: 7 }))
      .toThrow(/collides with a built-in\. Pick a different name/);
  });

  it('refuses a channelCount that does not cover the channels', () => {
    expect(() => defineFixture('my-par', { ...good, channelCount: 3 }))
      .toThrow(/out of range for channelCount 3/);
  });

  it('names the channel types it knows when given one it does not', () => {
    expect(() => defineFixture('my-par', {
      ...good,
      channels: [{ offset: 0, name: 'red', type: 'colour' as never }],
    })).toThrow(/type must be one of intensity, color, position, strobe, control, generic, strip/);
  });

  it('catches two channels on one offset', () => {
    expect(() => defineFixture('my-par', {
      ...good,
      channels: [
        { offset: 0, name: 'red', type: 'color' as const },
        { offset: 0, name: 'green', type: 'color' as const },
      ],
    })).toThrow(/offset 0 is used twice/);
  });

  it('catches a strip with no pixelCount', () => {
    expect(() => defineFixture('my-bar', {
      ...good,
      channelCount: 12,
      channels: [{ offset: 0, name: 'pixels', type: 'strip' as const }],
    })).toThrow(/pixelCount must be an integer/);
  });

  it('says which call failed, so the line is findable', () => {
    expect(() => defineFixture('rgb', good)).toThrow(/^defineFixture\("rgb"\):/);
  });
});
