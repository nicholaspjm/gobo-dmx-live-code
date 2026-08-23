/**
 * The version handshake, tested where it can be: no socket, no DOM.
 *
 * The case worth guarding hardest is silence. Every connector released so far
 * says nothing at all, so "no message" has to come out as "older than the build
 * that started saying" rather than as "unknown", which is what sent the original
 * investigation looking at the wrong thing three times.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  APP_VERSION,
  HANDSHAKE_SINCE,
  compareVersions,
  connectorAge,
  connectorNotice,
  parseConnectorMessage,
} from './connector-version.js';

function versionOf(relative: string): string {
  const pkg = JSON.parse(readFileSync(new URL(relative, import.meta.url), 'utf8')) as { version: string };
  return pkg.version;
}

describe('APP_VERSION', () => {
  it('matches the version this repository ships', () => {
    // Every package here moves on one tag, so a half-finished bump is the drift
    // to catch. A page claiming a version it is not would report the wrong
    // expectation to someone chasing a stale connector.
    expect(APP_VERSION).toBe(versionOf('../../../package.json'));
    expect(APP_VERSION).toBe(versionOf('../package.json'));
    expect(APP_VERSION).toBe(versionOf('../../ui/package.json'));
  });
});

describe('compareVersions', () => {
  it('orders older, same and newer', () => {
    expect(compareVersions('0.2.0', '0.3.0')).toBeLessThan(0);
    expect(compareVersions('0.3.0', '0.3.0')).toBe(0);
    expect(compareVersions('0.4.0', '0.3.0')).toBeGreaterThan(0);
  });

  it('compares numbers rather than text, so 0.10 beats 0.9', () => {
    expect(compareVersions('0.10.0', '0.9.0')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0', '0.99.99')).toBeGreaterThan(0);
  });

  it('treats a missing part as zero', () => {
    expect(compareVersions('0.3', '0.3.0')).toBe(0);
    expect(compareVersions('1', '1.0.0')).toBe(0);
    expect(compareVersions('0.3', '0.3.1')).toBeLessThan(0);
  });

  it('accepts a leading v, which release tags carry', () => {
    expect(compareVersions('v0.3.0', '0.3.0')).toBe(0);
  });

  it('ignores a prerelease or build suffix rather than ordering it', () => {
    // A release candidate of a version has that version's fixes. Calling it
    // older would send someone after an update they already have.
    expect(compareVersions('0.3.0-rc.1', '0.3.0')).toBe(0);
    expect(compareVersions('0.3.0+build7', '0.3.0')).toBe(0);
  });

  it('returns null for anything that is not a version', () => {
    expect(compareVersions('wallpaper', '0.3.0')).toBeNull();
    expect(compareVersions('0.3.0', '')).toBeNull();
    expect(compareVersions('0.3.', '0.3.0')).toBeNull();
    expect(compareVersions('0.x.0', '0.3.0')).toBeNull();
  });
});

describe('parseConnectorMessage', () => {
  it('reads a hello', () => {
    expect(parseConnectorMessage('{"type":"hello","version":"0.3.0"}')).toEqual({
      type: 'hello',
      version: '0.3.0',
    });
  });

  it('keeps only the fields it knows', () => {
    const msg = parseConnectorMessage('{"type":"hello","version":"0.3.0","pid":41,"host":"x"}');
    expect(msg).toEqual({ type: 'hello', version: '0.3.0' });
  });

  it('ignores a message type it has not been taught', () => {
    // The next one is likely to be throughput counts, sent by a connector newer
    // than this page. Nothing about that is an error.
    expect(parseConnectorMessage('{"type":"stats","frames":900}')).toBeNull();
  });

  it('ignores malformed and non-text frames', () => {
    expect(parseConnectorMessage('{"type":"hello"')).toBeNull();
    expect(parseConnectorMessage('')).toBeNull();
    expect(parseConnectorMessage('not json at all')).toBeNull();
    expect(parseConnectorMessage(new ArrayBuffer(8))).toBeNull();
    expect(parseConnectorMessage(undefined)).toBeNull();
    expect(parseConnectorMessage(null)).toBeNull();
  });

  it('ignores JSON that is not an object', () => {
    expect(parseConnectorMessage('null')).toBeNull();
    expect(parseConnectorMessage('7')).toBeNull();
    expect(parseConnectorMessage('"hello"')).toBeNull();
    expect(parseConnectorMessage('["hello","0.3.0"]')).toBeNull();
  });

  it('ignores a hello with no usable version', () => {
    expect(parseConnectorMessage('{"type":"hello"}')).toBeNull();
    expect(parseConnectorMessage('{"type":"hello","version":""}')).toBeNull();
    expect(parseConnectorMessage('{"type":"hello","version":"   "}')).toBeNull();
    expect(parseConnectorMessage('{"type":"hello","version":3}')).toBeNull();
    expect(parseConnectorMessage('{"type":"hello","version":null}')).toBeNull();
  });
});

describe('connectorAge', () => {
  it('waits while a hello could still arrive', () => {
    expect(connectorAge({ version: null, settled: false }, '0.3.0')).toBe('waiting');
  });

  it('reads lasting silence as a connector older than the handshake', () => {
    expect(connectorAge({ version: null, settled: true }, '0.3.0')).toBe('pre-handshake');
  });

  it('places a version against the app', () => {
    expect(connectorAge({ version: '0.2.0', settled: true }, '0.3.0')).toBe('behind');
    expect(connectorAge({ version: '0.3.0', settled: true }, '0.3.0')).toBe('match');
    expect(connectorAge({ version: '0.4.0', settled: true }, '0.3.0')).toBe('ahead');
  });

  it('says so when the version cannot be read', () => {
    expect(connectorAge({ version: 'wallpaper', settled: true }, '0.3.0')).toBe('unreadable');
  });
});

describe('connectorNotice', () => {
  it('says nothing when no connector is there', () => {
    expect(connectorNotice(null, '0.3.0')).toBeNull();
  });

  it('says nothing while a hello could still arrive', () => {
    expect(connectorNotice({ version: null, settled: false }, '0.3.0')).toBeNull();
  });

  it('says nothing when the versions match', () => {
    expect(connectorNotice({ version: '0.3.0', settled: true }, '0.3.0')).toBeNull();
  });

  it('says nothing about a version it cannot read', () => {
    // It announced itself, so it is new enough to have the handshake. That was
    // the part that mattered, and the string is no use to anyone.
    expect(connectorNotice({ version: 'wallpaper', settled: true }, '0.3.0')).toBeNull();
  });

  it('names both versions when the connector is behind', () => {
    const notice = connectorNotice({ version: '0.2.0', settled: true }, '0.3.0');
    expect(notice?.level).toBe('stale');
    expect(notice?.reason).toContain('0.2.0');
    expect(notice?.reason).toContain('0.3.0');
    // It still works. Whatever this says must not read as output being stopped.
    expect(notice?.reason).toContain('Output still goes out.');
    expect(notice?.fix).toBeTruthy();
  });

  it('treats silence as behind, and points at the version that started saying', () => {
    const notice = connectorNotice({ version: null, settled: true }, '0.3.0');
    expect(notice?.level).toBe('stale');
    expect(notice?.reason).toContain(HANDSHAKE_SINCE);
    expect(notice?.reason).toContain('older');
    expect(notice?.fix).toBeTruthy();
  });

  it('tells someone how to replace the copy that starts at login', () => {
    // The trap the original investigation fell into: a new binary replaces the
    // running process but not the login item, so tomorrow starts the old one.
    const notice = connectorNotice({ version: null, settled: true }, '0.3.0');
    expect(notice?.fix).toContain('--uninstall');
    expect(notice?.fix).toContain('log in');
  });

  it('notes a newer connector quietly and asks for nothing', () => {
    const notice = connectorNotice({ version: '0.4.0', settled: true }, '0.3.0');
    expect(notice?.level).toBe('note');
    expect(notice?.fix).toBeNull();
    expect(notice?.reason).toContain('0.4.0');
  });

  it('falls back to the version this build was released as', () => {
    expect(connectorNotice({ version: APP_VERSION, settled: true })).toBeNull();
    expect(connectorNotice({ version: null, settled: true })?.level).toBe('stale');
  });
});
