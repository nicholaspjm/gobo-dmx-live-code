/**
 * The connector keeping itself current.
 *
 * THE PROBLEM THIS EXISTS TO FIX
 * The downloaded connector installs a login item and then runs for months. A
 * stale one has already started two investigations on this project, and 0.5.0
 * made the cost worse: every connector before it took connections from any
 * website. The page can say a connector is behind, but replacing one meant a
 * download, a security prompt and an --uninstall dance for the login item, and
 * most people will not do that for a patch release.
 *
 * WHAT IT DOES
 * Asks GitHub for the latest release, and if it is newer than this build,
 * downloads the file for this system and checks it against the SHA-256 GitHub
 * published for that file, and its size. Then runs it once with --version, so
 * a file that cannot start here is never swapped in, and renames it over this
 * executable. The login item names a path, not a version, so it goes on
 * pointing at the right thing.
 *
 * WHAT IT WILL NOT DO
 * Restart under a show. index.ts only swaps and restarts once nothing has been
 * connected for a while, so an update lands at login, or after the tab is
 * closed, never while a page is driving the rig. It does not run for a copy a
 * package manager owns (Homebrew upgrades those), for npm (npx fetches the
 * latest itself), inside the desktop app, or in CI.
 *
 * This module is the parts worth testing, with no timers and no process
 * lifecycle in it. index.ts decides when.
 */

import { createHash } from 'crypto';
import { createWriteStream, existsSync, renameSync, rmSync, unlinkSync, chmodSync } from 'fs';
import { Readable, Transform } from 'stream';
import { pipeline } from 'stream/promises';

export const RELEASES_API = 'https://api.github.com/repos/nicholaspjm/gobo-dmx-live-code/releases/latest';

export interface ReleaseAsset {
  name: string;
  url: string;
  size: number;
  /** Lowercase hex, from GitHub's own digest for the file. Null when it gave none. */
  sha256: string | null;
}

export interface LatestRelease {
  version: string;
  assets: ReleaseAsset[];
}

/**
 * Read GitHub's answer, or null if it is not one to act on.
 *
 * Drafts and prereleases are refused here as well as by the endpoint: a beta
 * tester opting into one is one thing, a login item pulling it in is another.
 */
export function parseRelease(json: unknown): LatestRelease | null {
  if (typeof json !== 'object' || json === null) return null;
  const r = json as Record<string, unknown>;
  if (r.draft === true || r.prerelease === true) return null;
  if (typeof r.tag_name !== 'string') return null;
  const version = r.tag_name.replace(/^v/, '');
  if (!/^\d+\.\d+\.\d+$/.test(version)) return null;
  if (!Array.isArray(r.assets)) return null;
  const assets: ReleaseAsset[] = [];
  for (const a of r.assets as unknown[]) {
    if (typeof a !== 'object' || a === null) continue;
    const x = a as Record<string, unknown>;
    if (typeof x.name !== 'string' || typeof x.browser_download_url !== 'string' || typeof x.size !== 'number') continue;
    const digest = typeof x.digest === 'string' ? /^sha256:([0-9a-f]{64})$/i.exec(x.digest) : null;
    assets.push({
      name: x.name,
      url: x.browser_download_url,
      size: x.size,
      sha256: digest ? digest[1].toLowerCase() : null,
    });
  }
  return { version, assets };
}

/**
 * The release file that runs on this system, or null if none does.
 *
 * Each connector is a copy of the node binary it was built on, so it runs on
 * that architecture only: the macOS one is Apple Silicon, the Linux one x86_64.
 * An Intel Mac has no file to update to, and is told so rather than handed one
 * that cannot start.
 */
export function assetNameFor(platform: string, arch: string): string | null {
  if (platform === 'darwin' && arch === 'arm64') return 'gobo-connector-macos';
  if (platform === 'linux' && arch === 'x64') return 'gobo-connector-linux';
  if (platform === 'win32' && arch === 'x64') return 'gobo-connector-windows.exe';
  return null;
}

