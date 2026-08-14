/**
 * USB DMX output, straight from the browser over WebSerial.
 *
 * The one path from a web page to real fixtures with nothing installed. A
 * browser cannot open a UDP socket, so Art-Net always needs a native helper,
 * but it can open a serial port, and a USB DMX interface is a serial device.
 *
 * Targets the Enttec DMX USB Pro protocol, which most interfaces speak or
 * emulate. The Pro has a microcontroller that generates the DMX break and
 * mark-after-break itself, so the browser only has to hand it a frame. Raw
 * FTDI dongles (Open DMX USB and the cheap clones) expect the host to bit-bang
 * that timing, which a browser cannot do reliably, so they are not supported.
 *
 * Frame format, from the Enttec Pro API:
 *
 *   0x7E  start of message
 *   0x06  label 6, "output only send DMX packet"
 *   len   payload length, low byte then high byte
 *   0x00  DMX start code
 *   ...   up to 512 channel bytes
 *   0xE7  end of message
 *
 * Requires a secure context (https or localhost) and a user gesture to choose
 * the port, both browser rules rather than ours.
 */

const ENTTEC_START = 0x7e;
const ENTTEC_END = 0xe7;
const LABEL_SEND_DMX = 6;
const DMX_START_CODE = 0x00;
const BAUD = 115200;

/** Minimal shape of the WebSerial API, so this file builds without DOM serial types. */
interface SerialPortLike {
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  readonly writable: WritableStream<Uint8Array> | null;
}
interface SerialLike {
  requestPort(options?: unknown): Promise<SerialPortLike>;
  getPorts(): Promise<SerialPortLike[]>;
}

function serialApi(): SerialLike | null {
  const nav = globalThis.navigator as unknown as { serial?: SerialLike } | undefined;
  return nav?.serial ?? null;
}

/** Whether this browser exposes WebSerial at all. Chrome and Edge do; Firefox and Safari do not. */
export function isUsbDmxSupported(): boolean {
  return serialApi() !== null;
}

let _port: SerialPortLike | null = null;
let _writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
let _connected = false;
// A Set, for the same reason as the bridge listener: more than one part of the
// UI reacts to the interface appearing or going away.
const _onStatusChange = new Set<(connected: boolean) => void>();
// One frame in flight at a time. A DMX frame at 40Hz takes about 23ms on the
// wire, so without this a slow port would queue frames faster than it drains
// and the rig would lag further behind by the second.
let _writing = false;
let _dropped = 0;

export function onUsbStatusChange(fn: (connected: boolean) => void): void {
  _onStatusChange.add(fn);
}

export function isUsbConnected(): boolean {
  return _connected;
}

/** Frames dropped because the interface could not keep up. */
export function getUsbDroppedFrames(): number {
  return _dropped;
}

/**
 * Ask the user to choose a USB DMX interface, then open it.
 *
 * Must be called from a user gesture: browsers refuse requestPort() otherwise,
 * so the UI drives this from a button rather than from scene code.
 */
export async function connectUsbDmx(): Promise<void> {
  const serial = serialApi();
  if (!serial) {
    throw new Error('This browser has no WebSerial. Chrome or Edge support it; Firefox and Safari do not.');
  }
  await disconnectUsbDmx();

  const port = await serial.requestPort();
  await port.open({ baudRate: BAUD });
  if (!port.writable) throw new Error('The serial port opened but is not writable.');

  _port = port;
  _writer = port.writable.getWriter();
  _connected = true;
  _dropped = 0;
  for (const fn of _onStatusChange) fn(true);
}

/** Reopen a port the user has already granted, with no prompt. */
export async function reconnectUsbDmx(): Promise<boolean> {
  const serial = serialApi();
  if (!serial) return false;
  try {
    const [port] = await serial.getPorts();
    if (!port) return false;
    await port.open({ baudRate: BAUD });
    if (!port.writable) return false;
    _port = port;
    _writer = port.writable.getWriter();
    _connected = true;
    for (const fn of _onStatusChange) fn(true);
    return true;
  } catch {
    return false;
  }
}

export async function disconnectUsbDmx(): Promise<void> {
  if (_writer) {
    try { await _writer.close(); } catch { /* already closing */ }
    try { _writer.releaseLock(); } catch { /* already released */ }
    _writer = null;
  }
  if (_port) {
    try { await _port.close(); } catch { /* already closed */ }
    _port = null;
  }
  // Clear the in-flight flag. A write that was outstanding when the interface
  // went away never settles, so without this the next connection is wedged:
  // every send takes the "already writing" branch and the rig stays dark.
  _writing = false;
  if (_connected) {
    _connected = false;
    for (const fn of _onStatusChange) fn(false);
  }
}

/** Build one Enttec Pro "send DMX" message for a 512-channel universe. */
export function buildEnttecFrame(channels: Uint8Array): Uint8Array {
  // Payload is the start code plus the channel data.
  const payloadLength = channels.length + 1;
  const frame = new Uint8Array(payloadLength + 5);
  frame[0] = ENTTEC_START;
  frame[1] = LABEL_SEND_DMX;
  frame[2] = payloadLength & 0xff;
  frame[3] = (payloadLength >> 8) & 0xff;
  frame[4] = DMX_START_CODE;
  frame.set(channels, 5);
  frame[frame.length - 1] = ENTTEC_END;
  return frame;
}

/**
 * Send one universe to the interface.
 *
 * A USB DMX interface carries a single universe, so only the primary one is
 * sent. Anything on another universe is a network output's job.
 */
export function sendUsbDmx(channels: Uint8Array): void {
  if (!_connected || !_writer) return;
  if (_writing) { _dropped++; return; }
  _writing = true;
  _writer.write(buildEnttecFrame(channels))
    .catch(() => {
      // The interface was unplugged, or the port errored. Drop the connection
      // rather than throwing on every tick from here on.
      void disconnectUsbDmx();
    })
    .finally(() => { _writing = false; });
}
