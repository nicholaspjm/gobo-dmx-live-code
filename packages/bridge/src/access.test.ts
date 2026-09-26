/**
 * Who the connector will talk to.
 *
 * Until 0.5.0 the answer was anyone: every network interface, no Origin check,
 * so any web page open on the operator's machine could drive the rig and
 * repoint its UDP output, and so could anything on the same wifi. These pin the
 * three checks that replaced that. See the top of access.ts for why each one
 * exists; the rebinding case below is the reason there are three and not two.
 */

import { describe, it, expect } from 'vitest';

import {
  bindAddresses,
  checkHost,
  checkOrigin,
  checkUpgrade,
  createPolicy,
  hostnameOf,
  isLoopback,
  normaliseOrigin,
  parseAccessArgs,
  printable,
} from './access.js';

const HOSTED = 'https://nicholaspjm.github.io/gobo-dmx-live-code/';

const local = createPolicy({ lan: false, hostedApp: HOSTED });

const lan = createPolicy({
  lan: true,
  hostedApp: HOSTED,
  ownHosts: () => new Set(['192.168.1.20', 'fe80::1', 'lighting-mac', 'lighting-mac.local']),
});

describe('where it listens', () => {
  it('binds both loopbacks by default, and nothing else', () => {
    expect(bindAddresses(false)).toEqual(['127.0.0.1', '::1']);
  });

  it('binds every interface only when asked', () => {
    expect(bindAddresses(true)).toEqual([undefined]);
  });
});

describe('the flags', () => {
  it('is loopback-only unless --lan is given', () => {
    expect(parseAccessArgs(['node', 'index.js']).lan).toBe(false);
    expect(parseAccessArgs(['node', 'index.js', '--lan']).lan).toBe(true);
  });

  it('cuts --allow-origin down to an origin, so an address bar pastes as-is', () => {
    const args = parseAccessArgs(['--allow-origin', 'https://someone.github.io/gobo/', '--allow-origin', 'http://10.0.0.4:3000']);
    expect(args.extraOrigins).toEqual(['https://someone.github.io', 'http://10.0.0.4:3000']);
    expect(args.invalid).toEqual([]);
  });

  it('reports a value that is not an http(s) origin rather than dropping it quietly', () => {
    const args = parseAccessArgs(['--allow-origin', 'someone.github.io', '--allow-origin', 'ftp://x.example']);
    expect(args.extraOrigins).toEqual([]);
    expect(args.invalid).toEqual(['someone.github.io', 'ftp://x.example']);
  });

  it('takes GOBO_LAN from the environment, which survives nested npm scripts where a flag does not', () => {
    expect(parseAccessArgs([], { GOBO_LAN: '1' }).lan).toBe(true);
    expect(parseAccessArgs([], { GOBO_LAN: 'true' }).lan).toBe(true);
    expect(parseAccessArgs([], { GOBO_LAN: '0' }).lan).toBe(false);
    expect(parseAccessArgs([], {}).lan).toBe(false);
  });

  it('does not swallow the next flag when --allow-origin has no value', () => {
    const args = parseAccessArgs(['--allow-origin', '--lan']);
    expect(args.lan).toBe(true);
    expect(args.extraOrigins).toEqual([]);
    expect(args.invalid).toHaveLength(1);
    expect(parseAccessArgs(['--allow-origin']).invalid).toHaveLength(1);
  });
});

describe('reading a host', () => {
  it('drops the port, the IPv6 brackets, the case and a trailing root dot', () => {
    expect(hostnameOf('localhost:3001')).toBe('localhost');
    expect(hostnameOf('LOCALHOST:3001')).toBe('localhost');
    expect(hostnameOf('localhost.:3001')).toBe('localhost');
    expect(hostnameOf('[::1]:3001')).toBe('::1');
    expect(hostnameOf('127.0.0.1')).toBe('127.0.0.1');
  });

  it('refuses anything that is not host[:port]', () => {
    expect(hostnameOf('')).toBeNull();
    expect(hostnameOf('localhost/admin')).toBeNull();
    expect(hostnameOf('user@localhost')).toBeNull();
    expect(hostnameOf('localhost?x=1')).toBeNull();
  });

  it('knows loopback when it sees it, in every spelling', () => {
    for (const name of ['localhost', '127.0.0.1', '127.8.9.10', '::1', hostnameOf('[::ffff:127.0.0.1]') as string]) {
      expect(isLoopback(name), name).toBe(true);
    }
  });

  it('does not mistake a name that merely contains one for loopback', () => {
    for (const name of ['localhost.evil.example', '128.0.0.1', '10.0.0.1', '::2', 'evil-localhost']) {
      expect(isLoopback(name), name).toBe(false);
    }
  });
});

