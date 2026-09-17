/**
 * Two lights on one channel.
 *
 * The commonest addressing mistake in lighting, and it used to patch quietly.
 * The second fixture's dimmer would sit on the first one's green, both writing
 * every frame, and the rig would do something that reads as a broken fixture
 * rather than as a mistyped number.
 *
 * The other half of this was already refused: a fixture that would run past
 * channel 512 throws and names the overrun. This is the same check for the
 * other direction, and it runs at patch time, which is when ctrl+enter is
 * pressed, so it surfaces while the scene is being written.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { clearDefs } from './dmx.js';
import { fixture, defineFixture, clearSimFixtures, rgbStrip } from './fixtures.js';

beforeEach(() => {
  clearDefs();
  clearSimFixtures();
  defineFixture('par4', {
    name: 'Par 4', manufacturer: 'test', type: 'generic', channelCount: 4,
    channels: [
      { offset: 0, name: 'dim', type: 'intensity' },
      { offset: 1, name: 'red', type: 'color' },
      { offset: 2, name: 'green', type: 'color' },
      { offset: 3, name: 'blue', type: 'color' },
    ],
  });
});

describe('overlapping patches', () => {
  it('refuses a fixture that lands on one already patched', () => {
    fixture(1, 'par4');
    expect(() => fixture(3, 'par4')).toThrow(/overlaps/);
  });

  it('names the contested channels and where to move to', () => {
    fixture(1, 'par4');
    expect(() => fixture(3, 'par4'))
      .toThrow(/channels 3 to 4 on universe 0.*Move this one to 5 or later/s);
  });

  it('allows them end to end, with no gap', () => {
    expect(() => { fixture(1, 'par4'); fixture(5, 'par4'); fixture(9, 'par4'); }).not.toThrow();
  });

  it('allows the same channel on a different universe', () => {
    // A universe is a separate wire. Reusing channel 1 on each is normal.
    expect(() => { fixture(1, 'par4', 0); fixture(1, 'par4', 1); }).not.toThrow();
  });

  it('refuses a bare strip that lands on a patched fixture', () => {
    fixture(1, 'par4');
    expect(() => rgbStrip(3, 8)).toThrow(/overlaps/);
  });

  it('refuses a fixture that lands on a bare strip', () => {
    rgbStrip(1, 4);          // channels 1 to 12
    expect(() => fixture(10, 'par4')).toThrow(/overlaps/);
  });

  it('does not count a fixture against itself for its embedded strip', () => {
    // A strip inside a fixture is already inside that fixture's own claim, so
    // claiming it twice would make every pixel-bar patch collide with itself.
    defineFixture('bar', {
      name: 'Bar', manufacturer: 'test', type: 'generic', channelCount: 13,
      channels: [
        { offset: 0, name: 'dim', type: 'intensity' },
        { offset: 1, name: 'pixels', type: 'strip', pixelCount: 4, pixelLayout: 'rgb' },
      ],
    });
    expect(() => fixture(1, 'bar')).not.toThrow();
  });

  it('forgets its claims when the scene is replaced', () => {
    fixture(1, 'par4');
    clearDefs();
    expect(() => fixture(1, 'par4')).not.toThrow();
  });
});
