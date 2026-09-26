/**
 * Who the connector will talk to.
 *
 * THE PROBLEM THIS EXISTS TO FIX
 * The connector installs itself as a login item and then sits on tcp/3001 for
 * as long as the machine is on. It used to listen on every network interface
 * and accept a WebSocket from anything that asked, and a browser does not apply
 * same-origin rules to WebSockets. So any web page open on the operator's
 * machine could connect, stream DMX at the rig, and repoint the Art-Net or OSC
 * output at any host and port it liked; so could anything else on the same
 * café wifi. SECURITY.md said so plainly, as accepted risk, and it was
 * reasonable to accept for one person on a trusted network. It is not
 * reasonable for a program strangers download and leave running in the
 * background.
 *
 * THE THREE CHECKS
 *   1. Where it listens. Loopback only, unless the operator passes --lan.
 *   2. The Origin of a WebSocket. Every browser sends one on a WebSocket
 *      handshake, and a page cannot forge it, so this is what stops a page on
 *      some other site from connecting. Allowed: pages served from this
 *      machine's loopback, the hosted app, and anything named with
 *      --allow-origin. A connection with no Origin at all is not a browser —
 *      doctor.mjs, a test, a script — and is let through, because a program
 *      already running on this machine can send UDP itself and refusing it
 *      would protect nothing.
 *   3. The Host header, on every request. This is the DNS-rebinding defence. A
 *      page on attacker.example can make that name resolve to 127.0.0.1 and then
 *      talk to "its own" origin, which passes an Origin check that only compares
 *      Origin with Host. A name the attacker controls never passes this one: the
 *      Host has to be an IP literal, which cannot be rebound, or localhost, or —
 *      in LAN mode — one of this machine's own names.
 *
 * Its own module because index.ts starts listening the moment it is imported,
 * and these rules are the part worth testing. serve-ui.ts, frames.ts and osc.ts
 * are split out for the same reason.
 */

import { isIP } from 'net';

/** How the connector was told to behave, from its flags. */
export interface AccessOptions {
  /** Listen on every interface rather than loopback only. Off unless --lan. */
  lan: boolean;
  /** Origins added with --allow-origin, already normalised. */
  extraOrigins: string[];
  /** --allow-origin values that were not an http(s) origin, for a warning. */
  invalid: string[];
}

export interface AccessPolicy {
  lan: boolean;
  /** Exact origins allowed besides loopback pages. */
  origins: ReadonlySet<string>;
  /**
   * This machine's own addresses and names, read when asked rather than once,
   * because a DHCP lease can change them while the connector runs for days.
   * Only consulted in LAN mode.
   */
  ownHosts: () => ReadonlySet<string>;
}

/** Which check turned a request away, so the log can say what would fix it. */
export type Check = 'host' | 'origin';

export type Verdict = { ok: true } | { ok: false; check: Check; reason: string };

const OK: Verdict = { ok: true };

/** The addresses to bind. `undefined` is Node's "every interface". */
export function bindAddresses(lan: boolean): (string | undefined)[] {
  // Both loopbacks, not one. A browser asked for localhost may try ::1 first,
  // and the desktop app loads http://localhost:3001; binding 127.0.0.1 alone
  // would lean on every client falling back quietly, and leave ::1:3001 free
  // for something else to answer on.
  return lan ? [undefined] : ['127.0.0.1', '::1'];
}

/**
 * Read the flags that decide access.
 *
 * --lan takes no value. --allow-origin takes one and may be repeated. A value
 * that is not an http(s) origin is reported rather than dropped silently: a
 * mistyped origin means a page that cannot connect, and the log line is the
 * only place anyone will look.
 */
export function parseAccessArgs(argv: readonly string[]): AccessOptions {
  const lan = argv.includes('--lan');
  const extraOrigins: string[] = [];
  const invalid: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] !== '--allow-origin') continue;
    const value = argv[i + 1];
    i++;
    if (value === undefined || value.startsWith('--')) {
      invalid.push('(nothing given after --allow-origin)');
      if (value !== undefined) i--;
      continue;
    }
    const origin = normaliseOrigin(value);
    if (origin === null) invalid.push(value);
    else extraOrigins.push(origin);
  }
  return { lan, extraOrigins, invalid };
}

/**
 * An http(s) URL cut down to its origin, or null.
 *
 * Accepts a full URL as well as a bare origin, because the thing people have to
 * hand is the address bar, and https://someone.github.io/gobo/ should mean the
 * same as https://someone.github.io.
 */
export function normaliseOrigin(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  return url.origin;
}

