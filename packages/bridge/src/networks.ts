/**
 * The IPv4 networks this computer is on, for the page.
 *
 * "Which address do I send Art-Net to?" is the first question with a real rig,
 * and the page has no way to answer it: a browser cannot see the machine's
 * interfaces. The connector can, so it says, and the outputs panel turns each
 * network into the artnet() line that reaches every node on it.
 *
 * Only the networks go to the page, and only to a page the access policy has
 * already let in (access.ts): nothing here leaves this computer.
 */

import type { NetworkInterfaceInfo } from 'os';

export interface LocalNetwork {
  /** This computer's own address on the network. */
  address: string;
  netmask: string;
  /** Reaches every node on the network at once. */
  broadcast: string;
}

/** At most this many, so a machine with a pile of virtual adapters stays readable. */
const MAX_NETWORKS = 6;

function toInt(ip: string): number | null {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return null;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function toIp(n: number): string {
  return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
}

/**
 * Every non-loopback IPv4 network in `interfaces`, as os.networkInterfaces()
 * returns them. A /32 (a VPN's point-to-point address) has no neighbours to
 * reach and is left out.
 */
export function localNetworks(interfaces: NodeJS.Dict<NetworkInterfaceInfo[]>): LocalNetwork[] {
  const out: LocalNetwork[] = [];
  for (const addrs of Object.values(interfaces)) {
    for (const a of addrs ?? []) {
      // Node 18.0 to 18.3 reported the family as a number.
      const v4 = a.family === 'IPv4' || (a.family as unknown) === 4;
      if (!v4 || a.internal) continue;
      const ip = toInt(a.address);
      const mask = toInt(a.netmask);
      if (ip === null || mask === null || mask === 0xffffffff) continue;
      const broadcast = toIp((ip | ~mask) >>> 0);
      if (out.some((n) => n.broadcast === broadcast)) continue;
      out.push({ address: a.address, netmask: a.netmask, broadcast });
      if (out.length === MAX_NETWORKS) return out;
    }
  }
  return out;
}
