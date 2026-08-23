/**
 * What version this connector is, and the message that tells a page so.
 *
 * THE PROBLEM THIS EXISTS TO FIX
 * A blackout reached the rig a bar late and cost three rounds of debugging. The
 * fix had shipped days earlier. The connector actually running was built five
 * days before it, downloaded once and relaunched by a login item every morning
 * since, and nothing anywhere said so. A stale connector has now started two
 * separate investigations on this project. The page can only notice it if the
 * connector says who it is, so it does, on every connection.
 *
 * WHY THE VERSION IS WRITTEN OUT HERE
 * It has to be right in two builds that find files in completely different
 * ways. Under node the connector runs out of dist/ with its package.json a
 * directory up. Packaged as a single executable it is one file with no package
 * directory anywhere near it, so there is nothing to read at runtime and the
 * value has to be in the build.
 *
 * The automatic routes are all worse here. Importing ../package.json moves what
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

/** Keep in step with packages/bridge/package.json. version.test.ts enforces it. */
export const CONNECTOR_VERSION = '0.3.0';

/**
 * What the connector says to a page the moment it connects.
 *
 * This is the first thing this socket has ever carried toward the page:
 * everything else on it travels the other way. `type` is the discriminator, the
 * same field the page's own messages already use, so the next message from this
 * end (throughput counts are the obvious one) is a new value rather than a new
 * shape. The page ignores values it does not know, which is what makes adding
 * one safe.
 */
export interface ConnectorHello {
  type: 'hello';
  version: string;
}

export function connectorHello(): ConnectorHello {
  return { type: 'hello', version: CONNECTOR_VERSION };
}
