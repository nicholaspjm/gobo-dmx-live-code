/**
 * The one thing that can go wrong with a version written out by hand is that
 * someone bumps package.json and not the constant. The connector would then
 * announce a version it is not, which is worse than announcing none: the page
 * believes what it is told and would go quiet about a build that is missing
 * fixes. So the two are compared here, against the file on disk.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { CONNECTOR_VERSION, connectorHello } from './version.js';

describe('CONNECTOR_VERSION', () => {
  it('matches packages/bridge/package.json', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
    expect(CONNECTOR_VERSION).toBe(pkg.version);
  });

  it('is a plain dotted version, which is all the page knows how to compare', () => {
    expect(CONNECTOR_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe('connectorHello', () => {
  it('carries the version under a discriminating type', () => {
    expect(connectorHello()).toEqual({ type: 'hello', version: CONNECTOR_VERSION });
  });

  it('survives the JSON round trip the socket puts it through', () => {
    const sent = JSON.stringify(connectorHello());
    expect(JSON.parse(sent)).toEqual({ type: 'hello', version: CONNECTOR_VERSION });
  });
});
