/**
 * The "report a problem" link.
 *
 * What matters most is what it leaves out: a report is public, and everything
 * this writes travels in a URL, so it may describe the setup but never carry
 * anything that belongs to the person. The rest pins that the setup it
 * describes is the right one.
 */

import { describe, it, expect } from 'vitest';

import { browserName, environmentText, reportUrl, routeName, systemName, type Environment } from './report.js';

const env: Environment = {
  version: '0.5.0',
  route: 'the website',
  browser: 'Chrome 152',
  system: 'macOS',
  output: 'artnet',
  connector: '0.5.0',
  localAccess: 'granted',
};

describe('the link', () => {
  it('opens the bug form with the environment filled in', () => {
    const url = new URL(reportUrl(env));
    expect(url.origin + url.pathname).toBe('https://github.com/nicholaspjm/gobo-dmx-live-code/issues/new');
    expect(url.searchParams.get('template')).toBe('bug_report.yml');
    expect(url.searchParams.get('environment')).toBe(environmentText(env));
  });

  it('writes one fact per line, each labelled', () => {
    const lines = environmentText(env).split('\n');
    expect(lines).toContain('gobo: 0.5.0');
    expect(lines).toContain('running as: the website');
    expect(lines).toContain('output: artnet');
    expect(lines).toHaveLength(7);
  });
});

describe('what it leaves out', () => {
  it('never names an address it was not built to name', () => {
    // A page served from a LAN address or a private host says only that.
    expect(routeName({ desktop: false, hostname: '192.168.1.20', port: '3001' })).toBe('a copy served from another address');
    expect(routeName({ desktop: false, hostname: 'lights.venue.internal', port: '' })).toBe('a copy served from another address');
  });
});

describe('how it is being run', () => {
  it('tells the routes apart', () => {
    expect(routeName({ desktop: true, hostname: 'localhost', port: '3001' })).toBe('the desktop app');
    expect(routeName({ desktop: false, hostname: 'gobolive.cc', port: '' })).toBe('the website');
    expect(routeName({ desktop: false, hostname: 'nicholaspjm.github.io', port: '' })).toBe('the website, at its old address');
    expect(routeName({ desktop: false, hostname: 'localhost', port: '3001' })).toBe('npm start, on localhost:3001');
    expect(routeName({ desktop: false, hostname: '127.0.0.1', port: '3000' })).toBe('npm run dev');
    expect(routeName({ desktop: false, hostname: '[::1]', port: '4173' })).toBe('a local copy on port 4173');
  });

  it('does not take a lookalike host for the website', () => {
    expect(routeName({ desktop: false, hostname: 'nicholaspjm.github.io.example', port: '' })).toBe('a copy served from another address');
    expect(routeName({ desktop: false, hostname: 'gobolive.cc.example', port: '' })).toBe('a copy served from another address');
  });
});

describe('the browser and system', () => {
  const CHROME_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.7977.130 Safari/537.36';
  const EDGE_WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36 Edg/150.0.0.0';
  const FIREFOX_LINUX = 'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0';
  const SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Safari/605.1.15';

  it('names each browser rather than the ones it imitates', () => {
    expect(browserName(CHROME_MAC)).toBe('Chrome 152');
    expect(browserName(EDGE_WIN)).toBe('Microsoft Edge 150');
    expect(browserName(FIREFOX_LINUX)).toBe('Firefox 140');
    expect(browserName(SAFARI)).toBe('Safari 19');
  });

  it('prefers the brand list where a Chromium browser offers one', () => {
    const brands = [{ brand: 'Not.A/Brand', version: '99' }, { brand: 'Microsoft Edge', version: '150' }];
    expect(browserName(CHROME_MAC, brands)).toBe('Microsoft Edge 150');
  });

  it('names the system family', () => {
    expect(systemName(CHROME_MAC)).toBe('macOS');
    expect(systemName(EDGE_WIN)).toBe('Windows');
    expect(systemName(FIREFOX_LINUX)).toBe('Linux');
    expect(systemName('', 'macOS')).toBe('macOS');
  });
});
