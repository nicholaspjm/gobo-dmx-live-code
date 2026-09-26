/**
 * Whether the address a scene sends Art-Net to can reach anything.
 *
 * Every mistake here fails in silence on the wire: the frames are sent, the
 * socket reports success, and the rig stays dark. The connector tells the page
 * which networks this computer is on (bridge/src/networks.ts), and that is
 * enough to catch the three that happen: sending to this computer, sending to
 * this computer's own address, and sending to a network it is not on.
 *
 * Its own module, with no DOM and no socket in it, so it can be tested: the
 * outputs panel and the status line both ask it.
 */

// The module on its own rather than the package index, which reads `window`
// at import time through the bridge client.
import { onNetwork, type LocalNetwork } from '@gobo/core/connector-version';

/** This computer, by any of the names it answers to. */
export function isLoopbackHost(host: string): boolean {
  return host === 'localhost' || host === '::1' || host.startsWith('127.');
}

/**
 * What is wrong with where the scene sends Art-Net, or null when nothing can
 * be seen to be. Null too when the networks are unknown, which is an older
 * connector: only the loopback case can be told without them.
 */
export function artnetTargetProblem(host: string, networks: readonly LocalNetwork[]): string | null {
  if (isLoopbackHost(host)) {
    return `This scene sends to ${host}, which is this computer only. That is right for a visualiser or `
      + 'TouchDesigner here, and nothing reaches a node on the network.';
  }
  if (networks.some((n) => n.address === host)) {
    return `${host} is this computer's own address, so nothing reaches the rig. Send to the node's `
      + 'address, or to the whole network with the line below.';
  }
  // The limited broadcast goes out on whichever network the system picks,
  // which is on one of them by definition.
  if (host === '255.255.255.255') return null;
  if (networks.length > 0 && /^\d+\.\d+\.\d+\.\d+$/.test(host) && !networks.some((n) => onNetwork(host, n))) {
    const mine = networks.map((n) => n.address).join(' and ');
    return `This computer is not on the same network as ${host}, so nothing reaches it: it is ${mine}. `
      + 'Plug into the lighting network, or give this computer an address on it.';
  }
  return null;
}
