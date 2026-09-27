/**
 * Every theme is readable: text, muted text and every syntax colour clear
 * WCAG AA (4.5:1) against the theme's own ground, and the accessible ones
 * clear AAA (7:1).
 */

import { describe, it, expect } from 'vitest';

import { THEME_LIST, THEME_GROUPS } from './themes.js';
import { contrast } from './theme-gen.js';

describe('themes', () => {
  it('there are three times the original thirteen', () => {
    expect(THEME_LIST.length).toBe(39);
  });

  for (const theme of THEME_LIST) {
    it(`${theme.label} clears 4.5:1 for text and every syntax colour`, () => {
      const { bg } = theme.vars;
      const low: string[] = [];
      for (const [key, value] of Object.entries(theme.vars)) {
        if (!(key === 'text' || key === 'textMuted' || key.startsWith('syn'))) continue;
        const c = contrast(value.slice(0, 7), bg);
        if (c < 4.5) low.push(`${key} ${value} ${c.toFixed(2)}`);
      }
      expect(low).toEqual([]);
    });
  }

  it('the high-contrast themes clear 7:1 everywhere', () => {
    for (const theme of THEME_LIST.filter((t) => t.id.startsWith('contrast'))) {
      for (const [key, value] of Object.entries(theme.vars)) {
        if (key.startsWith('syn') || key === 'text') expect(contrast(value, theme.vars.bg)).toBeGreaterThanOrEqual(7);
      }
    }
  });

  it('every generated theme sits in a group the settings list shows', () => {
    const groups = new Set(THEME_GROUPS.map((g) => g.id));
    for (const theme of THEME_LIST) expect(groups.has(theme.group ?? 'gobo')).toBe(true);
  });
});
