/**
 * Telling "the browser is blocking the connector" apart from "no connector".
 *
 * From the page the two look identical: the WebSocket fails in a millisecond
 * either way. Getting it wrong in one direction sends someone to download a
 * program they already have running; in the other, to change a browser setting
 * that is not the problem. These pin which pages are ever told they are blocked.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

let target = 'localhost';
vi.mock('@gobo/core', () => ({ bridgeHost: () => target }));

type Listener = () => void;

/** A PermissionStatus that can be changed from the test, the way a user would. */
function fakeStatus(state: string): { status: { state: string; addEventListener: (t: string, fn: Listener) => void }; change: (s: string) => void } {
  const listeners: Listener[] = [];
  const status = {
    state,
    addEventListener: (_type: string, fn: Listener) => { listeners.push(fn); },
  };
  return {
    status,
    change: (next: string) => {
      status.state = next;
      for (const fn of listeners) fn();
    },
  };
}

/** Load a fresh copy of the module, because it keeps the last answer. */
async function load(opts: { hostname: string; answers: Record<string, string> }) {
  const fakes = new Map<string, ReturnType<typeof fakeStatus>>();
  vi.stubGlobal('window', { location: { hostname: opts.hostname } });
  vi.stubGlobal('navigator', {
    permissions: {
      query: async ({ name }: { name: string }) => {
        if (!(name in opts.answers)) throw new TypeError(`unknown permission ${name}`);
        const fake = fakeStatus(opts.answers[name]);
        fakes.set(name, fake);
        return fake.status;
      },
    },
  });
  vi.resetModules();
  const mod = await import('./browser-access.js');
  await mod.watchLocalAccess();
  return { mod, fakes };
}

beforeEach(() => { target = 'localhost'; });
afterEach(() => { vi.unstubAllGlobals(); });

describe('whether the browser is what blocks the connector', () => {
  it('is blocked for the hosted site when the permission is denied', async () => {
    const { mod } = await load({ hostname: 'nicholaspjm.github.io', answers: { 'loopback-network': 'denied' } });
    expect(mod.browserBlocksConnector()).toBe(true);
  });

  it('is never blocked for a page served from this computer', async () => {
    // Even with the permission denied: localhost reaching localhost is not a
    // request the browser asks about, which is the point of running locally.
    target = 'localhost';
    for (const hostname of ['localhost', '127.0.0.1', '[::1]']) {
      const { mod } = await load({ hostname, answers: { 'loopback-network': 'denied' } });
      expect(mod.browserBlocksConnector(), hostname).toBe(false);
    }
  });

  it('is not blocked for a page served from a LAN address, which looks for the connector there', async () => {
    target = '192.168.1.20';
    const { mod } = await load({ hostname: '192.168.1.20', answers: { 'loopback-network': 'denied' } });
    expect(mod.browserBlocksConnector()).toBe(false);
  });

  it('is not blocked while the browser is still going to ask, or has said yes', async () => {
    for (const state of ['prompt', 'granted']) {
      const { mod } = await load({ hostname: 'nicholaspjm.github.io', answers: { 'loopback-network': state } });
      expect(mod.browserBlocksConnector(), state).toBe(false);
    }
  });

  it('says nothing in a browser that has no such permission', async () => {
    const { mod } = await load({ hostname: 'nicholaspjm.github.io', answers: {} });
    expect(mod.getLocalAccess()).toBe('unknown');
    expect(mod.browserBlocksConnector()).toBe(false);
  });

  it('falls back to the older umbrella name', async () => {
    const { mod } = await load({ hostname: 'nicholaspjm.github.io', answers: { 'local-network-access': 'denied' } });
    expect(mod.getLocalAccess()).toBe('denied');
  });

  it('hears the answer change, which is the moment to reconnect', async () => {
    const { mod, fakes } = await load({ hostname: 'nicholaspjm.github.io', answers: { 'loopback-network': 'denied' } });
    const heard: string[] = [];
    mod.onLocalAccessChange((s) => heard.push(s));
    fakes.get('loopback-network')?.change('granted');
    expect(heard).toEqual(['granted']);
    expect(mod.browserBlocksConnector()).toBe(false);
  });
});