export function createPolicy(opts: {
  lan: boolean;
  /** The hosted app, which is always allowed. */
  hostedApp: string;
  extraOrigins?: readonly string[];
  ownHosts?: () => ReadonlySet<string>;
}): AccessPolicy {
  const origins = new Set<string>(opts.extraOrigins ?? []);
  const hosted = normaliseOrigin(opts.hostedApp);
  if (hosted !== null) origins.add(hosted);
  return {
    lan: opts.lan,
    origins,
    ownHosts: opts.ownHosts ?? (() => new Set<string>()),
  };
}

/**
 * The host name out of a Host header or an origin's host, lowercased, with any
 * port, IPv6 brackets and trailing root dot removed. Null if there is none.
 */
export function hostnameOf(hostHeader: string): string | null {
  const trimmed = hostHeader.trim();
  if (trimmed === '') return null;
  let url: URL;
  try {
    url = new URL(`http://${trimmed}`);
  } catch {
    return null;
  }
  // A Host header is host[:port] and nothing else. Anything that parsed with a
  // path, a query or a user part was not one.
  if (url.pathname !== '/' || url.search !== '' || url.username !== '' || url.password !== '') return null;
  let name = url.hostname.toLowerCase();
  if (name.startsWith('[') && name.endsWith(']')) name = name.slice(1, -1);
  if (name.endsWith('.')) name = name.slice(0, -1);
  return name === '' ? null : name;
}

/** Whether a host name is this machine's own loopback. */
export function isLoopback(name: string): boolean {
  if (name === 'localhost') return true;
  if (isIP(name) === 4) return name.startsWith('127.');
  if (isIP(name) === 6) {
    if (name === '::1') return true;
    // An IPv4 loopback written as an IPv4-mapped IPv6 address. The URL parser
    // normalises these to hex, so both spellings are checked.
    const mapped = /^::ffff:(.+)$/.exec(name);
    if (mapped) {
      const tail = mapped[1];
      if (isIP(tail) === 4) return tail.startsWith('127.');
      return /^7f[0-9a-f]{2}:[0-9a-f]{1,4}$/.test(tail);
    }
  }
  return false;
}

/**
 * Is this Host header one a rebinding attack could not have produced?
 *
 * An IP literal cannot be rebound, so every one passes: in loopback mode nothing
 * but loopback can reach the socket anyway, and in LAN mode an address is
 * exactly what someone types. localhost passes. A name passes only in LAN mode,
 * and only if it is this machine's own.
 */
export function checkHost(hostHeader: string | undefined, policy: AccessPolicy): Verdict {
  if (hostHeader === undefined) {
    return { ok: false, check: 'host', reason: 'the request named no host' };
  }
  const name = hostnameOf(hostHeader);
  if (name === null) return { ok: false, check: 'host', reason: 'the request named no usable host' };
  if (isIP(name) !== 0 || name === 'localhost') return OK;
  if (policy.lan && policy.ownHosts().has(name)) return OK;
  return {
    ok: false,
    check: 'host',
    reason: policy.lan
      ? `${name} is not one of this machine's names or addresses`
      : `${name} is not localhost`,
  };
}

/**
 * Is this Origin allowed to open a WebSocket?
 *
 * No Origin means no browser, and is let through (see the top of this file).
 * "null" is refused: it is what a sandboxed iframe or a file:// page sends, and
 * a hostile page can put itself in a sandboxed iframe to get it.
 */
export function checkOrigin(origin: string | undefined, policy: AccessPolicy): Verdict {
  if (origin === undefined) return OK;
  if (origin === 'null') {
    return { ok: false, check: 'origin', reason: 'a sandboxed or local-file page cannot connect' };
  }
  const normal = normaliseOrigin(origin);
  if (normal === null) return { ok: false, check: 'origin', reason: 'that is not a web page origin' };
  if (policy.origins.has(normal)) return OK;
  const name = hostnameOf(new URL(normal).host);
  if (name !== null && isLoopback(name)) return OK;
  if (policy.lan && name !== null && policy.ownHosts().has(name)) return OK;
  return { ok: false, check: 'origin', reason: 'only gobo itself, and pages served from this computer, may connect' };
}

/** Both checks, for a WebSocket upgrade. Host first: it is the cheaper answer. */
export function checkUpgrade(
  headers: { host?: string; origin?: string },
  policy: AccessPolicy,
): Verdict {
  const host = checkHost(headers.host, policy);
  if (!host.ok) return host;
  return checkOrigin(headers.origin, policy);
}

/**
 * Make an untrusted header safe to print on one terminal line.
 *
 * The value came from whoever connected. Control characters would let it move
 * the cursor or recolour the log, and an unbounded one could fill the screen.
 */
export function printable(value: string, max = 120): string {
  let out = '';
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    out += code < 0x20 || code === 0x7f || (code >= 0x80 && code < 0xa0) ? '?' : ch;
  }
  return out.length > max ? `${out.slice(0, max - 1)}…` : out;
}
