/**
 * The page background as a light: screen(1, { background: true }).
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { screen, clearScreens, getScreens, SCREEN_UNIVERSE } from './screen.js';
import { clearDefs, tick, getUniverseBuffer } from './dmx.js';

beforeEach(() => {
  clearDefs();
  clearScreens();
});

describe('a background screen', () => {
  it('is marked as the background and drives its channels like any screen', () => {
    const page = screen(1, { background: true });
    page.fill(1, 0, 0);
    tick(0);
    const [panel] = getScreens();
    expect(panel.background).toBe(true);
    expect(panel.label).toBe('background');
    expect(Array.from(getUniverseBuffer(SCREEN_UNIVERSE).slice(panel.startChannel - 1, panel.startChannel + 2))).toEqual([255, 0, 0]);
  });

  it('is one wash', () => {
    expect(() => screen(4, { background: true })).toThrow(/one wash, so it takes one pixel/);
  });

  it('is one per scene', () => {
    screen(1, { background: true });
    expect(() => screen(1, { background: true })).toThrow(/only one screen can be the page background/);
  });

  it('leaves an ordinary screen a panel', () => {
    screen(8);
    expect(getScreens()[0].background).toBe(false);
  });
});