describe('the Host check', () => {
  it('accepts localhost and any address typed as an address', () => {
    for (const host of ['localhost:3001', '127.0.0.1:3001', '[::1]:3001', '192.168.1.20:3001']) {
      expect(checkHost(host, local).ok, host).toBe(true);
    }
  });

  it('refuses a name, which is what a rebinding attack arrives as', () => {
    expect(checkHost('attacker.example:3001', local).ok).toBe(false);
    expect(checkHost('localhost.attacker.example:3001', local).ok).toBe(false);
  });

  it('refuses a request that names no host at all', () => {
    expect(checkHost(undefined, local).ok).toBe(false);
    expect(checkHost('', local).ok).toBe(false);
  });

  it('accepts this machine\'s own names in LAN mode, and only those', () => {
    expect(checkHost('lighting-mac.local:3001', lan).ok).toBe(true);
    expect(checkHost('LIGHTING-MAC:3001', lan).ok).toBe(true);
    expect(checkHost('attacker.example:3001', lan).ok).toBe(false);
    // Not in loopback mode, where no other name can reach the socket anyway.
    expect(checkHost('lighting-mac.local:3001', local).ok).toBe(false);
  });
});

describe('the Origin check', () => {
  it('lets through a client with no Origin, which is not a browser', () => {
    expect(checkOrigin(undefined, local).ok).toBe(true);
  });

  it('refuses a page on any other site', () => {
    for (const origin of [
      'https://attacker.example',
      'http://attacker.example:3001',
      'https://nicholaspjm.github.io.attacker.example',
      'http://localhost.attacker.example:3000',
    ]) {
      expect(checkOrigin(origin, local).ok, origin).toBe(false);
    }
  });

  it('refuses "null", which a hostile page can get by sandboxing itself', () => {
    expect(checkOrigin('null', local).ok).toBe(false);
  });

  it('refuses a browser extension and anything else that is not a web page', () => {
    expect(checkOrigin('chrome-extension://abcdefghijklmnop', local).ok).toBe(false);
    expect(checkOrigin('file://', local).ok).toBe(false);
    expect(checkOrigin('not an origin', local).ok).toBe(false);
  });

  it('accepts the hosted app, and only over https', () => {
    expect(checkOrigin('https://nicholaspjm.github.io', local).ok).toBe(true);
    expect(checkOrigin('http://nicholaspjm.github.io', local).ok).toBe(false);
  });

  it('accepts a page served from this computer on any port', () => {
    // npm start and the desktop app are on 3001, npm run dev on 3000, vite
    // preview on 4173; a page on loopback was put there by a program already
    // running here, which could send UDP without asking.
    for (const origin of ['http://localhost:3001', 'http://localhost:3000', 'http://127.0.0.1:4173', 'http://[::1]:3001']) {
      expect(checkOrigin(origin, local).ok, origin).toBe(true);
    }
  });

  it('accepts an origin added with --allow-origin', () => {
    const fork = createPolicy({ lan: false, hostedApp: HOSTED, extraOrigins: ['https://someone.github.io'] });
    expect(checkOrigin('https://someone.github.io', fork).ok).toBe(true);
    expect(checkOrigin('https://someone.github.io', local).ok).toBe(false);
  });

  it('accepts a page served from this machine by address in LAN mode, and not otherwise', () => {
    expect(checkOrigin('http://192.168.1.20:3000', lan).ok).toBe(true);
    expect(checkOrigin('http://lighting-mac.local:3001', lan).ok).toBe(true);
    expect(checkOrigin('http://192.168.1.99:3000', lan).ok).toBe(false);
    expect(checkOrigin('http://192.168.1.20:3000', local).ok).toBe(false);
  });
});

describe('an upgrade takes both', () => {
  it('refuses DNS rebinding, which passes any check that only compares Origin with Host', () => {
    // attacker.example resolves to 127.0.0.1 by the time the page connects, so
    // the page is talking to "its own" origin: Origin and Host agree. Only the
    // Host check notices that a name, not an address, reached loopback.
    const verdict = checkUpgrade({ host: 'attacker.example:3001', origin: 'http://attacker.example:3001' }, local);
    expect(verdict.ok).toBe(false);
  });

  it('refuses a hostile page that aims at the right host', () => {
    expect(checkUpgrade({ host: 'localhost:3001', origin: 'https://attacker.example' }, local).ok).toBe(false);
  });

  it('accepts gobo in each of the places it runs from', () => {
    expect(checkUpgrade({ host: 'localhost:3001', origin: 'https://nicholaspjm.github.io' }, local).ok).toBe(true);
    expect(checkUpgrade({ host: 'localhost:3001', origin: 'http://localhost:3001' }, local).ok).toBe(true);
    expect(checkUpgrade({ host: '127.0.0.1:3001', origin: 'http://127.0.0.1:3000' }, local).ok).toBe(true);
    expect(checkUpgrade({ host: '192.168.1.20:3001', origin: 'http://192.168.1.20:3000' }, lan).ok).toBe(true);
  });
});

describe('logging what was refused', () => {
  it('keeps a hostile header from moving the cursor or filling the screen', () => {
    expect(printable('https://a.example\u001b[2J')).toBe('https://a.example?[2J');
    expect(printable('x'.repeat(500))).toHaveLength(120);
  });

  it('normalises an origin the same way whoever typed it', () => {
    expect(normaliseOrigin('HTTPS://Someone.GitHub.io/')).toBe('https://someone.github.io');
    expect(normaliseOrigin('http://localhost:80')).toBe('http://localhost');
  });
});
