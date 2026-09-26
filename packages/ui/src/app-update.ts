/**
 * Telling the desktop app that a newer gobo is out.
 *
 * The website is new on every load, and the connector replaces itself, but the
 * desktop app is an installer someone ran once, and nothing in it ever said a
 * release had come out. So it asks GitHub, at most twice a day, and when there
 * is a newer version it puts one quiet link in the top bar that goes to the
 * download. It never downloads anything itself: an app that replaced itself
 * would need signing to do it safely, which the installers do not have yet.
 *
 * Only the desktop build asks. The website has nothing to update, and a copy
 * run from a checkout is updated with git.
 */

// The module on its own rather than the package index, which reads `window`
// at import time through the bridge client.
import { compareVersions } from '@gobo/core/connector-version';

export const LATEST_RELEASE_API =
  'https://api.github.com/repos/nicholaspjm/gobo-dmx-live-code/releases/latest';
export const LATEST_RELEASE_PAGE =
  'https://github.com/nicholaspjm/gobo-dmx-live-code/releases/latest';

/** How long an answer from GitHub is trusted before asking again. */
export const CHECK_EVERY_MS = 12 * 60 * 60 * 1000;

const CACHE_KEY = 'gobo-app-update-v1';

export interface Cached {
  /** When GitHub was last asked, in ms since the epoch. */
  checkedAt: number;
  /** The latest release's version then, or null if the answer was unusable. */
  latest: string | null;
  /** The version whose link was clicked, so it is not offered again. */
  seen?: string;
}

/** The version a releases/latest answer names, or null for anything else. */
export function latestVersionOf(json: unknown): string | null {
  if (typeof json !== 'object' || json === null) return null;
  const r = json as Record<string, unknown>;
  if (r.draft === true || r.prerelease === true) return null;
  if (typeof r.tag_name !== 'string') return null;
  const v = r.tag_name.replace(/^v/, '');
  return /^\d+\.\d+\.\d+$/.test(v) ? v : null;
}

/** Whether to ask GitHub again, given what was cached and when. */
export function isStale(cached: Cached | null, now: number): boolean {
  return cached === null || now - cached.checkedAt >= CHECK_EVERY_MS || now < cached.checkedAt;
}

/** The version to offer, or null when there is nothing newer or it was already taken up. */
export function versionToOffer(current: string, cached: Cached | null): string | null {
  const latest = cached?.latest ?? null;
  if (latest === null) return null;
  const order = compareVersions(latest, current);
  if (order === null || order <= 0) return null;
  if (cached?.seen === latest) return null;
  return latest;
}

function readCache(): Cached | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as Partial<Cached>;
    if (typeof c.checkedAt !== 'number') return null;
    return {
      checkedAt: c.checkedAt,
      latest: typeof c.latest === 'string' ? c.latest : null,
      seen: typeof c.seen === 'string' ? c.seen : undefined,
    };
  } catch {
    return null;
  }
}

function writeCache(c: Cached): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(c));
  } catch {
    // Private mode or storage switched off: it asks again next time, no harm.
  }
}

/**
 * Check for a newer release and show `button` if there is one.
 *
 * Quiet on every failure. No network, GitHub's rate limit, a malformed
 * answer: the button stays hidden, which is exactly what "no update" looks
 * like, and none of them is worth a line in the log of a tool mid-show.
 */
export async function mountAppUpdate(opts: {
  button: HTMLButtonElement;
  current: string;
  fetchFn?: typeof fetch;
  now?: () => number;
}): Promise<void> {
  const { button, current } = opts;
  const now = opts.now ?? Date.now;
  const fetchFn = opts.fetchFn ?? fetch;
  let cached = readCache();

  if (isStale(cached, now())) {
    let latest: string | null = null;
    try {
      const res = await fetchFn(LATEST_RELEASE_API, { headers: { Accept: 'application/vnd.github+json' } });
      if (res.ok) latest = latestVersionOf(await res.json());
    } catch {
      // Offline, blocked, or GitHub down. Treated as no answer.
    }
    // A failed ask is cached too, so an offline machine does not ask on every
    // load; it keeps the last good answer rather than forgetting it.
    cached = { checkedAt: now(), latest: latest ?? cached?.latest ?? null, seen: cached?.seen };
    writeCache(cached);
  }

  const offer = versionToOffer(current, cached);
  if (offer === null) return;
  button.textContent = `${offer} is out`;
  button.title = `You have gobo ${current}. Click to get ${offer}: the download is on the release page.`;
  button.hidden = false;
  button.addEventListener('click', () => {
    // The desktop app hands a new window's URL to the system browser.
    window.open(LATEST_RELEASE_PAGE, '_blank', 'noopener');
    writeCache({ ...(cached as Cached), seen: offer });
    button.hidden = true;
  }, { once: true });
}
