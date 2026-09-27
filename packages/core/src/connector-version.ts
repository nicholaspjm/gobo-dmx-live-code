/**
 * The connector's announced version, and what the page should say about it.
 *
 * A connector is downloaded once and relaunched by a login item at every
 * login, so it can run for months without the fixes the page expects (a
 * blackout reaching the rig a bar late, for one). The connector announces its
 * version on connect; this decides what, if anything, the page says about it.
 *
 * Kept apart from websocket.ts so it can be tested: websocket.ts reads
 * window.location on import, so it cannot load without a DOM, and every other
 * route from @gobo/core into the UI goes through it or through Strudel, which
 * does not load under vitest either. Parsing, version comparison and the
 * notice text have no socket in them, so they live here where a test can
 * import them alone. osc.ts in the connector is split from index.ts for the
 * same reason.
 */

/**
 * This build's version.
 *
 * The page has no version of its own to read: vite bundles it from source with
 * no build-time define for one, and every package in this repository is
 * released together on a single tag, so this stands for the app.
 * connector-version.test.ts checks it against the package files on disk so it
 * cannot drift from what shipped.
 */
export const APP_VERSION = '0.7.4';

/**
 * The first connector that announces itself.
 *
 * Connectors older than this send nothing to the page, so a connector that
 * stays silent predates the handshake. This names the version that started
 * it, which stays correct as the app moves on; comparing against APP_VERSION
 * would not, since a 0.3.0 connector talking to a 0.9.0 page is behind but
 * still announces itself.
 */
export const HANDSHAKE_SINCE = '0.3.0';

/**
 * The first connector that refuses pages from other websites.
 *
 * Earlier connectors listened on every network interface and accepted a
 * WebSocket from anything, so any site open in the same browser could drive
 * the rig through them. A connector older than this needs replacing at once,
 * and the notice says so.
 */
export const ORIGIN_CHECK_SINCE = '0.5.0';

/** Said after the usual reason when the connector predates the origin check. */
const OPEN_TO_ANY_SITE =
  ' It is also old enough to accept connections from any website open in this browser, and from '
  + 'anything on the same network, so replace it now.';

/** The only message the connector sends. */
export interface ConnectorHello {
  type: 'hello';
  version: string;
  /**
   * Whether this connector replaces itself when a release comes out. Absent
   * from every connector before 0.5.2, which is read as no.
   */
  updates: boolean;
  /**
   * The IPv4 networks the connector's computer is on, so the outputs panel
   * can say which artnet() line reaches them. Empty from connectors before
   * 0.5.3, which do not send it.
   */
  networks: LocalNetwork[];
}

export interface LocalNetwork {
  /** The computer's own address on the network. */
  address: string;
  netmask: string;
  /** Reaches every node on the network at once. */
  broadcast: string;
}

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

/** The networks from a hello, keeping only well-formed entries, and a few of them. */
function readNetworks(raw: unknown): LocalNetwork[] {
  if (!Array.isArray(raw)) return [];
  const out: LocalNetwork[] = [];
  for (const n of raw.slice(0, 8)) {
    if (typeof n !== 'object' || n === null) continue;
    const { address, netmask, broadcast } = n as Record<string, unknown>;
    if (typeof address !== 'string' || typeof netmask !== 'string' || typeof broadcast !== 'string') continue;
    if (!IPV4.test(address) || !IPV4.test(netmask) || !IPV4.test(broadcast)) continue;
    out.push({ address, netmask, broadcast });
  }
  return out;
}

/** Whether `host` is an address on `net`. */
export function onNetwork(host: string, net: LocalNetwork): boolean {
  if (!IPV4.test(host)) return false;
  const int = (ip: string): number => ip.split('.').reduce((acc, p) => ((acc << 8) | Number(p)) >>> 0, 0);
  const mask = int(net.netmask);
  return (int(host) & mask) === (int(net.address) & mask);
}

/**
 * Read one frame off the bridge socket.
 *
 * Returns null, silently, for everything that is not a usable hello. The
 * channel has one message type and will gain more, so a page that rejected
 * unknown ones would break against the first connector newer than itself.
 * Binary frames, malformed JSON, a bare number, an array and a hello with no
 * usable version all return null.
 */
