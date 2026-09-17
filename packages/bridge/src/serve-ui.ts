/**
 * Path containment for the static file server.
 *
 * Its own module because index.ts starts a server the moment it is imported,
 * and this rule is worth a test. frames.ts and osc.ts are split out for the
 * same reason.
 */

import { sep } from 'path';

/**
 * Is this resolved path really inside the root?
 *
 * Compared against the root plus a separator rather than the bare root,
 * because startsWith is a string test and not a path test: a root of
 * /srv/dist also matches /srv/dist-backup, so a request for
 * /../dist-backup/.env resolved outside the build and was served. A versioned
 * or backup sibling beside a build is the ordinary case, which is what made
 * that reachable, and SECURITY.md notes the port is open on every interface.
 */
export function isInsideRoot(root: string, candidate: string): boolean {
  const prefix = root.endsWith(sep) ? root : root + sep;
  return candidate === root || candidate.startsWith(prefix);
}