/** Whether `candidate` is a later x.y.z than `current`. Anything unreadable is not. */
export function isNewer(candidate: string, current: string): boolean {
  const parse = (v: string): number[] | null => {
    const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(v.trim());
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
  };
  const a = parse(candidate);
  const b = parse(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

export type Plan =
  | { update: true; version: string; asset: ReleaseAsset }
  | { update: false; reason: string };

/** What to do about the latest release, and if nothing, why not. */
export function planUpdate(release: LatestRelease | null, current: string, platform: string, arch: string): Plan {
  if (!release) return { update: false, reason: 'no usable release' };
  if (!isNewer(release.version, current)) return { update: false, reason: `${current} is the latest` };
  const name = assetNameFor(platform, arch);
  if (!name) return { update: false, reason: `no ${release.version} connector is built for ${platform} ${arch}` };
  const asset = release.assets.find((a) => a.name === name);
  if (!asset) return { update: false, reason: `${release.version} has no ${name} yet` };
  // No checksum, no update. The file is about to be run without anyone looking
  // at it, and a download that was cut short or altered must not be the one.
  if (!asset.sha256) return { update: false, reason: `${release.version} published no checksum for ${name}` };
  return { update: true, version: release.version, asset };
}

type FetchLike = (url: string, init?: { headers?: Record<string, string> }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  body: ReadableStream<Uint8Array> | null;
}>;

/**
 * Ask GitHub for the latest release. Throws on anything but a readable answer.
 *
 * GOBO_UPDATE_API points it somewhere else, which is how the whole path is
 * exercised against a stand-in release without publishing one. It gives
 * nothing away: anything that can set the environment of the connector's
 * process can already replace the connector.
 */
export async function fetchLatest(
  userAgent: string,
  fetchFn: FetchLike = fetch as unknown as FetchLike,
  url: string = process.env.GOBO_UPDATE_API ?? RELEASES_API,
): Promise<LatestRelease | null> {
  const res = await fetchFn(url, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': userAgent },
  });
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
  return parseRelease(await res.json());
}

/**
 * Download `asset` to `dest`, checking its size and SHA-256 on the way.
 *
 * Streamed to disk rather than held in memory: the file is the whole node
 * runtime, near 100 MB, and this can run on a small machine that is doing
 * other things. On any mismatch the partial file is removed and it throws, so
 * nothing half-written is left to be mistaken for the new version.
 */
export async function download(asset: ReleaseAsset, dest: string, fetchFn: FetchLike = fetch as unknown as FetchLike): Promise<void> {
  if (!asset.sha256) throw new Error('no checksum to check against');
  const res = await fetchFn(asset.url, { headers: { Accept: 'application/octet-stream' } });
  if (!res.ok || !res.body) throw new Error(`download answered ${res.status}`);
  const hash = createHash('sha256');
  let size = 0;
  // Measured inside the pipeline rather than beside it, so every byte that is
  // written is a byte that was counted and hashed, in order.
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      hash.update(chunk);
      size += chunk.length;
      done(null, chunk);
    },
  });
  const source = Readable.fromWeb(res.body as unknown as Parameters<typeof Readable.fromWeb>[0]);
  try {
    await pipeline(source, meter, createWriteStream(dest, { mode: 0o755 }));
    if (size !== asset.size) throw new Error(`expected ${asset.size} bytes and received ${size}`);
    const got = hash.digest('hex');
    if (got !== asset.sha256) throw new Error(`checksum ${got} does not match the published ${asset.sha256}`);
  } catch (err) {
    rmSync(dest, { force: true });
    throw err;
  }
  // The mode on the write stream only applies if the file is new, and umask
  // trims it; the execute bit is what makes it a program, so it is set again.
  if (process.platform !== 'win32') chmodSync(dest, 0o755);
}

/**
 * Put `newFile` where `execPath` is.
 *
 * A rename within one directory, so the swap is atomic: anything starting the
 * connector at that moment gets the old file or the new one, never half of
 * either. A running program keeps its own copy open, so on macOS and Linux the
 * rename can go straight over it. Windows will not let a running .exe be
 * replaced but will let it be renamed, so it steps aside first and the next
 * start clears it up (see cleanupOld).
 */
export function swapInPlace(execPath: string, newFile: string, platform: string = process.platform): void {
  if (platform === 'win32') {
    const old = `${execPath}.old`;
    rmSync(old, { force: true });
    renameSync(execPath, old);
    try {
      renameSync(newFile, execPath);
    } catch (err) {
      // Put the original back rather than leave nothing at the path the login
      // item starts.
      renameSync(old, execPath);
      throw err;
    }
    return;
  }
  renameSync(newFile, execPath);
}

/** Remove what a Windows swap left beside the executable, if anything. */
export function cleanupOld(execPath: string): void {
  const old = `${execPath}.old`;
  try {
    if (existsSync(old)) unlinkSync(old);
  } catch {
    // Still in use by the previous run on its way out; the next start gets it.
  }
}

/**
 * Where a download for `execPath` is written: beside it, so the swap is a
 * rename on one filesystem. On Windows it keeps an .exe ending, because it is
 * run once with --version before the swap and Windows goes by the extension.
 */
export function downloadPathFor(execPath: string, platform: string = process.platform): string {
  return platform === 'win32' ? `${execPath.replace(/\.exe$/i, '')}.update.exe` : `${execPath}.download`;
}