export function parseConnectorMessage(raw: unknown): ConnectorHello | null {
  // Text frames only. This end never asks for a Blob or an ArrayBuffer, and
  // reading one is asynchronous, which the caller is not.
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
  // Rebuilt field by field, so extra fields in the message are never stored
  // or displayed.
  return {
    type: 'hello',
    version: msg.version.trim(),
    updates: msg.updates === true,
    networks: readNetworks(msg.networks),
  };
}

/**
 * Order two dotted versions: negative when `a` is older, zero when they are the
 * same, positive when `a` is newer, and null when either is not a version this
 * can read.
 *
 * A subset of semver. A -rc or +build suffix is dropped, because a release
 * candidate of a version carries that version's fixes, and ordering it lower
 * would send someone after an update they already have. Comparison is numeric
 * per part, so 0.10 is newer than 0.9, which a string compare gets backwards.
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
  /** Whether it said it updates itself. False when it said nothing. */
  updates?: boolean;
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
  /** 'stale' can affect a show. 'note' is informational. */
  level: 'stale' | 'note';
  /** Two or three words, for a badge beside "connector running". */
  badge: string;
  /** The facts: which version is running, which the app expects, what it costs. */
  reason: string;
  /** What to do about it, or null when there is nothing to do. */
  fix: string | null;
}

/**
 * For a connector that replaces itself. It only does that while nothing is
 * connected, so it never restarts during a show; the page showing this notice
 * is the one thing connected, so closing the page lets the update run.
 */
const LET_IT_UPDATE =
  'It updates itself while nothing is connected to it, so close gobo for a couple of minutes '
  + 'and it restarts as the new version. Nothing to download.';

/**
 * Replacing the connector by hand, shared by both stale cases.
 *
 * The second sentence covers the easy mistake. The login item is a file naming
 * one path, and a connector only writes it when there is none, so downloading
 * and running a new binary replaces the process but the old one still starts
 * at the next login.
 */
const REPLACE_IT =
  'Download the current connector and run it, which replaces the one running now. '
  + 'The copy that starts when you log in is a separate file and is still the old version, so run the '
  + 'new one once with --uninstall and then once normally to replace that too.';

/**
 * What to say about this connector, or null when there is nothing to say.
 *
 * Nothing here is an error or blocks output: a connector behind the page
 * still carries every frame and is only missing later fixes. A connector
 * ahead of the page is harmless, so it gets one informational line. An
 * unreadable version gets no notice, because a connector that announces
 * itself at all is past the handshake.
 */
export function connectorNotice(
  report: ConnectorReport | null,
  appVersion: string = APP_VERSION,
): ConnectorNotice | null {
  if (!report) return null;

  switch (connectorAge(report, appVersion)) {
    case 'behind': {
      const open = (compareVersions(report.version as string, ORIGIN_CHECK_SINCE) ?? 0) < 0;
      return {
        level: 'stale',
        badge: open ? 'out of date · replace it' : 'out of date',
        reason:
          `The connector on this computer is version ${report.version} and this page is ${appVersion}, `
          + `so anything fixed since ${report.version} is missing from the program that reaches your rig. `
          + 'Output still goes out.'
          + (open ? OPEN_TO_ANY_SITE : ''),
        fix: report.updates === true ? LET_IT_UPDATE : REPLACE_IT,
      };
    }

    case 'pre-handshake':
      return {
        level: 'stale',
        badge: 'out of date · replace it',
        reason:
          'The connector on this computer never said which version it is. Every connector from '
          + `${HANDSHAKE_SINCE} onward does, so this one is older than that, and anything fixed since is `
          + 'missing from the program that reaches your rig. Output still goes out.'
          + OPEN_TO_ANY_SITE,
        fix: REPLACE_IT,
      };

    case 'ahead':
      return {
        level: 'note',
        badge: 'newer than this page',
        reason:
          `The connector on this computer is version ${report.version}, ahead of this page at ${appVersion}. `
          + 'Nothing to do: the page is the older of the two.',
        fix: null,
      };

    default:
      return null;
  }
}
