/**
 * The networks the connector tells the page about, so it can offer the
 * artnet() line that reaches them.
 */

import { describe, it, expect } from 'vitest';
import type { NetworkInterfaceInfo } from 'os';

import { localNetworks } from './networks.js';

function v4(address: string, netmask: string, internal = false): NetworkInterfaceInfo {
  return { address, netmask, family: 'IPv4', mac: '00:00:00:00:00:00', internal, cidr: null };
}

describe('the networks this computer is on', () => {
  it('gives each one with its broadcast address', () => {
    const nets = localNetworks({
      en0: [v4('192.168.1.23', '255.255.255.0')],
      en5: [v4('2.0.0.10', '255.0.0.0')],
    });
    expect(nets).toEqual([
      { address: '192.168.1.23', netmask: '255.255.255.0', broadcast: '192.168.1.255' },
      { address: '2.0.0.10', netmask: '255.0.0.0', broadcast: '2.255.255.255' },
    ]);
  });

  it('leaves out loopback, IPv6 and a point-to-point address', () => {
    const nets = localNetworks({
      lo0: [v4('127.0.0.1', '255.0.0.0', true)],
      en0: [{ address: 'fe80::1', netmask: 'ffff:ffff:ffff:ffff::', family: 'IPv6', mac: '', internal: false, cidr: null, scopeid: 4 }],
      utun3: [v4('10.8.0.2', '255.255.255.255')],
    });
    expect(nets).toEqual([]);
  });

  it('lists a network once however many adapters are on it', () => {
    const nets = localNetworks({
      en0: [v4('10.0.0.5', '255.255.255.0')],
      en1: [v4('10.0.0.6', '255.255.255.0')],
    });
    expect(nets).toHaveLength(1);
  });

  it('works out a broadcast that does not end in .255', () => {
    expect(localNetworks({ en0: [v4('10.1.2.70', '255.255.255.192')] })[0].broadcast).toBe('10.1.2.127');
  });
});
