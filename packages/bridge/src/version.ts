/**
 * What version this connector is, and the message that tells a page so.
 *
 * WHY
 * A connector downloaded once and relaunched by a login item every morning can
 * run days behind the release with nothing reporting it. A stale connector has
 * caused two separate investigations on this project, one of them a blackout
 * reaching the rig a bar late after the fix had shipped. The page can only
 * notice a stale connector if the connector says which version it is, so it
 * does, on every connection.
 *
 * WHY THE VERSION IS WRITTEN OUT HERE
 * It has to be right in two builds that find files in completely different
 * ways. Under node the connector runs out of dist/ with its package.json a
 * directory up. Packaged as a single executable it is one file with no package
 * directory anywhere near it, so there is nothing to read at runtime and the
 * value has to be in the build.
 *
 * The automatic alternatives are worse. Importing ../package.json moves what
 * tsc treats as the root of the source tree, which pushes the build output down
 * a level and out from under the "main" field that npm and the desktop app both
 * point at. Generating this file during the build would make the value depend
 * on a step that neither `npm run build` nor the SEA packaging runs today, and
 * a missing generated file fails late and confusingly.
 *
 * A literal is correct in both builds, costs nothing at runtime, and drift is
 * caught rather than shipped: version.test.ts reads package.json off disk and
 * fails if the two disagree.
 */

import type { LocalNetwork } from './networks.js';

/** Keep in step with packages/bridge/package.json. version.test.ts enforces it. */
export const CONNECTOR_VERSION = '0.7.5';

/**
 * What the connector says to a page the moment it connects.
 *
 * This is the only message this socket carries toward the page; everything
 * else on it travels the other way. `type` is the discriminator, the same field
 * the page's own messages use, so a further message from this end (throughput
 * counts, say) is a new value rather than a new shape. The page ignores values
 * it does not know, which makes adding one safe.
 */
export interface ConnectorHello {
  type: 'hello';
  version: string;
  /** Whether this copy replaces itself when a release comes out (updater.ts). */
  updates: boolean;
  /** The IPv4 networks this computer is on (networks.ts), for the outputs panel. */
  networks: LocalNetwork[];
}

export function connectorHello(updates = false, networks: LocalNetwork[] = []): ConnectorHello {
  return { type: 'hello', version: CONNECTOR_VERSION, updates, networks };
}
