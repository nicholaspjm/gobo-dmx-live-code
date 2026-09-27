/**
 * What the computer says about its user (reduced motion, more contrast) is
 * the starting point for anything not yet chosen in settings, and never
 * overrides a choice.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

let stored: Record<string, string> = {};
let queries: Record<string, boolean> = {};

beforeEach(() => {
  stored = {};
  queries = {};
  vi.resetModules();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => stored[k] ?? null,
    setItem: (k: string, v: string) => { stored[k] = v; },
    removeItem: (k: string) => { delete stored[k]; },
  });
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: queries[q] ?? false }));
});

async function settings() {
  const mod = await import('./settings.js');
  return mod.getSettings();
}

describe('the operating system as the starting point', () => {
  it('reduced motion turns the animations off', async () => {
    queries['(prefers-reduced-motion: reduce)'] = true;
    expect((await settings()).animations).toBe(false);
  });

  it('more contrast starts on a high-contrast theme, light or dark as the system is', async () => {
    queries['(prefers-contrast: more)'] = true;
    expect((await settings()).theme).toBe('contrastDark');
    vi.resetModules();
    queries['(prefers-color-scheme: light)'] = true;
    expect((await settings()).theme).toBe('contrastLight');
  });

  it('a choice already made wins', async () => {
    queries['(prefers-reduced-motion: reduce)'] = true;
    queries['(prefers-contrast: more)'] = true;
    stored['gobo-settings-v1'] = JSON.stringify({ animations: true, theme: 'moonbox' });
    const s = await settings();
    expect(s.animations).toBe(true);
    expect(s.theme).toBe('moonbox');
  });

  it('nothing is written until a choice is made', async () => {
    queries['(prefers-contrast: more)'] = true;
    await settings();
    expect(stored['gobo-settings-v1']).toBeUndefined();
  });
});
