/**
 * What OSC to put on the wire for a frame of DMX.
 *
 * Separated from index.ts for the same reason frames.ts is: index.ts opens
 * listening sockets the moment it is imported, which makes anything inside it
 * impossible to test. This module holds no sockets. It is handed a frame and
 * returns the datagrams to send.
 *
 * THE PROBLEM THIS EXISTS TO FIX
 * Every channel used to be its own UDP datagram, carrying one float. A fully
 * lit 512-channel universe at the tick rate is around seventeen thousand
 * packets a second, each with forty-odd bytes of headers wrapped around four
 * bytes of payload. Receivers drop them, queue them, or fall over. It looked
 * fine in testing because a channel that is zero, and was zero last frame, is
 * skipped: the flood only arrives once the rig is actually lit.
 *
 * OSC has a container for exactly this. A bundle is one datagram holding many
 * messages, so the addresses stay per channel and anything already mapped to
 * /gobo/1/5 keeps working, while the packet count falls by a factor of fifty.
 *
 * WHY THE BUNDLES ARE CHUNKED
 * One bundle holding all 512 channels is about twelve kilobytes, which is well
 * inside UDP's limit and well outside a typical 1500-byte network MTU. IP
 * would fragment it, and a fragmented datagram is all or nothing: lose one
 * fragment and the whole frame goes. So bundles are filled to a budget that
 * fits inside one MTU instead, which is a handful of whole, independent
 * datagrams rather than one that can be destroyed in pieces.
 */

/** Payload budget for one datagram. A 1500-byte MTU less 20 bytes of IP header
 *  and 8 of UDP, with room to spare for tunnels and VPNs that carry their own. */
export const MAX_PAYLOAD = 1400;

/** Pad a length to the next 4-byte boundary, which OSC requires of every part. */
export function oscPad(len: number): number {
  return Math.ceil(len / 4) * 4;
}

/** One OSC message: an address, a type tag of one float, and the float. */
export function buildOscMessage(address: string, value: number): Buffer {
  // Null-terminated and padded. Allocating zeroed means the terminator and the
  // padding are already there.
  const addrBuf = Buffer.alloc(oscPad(address.length + 1), 0);
  addrBuf.write(address, 'ascii');

  // ",f" then its own null and padding, which is what makes it four bytes.
  const tagBuf = Buffer.from([0x2c, 0x66, 0x00, 0x00]);

  const valBuf = Buffer.alloc(4);
  valBuf.writeFloatBE(value, 0);

  return Buffer.concat([addrBuf, tagBuf, valBuf]);
}

/**
 * Wrap messages in an OSC bundle.
 *
 * The time tag is the immediate one, 0x0000000000000001, which every receiver
 * reads as "act on this now" rather than scheduling it. A lighting frame is
 * already late by the time it arrives; there is nothing to schedule.
 */
export function buildOscBundle(messages: readonly Buffer[]): Buffer {
  const parts: Buffer[] = [Buffer.from('#bundle\0', 'ascii')];

  const timetag = Buffer.alloc(8, 0);
  timetag.writeUInt32BE(0, 0);
  timetag.writeUInt32BE(1, 4);
  parts.push(timetag);

  for (const msg of messages) {
    const size = Buffer.alloc(4);
    size.writeInt32BE(msg.length, 0);
    parts.push(size, msg);
  }
  return Buffer.concat(parts);
}

/** The fixed cost of a bundle before any message goes in: header and time tag. */
const BUNDLE_OVERHEAD = 16;
/** Each message inside a bundle carries its own four-byte length. */
const ELEMENT_OVERHEAD = 4;

/**
 * The datagrams for one universe's frame.
 *
 * A channel is included when it is lit, or when it was lit last frame and has
 * gone out. Sending the ones that went out is what makes a blackout arrive:
 * a receiver holds its last value, so a channel that simply stops being
 * mentioned stays where it was.
 *
 * Returns an empty array when nothing changed and nothing is lit, so a dark
 * rig costs no packets at all.
 */
export function oscPacketsFor(
  universe: number,
  data: readonly number[],
  prev: readonly number[] | undefined,
  maxPayload: number = MAX_PAYLOAD,
): Buffer[] {
  const packets: Buffer[] = [];
  let batch: Buffer[] = [];
  let batchBytes = BUNDLE_OVERHEAD;

  const flush = (): void => {
    if (batch.length === 0) return;
    packets.push(buildOscBundle(batch));
    batch = [];
    batchBytes = BUNDLE_OVERHEAD;
  };

  for (let i = 0; i < data.length; i++) {
    const raw = data[i] ?? 0;
    const prevRaw = prev?.[i] ?? 0;
    if (raw === 0 && prevRaw === 0) continue;

    const msg = buildOscMessage(`/gobo/${universe}/${i + 1}`, raw / 255);
    const cost = msg.length + ELEMENT_OVERHEAD;

    // A single message larger than the budget still has to go somewhere, so it
    // gets a datagram of its own rather than being dropped. It cannot happen
    // with the addresses built above, and it is not this function's business to
    // decide that it never will.
    if (batchBytes + cost > maxPayload && batch.length > 0) flush();

    batch.push(msg);
    batchBytes += cost;
  }
  flush();
  return packets;
}
