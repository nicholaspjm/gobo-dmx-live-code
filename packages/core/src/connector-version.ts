/**
 * Who the connector says it is, and whether that is old enough to say something
 * about.
 *
 * THE PROBLEM THIS EXISTS TO FIX
 * A blackout reached the rig a bar late. The fix had shipped days earlier, but
 * the connector doing the sending was built before it, downloaded once and
 * relaunched by a login item at every login since. The page had no way to know
 * and nothing on screen said so, and the same stale connector has now started
 * two separate investigations. The connector announces its version on connect;
 * this decides what, if anything, the page should say about it.
 *
 * WHY IT IS ITS OWN MODULE
 * websocket.ts reads window.location the moment it is imported, so nothing in
 * it can be loaded without a DOM, and every route from @gobo/core into the UI
 * goes through that file or through strudel, which will not load under vitest
 * either. Parsing the message, comparing the versions and deciding what to say
 * are the parts worth testing and the parts with no socket in them, so they
 * live here, where a test can import them on their own. osc.ts in the connector
 * was split out of index.ts for the same reason.
 */

/**
 * This build's version.
 *
 * The page has no version of its own to read: vite bundles it from source with
 * no build-time define for one, and every package in this repository is
 * released together on a single tag. So this stands for the app.
 * connector-version.test.ts checks it against the package files on disk, so it
 * cannot quietly drift away from what actually shipped.
 */
export const APP_VERSION = '0.3.0';

/**
 * The first connector that announces itself.
 *
 * Silence is the whole reason this constant exists. No connector released so
 * far sends anything toward the page, so hearing nothing does not mean the
 * version is unknown, it means the connector predates the handshake. Naming the
 * version that started it stays true as the app moves on, which comparing
 * against APP_VERSION would not: a 0.3.0 connector talking to a 0.9.0 page is
 * behind, but it is not silent.
 */
export const HANDSHAKE_SINCE = '0.3.0';

/** The only message the connector sends today. */
export interface ConnectorHello {
  type: 'hello';
  version: string;
}

/**
 * Read one frame off the bridge socket.
 *
 * Returns null for everything that is not a hello worth acting on, and says
 * nothing about it. This channel opened with one message type and will grow
 * more, so a page that objected to the ones it had not been taught yet would
 * break against the first connector newer than itself. Binary frames, malformed
 * JSON, a bare number, an array, a hello with no usable version: all null.
 */
export function parseConnectorMessage(raw: unknown): ConnectorHello | null {
  // Text frames only. A Blob or an ArrayBuffer is not something this end asked
  // for, and reading one is asynchronous, which the caller is not.
  if (typeof raw !== 'string') return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;

  const msg = parsed as Record<string, unknown>;
  if (msg.type !== 'hello') return null;
  if (typeof msg.version !== 'string' || msg.version.trim() === '') return null;
  // Rebuilt rather than passed through, so whatever else rode along cannot end
  // up stored and later displayed.
  return { type: 'hello', version: msg.version.trim() };
}

/**
 * Order two dotted versions: negative when `a` is older, zero when they are the
 * same, positive when `a` is newer, and null when either is not a version this
 * can read.
 *
 * As much of semver as the question needs and no more. A -rc or +build suffix
 * is dropped rather than ordered, because a release candidate of a version
 * carries that version's fixes, and telling someone otherwise sends them
 * chasing an update they already have. Comparison is numeric per part, so 0.10
 * is correctly newer than 0.9, which a string compare gets backwards.
 */
export function compareVersions(a: string, b: string): number | null {
  const left = versionParts(a);
  const right = versionParts(b);
  if (!left || !right) return null;

  const len = Math.max(left.length, right.length);
  for (let i = 0; i < len; i++) {
    // A missing part is zero, so 0.3 and 0.3.0 are the same version.
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

function versionParts(version: string): number[] | null {
  const core = version.trim().replace(/^v/i, '').split(/[-+]/)[0];
  if (core === '') return null;

  const out: number[] = [];
  for (const part of core.split('.')) {
    if (!/^\d+$/.test(part)) return null;
    out.push(Number(part));
  }
  return out;
}

/** What the page knows about the connector it is talking to. */
export interface ConnectorReport {
  /** The version it announced, or null if it has announced none. */
  version: string | null;
  /**
   * False while a hello could still turn up. Silence only means something once
   * it has lasted longer than the message would take to arrive.
   */
  settled: boolean;
}

export type ConnectorAge =
  /** Connected, and a hello may still be on its way. */
  | 'waiting'
  /** Long enough with no hello that there was never going to be one. */
  | 'pre-handshake'
  | 'behind'
  | 'match'
  | 'ahead'
  /** It announced a version, but not one that can be compared with ours. */
  | 'unreadable';

export function connectorAge(report: ConnectorReport, appVersion: string = APP_VERSION): ConnectorAge {
  if (report.version === null) return report.settled ? 'pre-handshake' : 'waiting';

  const order = compareVersions(report.version, appVersion);
  if (order === null) return 'unreadable';
  if (order < 0) return 'behind';
  if (order > 0) return 'ahead';
  return 'match';
}

export interface ConnectorNotice {
  /** 'stale' is the one that costs a show. 'note' is worth a glance at most. */
  level: 'stale' | 'note';
  /** Two or three words, for a badge beside "connector running". */
  badge: string;
  /** The facts: which version is running, which the app expects, what it costs. */
  reason: string;
  /** What to do about it, or null when there is nothing to do. */
  fix: string | null;
}

/**
 * Replacing the connector, said once so both stale cases say it the same way.
 *
 * The second sentence is the trap the original investigation fell into. The
 * login item is a file naming one path, and a connector only writes it when
 * there is none, so downloading a new binary and running it replaces the
 * process but leaves the old one starting tomorrow morning.
 */
const REPLACE_IT =
  'Download the current connector and run it, which replaces the one running now. '
  + 'The copy that starts when you log in is a separate thing and is still the old file, so run the '
  + 'new one once with --uninstall and then once normally to move that over too.';

/**
 * What to say about this connector, or null when there is nothing worth saying.
 *
 * Nothing here is an error and nothing here blocks: a connector behind the page
 * still carries every frame, it is only missing whatever has been fixed since.
 * A connector ahead of the page is not a problem at all, so it gets one quiet
 * line. A version that cannot be read is left alone: whatever it says, it is
 * new enough to have announced itself, which is the part that mattered.
 */
export function connectorNotice(
  report: ConnectorReport | null,
  appVersion: string = APP_VERSION,
): ConnectorNotice | null {
  if (!report) return null;

  switch (connectorAge(report, appVersion)) {
    case 'behind':
      return {
        level: 'stale',
        badge: 'out of date',
        reason:
          `The connector on this computer is version ${report.version} and this page is ${appVersion}, `
          + `so anything fixed since ${report.version} is missing from the program that reaches your rig. `
          + 'Output still goes out.',
        fix: REPLACE_IT,
      };

    case 'pre-handshake':
      return {
        level: 'stale',
        badge: 'out of date',
        reason:
          'The connector on this computer never said which version it is. Every connector from '
          + `${HANDSHAKE_SINCE} onward does, so this one is older than that, and anything fixed since is `
          + 'missing from the program that reaches your rig. Output still goes out.',
        fix: REPLACE_IT,
      };

    case 'ahead':
      return {
        level: 'note',
        badge: 'newer than this page',
        reason:
          `The connector on this computer is version ${report.version}, ahead of this page at ${appVersion}. `
          + 'Nothing to do: it is the page that is behind.',
        fix: null,
      };

    default:
      return null;
  }
}
