/**
 * Whether the browser lets this page reach programs on this computer.
 *
 * THE PROBLEM THIS EXISTS TO FIX
 * Chrome now asks before a website may talk to anything on the visitor's own
 * machine, and the connector on localhost:3001 is exactly that. Until the
 * visitor allows it, the page's WebSocket fails inside the browser in about a
 * millisecond, before anything reaches the connector — so from the page it
 * looks precisely like no connector at all. The banner then offered a download
 * to someone who had the connector running, and the connector's own log said
 * nothing, because nothing ever arrived.
 *
 * The page cannot tell "blocked" from "not running" by watching the socket. It
 * can ask the Permissions API, which is what this does, and it can hear the
 * answer change, which is when to stop waiting out the reconnect backoff.
 *
 * Only a page served from somewhere else is ever blocked. A page on localhost
 * talking to localhost is not reaching into another address space, so the
 * local routes — the desktop app, npm start, npm run dev — never meet this.
 */

import { bridgeHost } from '@gobo/core';

export type LocalAccess = 'granted' | 'prompt' | 'denied' | 'unknown';

/** Whether this page was served from this computer: the desktop app, npm
 *  start, npm run dev. */
export function servedLocally(): boolean {
  // location.hostname wraps an IPv6 literal in brackets, so ::1 arrives as
  // "[::1]" and a bare equality check misses it.
  const h = window.location.hostname.replace(/^\[|\]$/g, '');
  return h === 'localhost' || h === '127.0.0.1' || h === '::1';
}

/**
 * Whether the browser, not the connector, is why nothing is connected.
 *
 * Only for a page served from somewhere public that looks for the connector on
 * localhost. localhost talking to localhost is not a request the browser asks
 * about, and a page served from a LAN address looks for the connector at that
 * same address, which the permission does not cover either: saying "blocked"
 * there would send someone to change a setting that is not the problem.
 */
export function browserBlocksConnector(): boolean {
  return !servedLocally() && bridgeHost() === 'localhost' && _state === 'denied';
}

/**
 * Permission names to ask about, most specific first. `loopback-network` is
 * this computer only, which is what localhost:3001 needs; earlier versions
 * of the same feature had one umbrella name for everything local. A browser
 * that knows neither (Firefox and Safari, as of writing) throws on the query,
 * and that is 'unknown' rather than a guess.
 */
const PERMISSION_NAMES = ['loopback-network', 'local-network-access'];

let _state: LocalAccess = 'unknown';
const _listeners = new Set<(state: LocalAccess) => void>();

/** The last answer the browser gave. 'unknown' until watchLocalAccess settles. */
export function getLocalAccess(): LocalAccess {
  return _state;
}

/** Hear every change, including the first answer. */
export function onLocalAccessChange(fn: (state: LocalAccess) => void): void {
  _listeners.add(fn);
}

function set(state: LocalAccess): void {
  if (state === _state) return;
  _state = state;
  for (const fn of _listeners) fn(state);
}

/**
 * Ask once and keep listening. Safe to call from anywhere: a browser without
 * the Permissions API, or without either permission name, leaves the answer
 * at 'unknown' and nothing else happens.
 */
export async function watchLocalAccess(): Promise<LocalAccess> {
  if (typeof navigator === 'undefined' || !navigator.permissions?.query) return _state;
  for (const name of PERMISSION_NAMES) {
    let status: PermissionStatus;
    try {
      // The names are newer than the DOM typings, hence the cast.
      status = await navigator.permissions.query({ name } as unknown as PermissionDescriptor);
    } catch {
      continue;
    }
    status.addEventListener('change', () => set(status.state as LocalAccess));
    set(status.state as LocalAccess);
    return _state;
  }
  return _state;
}

/**
 * What to tell someone whose browser is blocking the connector.
 *
 * Both ways out are named, because the second one is the one worth knowing
 * about: running gobo locally means there is no permission to give.
 */
export const BLOCKED_BY_BROWSER =
  'Your browser is stopping this page from reaching programs on this computer, so it cannot '
  + 'reach the connector even if it is running. Allow local network access for this site from '
  + 'the icon beside the address, or run gobo locally — the desktop app or npm start — where '
  + 'there is nothing to allow.';
