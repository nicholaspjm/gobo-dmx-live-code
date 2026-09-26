/**
 * The connector replacing itself.
 *
 * Everything here decides whether a program gets run on someone's machine
 * without them looking, so the refusals matter as much as the happy path: no
 * update without a checksum, no update to a file that fails its checksum, no
 * update to a version that is not newer, nothing left half-written at the path
 * the login item starts.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHash } from 'crypto';
import { createServer, type Server } from 'http';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  assetNameFor,
  cleanupOld,
  download,
  downloadPathFor,
  isNewer,
  parseRelease,
  planUpdate,
  swapInPlace,
  type ReleaseAsset,
} from './updater.js';

const sha = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex');

function release(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    tag_name: 'v0.5.3',
    draft: false,
    prerelease: false,
    assets: [
      { name: 'gobo-connector-macos', browser_download_url: 'https://example.test/m', size: 10, digest: `sha256:${'a'.repeat(64)}` },
      { name: 'gobo-connector-linux', browser_download_url: 'https://example.test/l', size: 10, digest: `sha256:${'b'.repeat(64)}` },
      { name: 'gobo-connector-windows.exe', browser_download_url: 'https://example.test/w', size: 10 },
    ],
    ...overrides,
  };
}

describe("reading GitHub's answer", () => {
  it('takes the version from the tag and the checksum from the digest', () => {
    const r = parseRelease(release());
    expect(r?.version).toBe('0.5.3');
    expect(r?.assets.find((a) => a.name === 'gobo-connector-macos')?.sha256).toBe('a'.repeat(64));
    expect(r?.assets.find((a) => a.name === 'gobo-connector-windows.exe')?.sha256).toBeNull();
  });

  it('refuses a draft, a prerelease, or a tag that is not a plain version', () => {
    expect(parseRelease(release({ draft: true }))).toBeNull();
    expect(parseRelease(release({ prerelease: true }))).toBeNull();
    expect(parseRelease(release({ tag_name: 'v0.6.0-rc.1' }))).toBeNull();
    expect(parseRelease(release({ tag_name: 'latest' }))).toBeNull();
  });

  it('refuses anything that is not a release at all', () => {
    for (const junk of [null, 'text', 42, [], { message: 'API rate limit exceeded' }]) {
      expect(parseRelease(junk)).toBeNull();
    }
  });
});

describe('which file runs here', () => {
  it('names the one built for this system', () => {
    expect(assetNameFor('darwin', 'arm64')).toBe('gobo-connector-macos');
    expect(assetNameFor('linux', 'x64')).toBe('gobo-connector-linux');
    expect(assetNameFor('win32', 'x64')).toBe('gobo-connector-windows.exe');
  });

  it('names none where nothing is built, rather than one that cannot start', () => {
    expect(assetNameFor('darwin', 'x64')).toBeNull();
    expect(assetNameFor('linux', 'arm64')).toBeNull();
    expect(assetNameFor('freebsd', 'x64')).toBeNull();
  });
});

describe('newer', () => {
  it('orders numbers as numbers', () => {
    expect(isNewer('0.5.2', '0.5.1')).toBe(true);
    expect(isNewer('0.10.0', '0.9.9')).toBe(true);
    expect(isNewer('1.0.0', '0.99.99')).toBe(true);
  });

  it('never goes sideways or back', () => {
    expect(isNewer('0.5.1', '0.5.1')).toBe(false);
    expect(isNewer('0.5.0', '0.5.1')).toBe(false);
    expect(isNewer('nonsense', '0.5.1')).toBe(false);
  });
});

describe('the plan', () => {
  it('updates to a newer release that has this file and its checksum', () => {
    const plan = planUpdate(parseRelease(release()), '0.5.2', 'darwin', 'arm64');
    expect(plan.update).toBe(true);
  });

  it('does nothing when this is the latest', () => {
    expect(planUpdate(parseRelease(release()), '0.5.3', 'darwin', 'arm64').update).toBe(false);
  });

  it('will not update to a file GitHub gave no checksum for', () => {
    const plan = planUpdate(parseRelease(release()), '0.5.2', 'win32', 'x64');
    expect(plan).toEqual({ update: false, reason: '0.5.3 published no checksum for gobo-connector-windows.exe' });
  });

  it('waits when the release does not have this file yet', () => {
    const partial = release({ assets: [] });
    expect(planUpdate(parseRelease(partial), '0.5.2', 'linux', 'x64').update).toBe(false);
  });
});

describe('the download', () => {
  const payload = Buffer.from('#!/bin/sh\necho 0.5.3\n');
  let server: Server;
  let base: string;
  let dir: string;

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === '/redirect') {
        res.writeHead(302, { Location: '/file' });
        res.end();
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      res.end(req.url === '/truncated' ? payload.subarray(0, 5) : payload);
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('no port');
    base = `http://127.0.0.1:${address.port}`;
    dir = mkdtempSync(join(tmpdir(), 'gobo-updater-'));
  });

  afterAll(async () => {
    await new Promise<void>((done) => server.close(() => done()));
    rmSync(dir, { recursive: true, force: true });
  });

  const asset = (path: string, over: Partial<ReleaseAsset> = {}): ReleaseAsset => ({
    name: 'gobo-connector-linux', url: `${base}${path}`, size: payload.length, sha256: sha(payload), ...over,
  });

  it('writes the file when its size and checksum match, following a redirect as GitHub does', async () => {
    const dest = join(dir, 'ok');
    await download(asset('/redirect'), dest);
    expect(readFileSync(dest)).toEqual(payload);
  });

  it('refuses a file whose checksum does not match, and leaves nothing behind', async () => {
    const dest = join(dir, 'tampered');
    await expect(download(asset('/file', { sha256: 'c'.repeat(64) }), dest)).rejects.toThrow(/does not match/);
    expect(existsSync(dest)).toBe(false);
  });

  it('refuses a download that was cut short', async () => {
    const dest = join(dir, 'short');
    await expect(download(asset('/truncated'), dest)).rejects.toThrow(/bytes/);
    expect(existsSync(dest)).toBe(false);
  });

  it('refuses to start without a checksum to check against', async () => {
    await expect(download(asset('/file', { sha256: null }), join(dir, 'none'))).rejects.toThrow(/checksum/);
  });
});

describe('the swap', () => {
  it('replaces the executable in one rename, so the path is never empty', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gobo-swap-'));
    const exe = join(dir, 'gobo-connector-macos');
    writeFileSync(exe, 'old');
    writeFileSync(downloadPathFor(exe, 'darwin'), 'new');
    swapInPlace(exe, downloadPathFor(exe, 'darwin'), 'darwin');
    expect(readFileSync(exe, 'utf8')).toBe('new');
    expect(existsSync(downloadPathFor(exe, 'darwin'))).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });

  it('steps a running Windows executable aside, and clears it up on the next start', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gobo-swap-'));
    const exe = join(dir, 'gobo-connector-windows.exe');
    const incoming = downloadPathFor(exe, 'win32');
    expect(incoming.endsWith('.update.exe')).toBe(true);
    writeFileSync(exe, 'old');
    writeFileSync(incoming, 'new');
    swapInPlace(exe, incoming, 'win32');
    expect(readFileSync(exe, 'utf8')).toBe('new');
    expect(readFileSync(`${exe}.old`, 'utf8')).toBe('old');
    cleanupOld(exe);
    expect(existsSync(`${exe}.old`)).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });

  it('puts the original back if the new file cannot be moved in', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gobo-swap-'));
    const exe = join(dir, 'gobo-connector-windows.exe');
    writeFileSync(exe, 'old');
    expect(() => swapInPlace(exe, join(dir, 'missing.update.exe'), 'win32')).toThrow();
    expect(readFileSync(exe, 'utf8')).toBe('old');
    rmSync(dir, { recursive: true, force: true });
  });
});
