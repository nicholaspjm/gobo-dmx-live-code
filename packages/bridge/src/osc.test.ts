/**
 * OSC is a byte protocol, so these read bytes.
 *
 * The thing being prevented is a regression to a datagram per channel, which
 * is what shipped: a lit 512-channel universe was around seventeen thousand
 * packets a second, and it only looked fine because an unlit channel is
 * skipped. So the packet COUNT is asserted, not only the contents.
 */

import { describe, it, expect } from 'vitest';
import { oscPad, buildOscMessage, buildOscBundle, oscPacketsFor, MAX_PAYLOAD } from './osc.js';

/** Read a bundle back into the addresses and values it carries. */
function readBundle(buf: Buffer): Array<{ address: string; value: number }> {
  expect(buf.subarray(0, 8).toString('ascii')).toBe('#bundle\0');
  // Immediate: 63 zero bits then a 1.
  expect(buf.readUInt32BE(8)).toBe(0);
  expect(buf.readUInt32BE(12)).toBe(1);

  const out: Array<{ address: string; value: number }> = [];
  let at = 16;
  while (at < buf.length) {
    const size = buf.readInt32BE(at);
    at += 4;
    const msg = buf.subarray(at, at + size);
    at += size;
    const nul = msg.indexOf(0);
    const address = msg.subarray(0, nul).toString('ascii');
    // Address padded to 4, then the four-byte type tag, then the float.
    const tagAt = oscPad(address.length + 1);
    expect(msg.subarray(tagAt, tagAt + 2).toString('ascii')).toBe(',f');
    out.push({ address, value: msg.readFloatBE(tagAt + 4) });
  }
  return out;
}

describe('oscPad', () => {
  it('rounds up to the next four', () => {
    expect([0, 1, 4, 5, 8, 11].map(oscPad)).toEqual([0, 4, 4, 8, 8, 12]);
  });
});

describe('buildOscMessage', () => {
  it('is a padded address, a float type tag, and a big-endian float', () => {
    const msg = buildOscMessage('/gobo/1/5', 1);
    // '/gobo/1/5' is 9 characters, so 10 with its terminator, padded to 12.
    expect(msg.length).toBe(12 + 4 + 4);
    expect(msg.subarray(0, 9).toString('ascii')).toBe('/gobo/1/5');
    expect(msg[9]).toBe(0);
    expect(msg.subarray(12, 16).toString('ascii')).toBe(',f\0\0');
    expect(msg.readFloatBE(16)).toBe(1);
  });

  it('always lands on a four-byte boundary, whatever the address length', () => {
    for (let ch = 1; ch <= 512; ch++) {
      expect(buildOscMessage(`/gobo/1/${ch}`, 0.5).length % 4).toBe(0);
    }
  });
});

describe('buildOscBundle', () => {
  it('carries the immediate time tag and each message with its length', () => {
    const bundle = buildOscBundle([
      buildOscMessage('/gobo/1/1', 1),
      buildOscMessage('/gobo/1/2', 0),
    ]);
    expect(readBundle(bundle)).toEqual([
      { address: '/gobo/1/1', value: 1 },
      { address: '/gobo/1/2', value: 0 },
    ]);
  });

  it('is a valid empty bundle when handed nothing', () => {
    expect(buildOscBundle([]).length).toBe(16);
  });
});

describe('oscPacketsFor', () => {
  it('sends nothing at all for a dark universe', () => {
    expect(oscPacketsFor(1, new Array(512).fill(0), undefined)).toEqual([]);
  });

  it('scales a channel from 0-255 to 0-1', () => {
    const [pkt] = oscPacketsFor(1, [255, 128, 0], undefined);
    const read = readBundle(pkt);
    expect(read[0]).toEqual({ address: '/gobo/1/1', value: 1 });
    expect(read[1].address).toBe('/gobo/1/2');
    expect(read[1].value).toBeCloseTo(128 / 255, 6);
    // The third channel is dark and was never lit, so it is not mentioned.
    expect(read).toHaveLength(2);
  });

  it('numbers channels from one, and names the universe', () => {
    const [pkt] = oscPacketsFor(7, [0, 0, 9], undefined);
    expect(readBundle(pkt)[0].address).toBe('/gobo/7/3');
  });

  it('sends a channel that has just gone out', () => {
    // A receiver holds its last value, so going dark has to be said out loud.
    const [pkt] = oscPacketsFor(1, [0, 0], [255, 0]);
    expect(readBundle(pkt)).toEqual([{ address: '/gobo/1/1', value: 0 }]);
  });

  it('stops mentioning a channel once it has been dark for a frame', () => {
    expect(oscPacketsFor(1, [0, 0], [0, 0])).toEqual([]);
  });

  it('collapses a full universe into a handful of datagrams', () => {
    // The regression this file exists for: this used to be 512 packets.
    const packets = oscPacketsFor(1, new Array(512).fill(200), undefined);
    expect(packets.length).toBeLessThan(15);
    expect(packets.length).toBeGreaterThan(1);
    const total = packets.reduce((n, p) => n + readBundle(p).length, 0);
    expect(total).toBe(512);
  });

  it('keeps every datagram inside one network frame', () => {
    // A bundle over the MTU is fragmented by IP, and a fragmented datagram is
    // all or nothing: lose one piece and the whole frame goes.
    for (const p of oscPacketsFor(1, new Array(512).fill(200), undefined)) {
      expect(p.length).toBeLessThanOrEqual(MAX_PAYLOAD);
    }
  });

  it('keeps the channels in order across the datagrams it splits into', () => {
    const seen = oscPacketsFor(1, new Array(512).fill(200), undefined)
      .flatMap(readBundle)
      .map((m) => Number(m.address.split('/').pop()));
    expect(seen).toEqual(Array.from({ length: 512 }, (_, i) => i + 1));
  });

  it('puts everything in one datagram when it fits', () => {
    expect(oscPacketsFor(1, [1, 2, 3, 4], undefined)).toHaveLength(1);
  });

  it('gives an oversized single message its own datagram rather than dropping it', () => {
    // Cannot happen with the addresses built here. Pinned so that a future
    // address scheme cannot lose channels silently.
    const packets = oscPacketsFor(1, [1, 2], undefined, 8);
    expect(packets).toHaveLength(2);
    expect(packets.flatMap(readBundle).map((m) => m.address))
      .toEqual(['/gobo/1/1', '/gobo/1/2']);
  });
});
