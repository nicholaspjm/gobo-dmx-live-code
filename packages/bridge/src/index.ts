/**
 * gobo bridge: a WebSocket server that routes DMX universe data to
 * Art-Net UDP, sACN E1.31, OSC, or mock (console log).
 *
 * Listens on ws://localhost:3001
 * Config: bridge.config.json, read from this package's own directory (NOT the
 * process working directory) and overridden at runtime by config messages from
 * the editor's artnet() / sacn() / osc() / mock() calls.
 *
 * Wire format expected from the UI:
 *   { type: "dmx", universes: { "1": [0, 128, 255, ...], ... } }
 *
 * Every socket and server here has an error handler and every send has a
 * callback, so a bad host or an unplugged cable costs frames rather than the
 * process.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { createSocket, Socket } from 'dgram';
import { readFileSync, existsSync, statSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomBytes } from 'crypto';
import { networkInterfaces } from 'os';
import { spawn } from 'child_process';

// ─── Config ──────────────────────────────────────────────────────────────────

/** The output modes the router below implements. */
const OUTPUT_MODES = ['artnet', 'sacn', 'osc', 'mock'] as const;

type OutputMode = (typeof OUTPUT_MODES)[number];

interface BridgeConfig {
  mode: OutputMode;
  artnet?: { host: string; port?: number };
  sacn?: { universe?: number; priority?: number };
  osc?: { host: string; port: number };
  mock?: { logIntervalFrames?: number };
}

/**
 * An unrecognised mode used to fall through the router's `default:` branch
 * into mock, so a typo like "artnett" logged happily while nothing reached the
 * rig. Both entry points (the config file and runtime config messages) check
 * this before assigning config.mode, so an invalid value cannot reach the
 * router.
 */
function isOutputMode(value: unknown): value is OutputMode {
  return typeof value === 'string' && (OUTPUT_MODES as readonly string[]).includes(value);
}

function unknownModeMessage(value: unknown): string {
  return `unknown output mode ${JSON.stringify(value)}; valid modes are ${OUTPUT_MODES.join(', ')}`;
}

const __dir = dirname(fileURLToPath(import.meta.url));
const configPath = resolve(__dir, '..', 'bridge.config.json');

let config: BridgeConfig = { mode: 'mock' };
try {
  const loaded = JSON.parse(readFileSync(configPath, 'utf-8')) as BridgeConfig;
  if (isOutputMode(loaded.mode)) {
    config = loaded;
    console.log(`[bridge] config loaded, mode: ${config.mode}`);
  } else {
    // Keep the rest of the file so correcting the mode is the only edit
    // needed. Say so loudly: this must not look like a working output.
    config = { ...loaded, mode: 'mock' };
    console.error(`[bridge] bridge.config.json: ${unknownModeMessage(loaded.mode)}`);
    console.error('[bridge] falling back to mock. NOTHING will be sent to the rig until the mode is corrected.');
  }
} catch (err) {
  // A missing file is a normal first run. Unreadable or malformed JSON is a
  // mistake, and both otherwise land on the same silent default.
  if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
    console.warn(`[bridge] no bridge.config.json at ${configPath}, using mock mode`);
  } else {
    console.error(`[bridge] could not read ${configPath}: ${(err as Error).message}`);
    console.error('[bridge] falling back to mock. NOTHING will be sent to the rig until that is fixed.');
  }
}

// ─── Error reporting ─────────────────────────────────────────────────────────

/**
 * What a socket error means, in one line someone can act on. Node's own
 * messages ("send EHOSTUNREACH") say what broke but not what to do about it.
 */
function explainSocketError(err: NodeJS.ErrnoException): string {
  switch (err.code) {
    case 'EACCES':
    case 'EPERM':
      return 'the OS refused the send; a firewall or security policy is blocking outbound UDP';
    case 'EADDRINUSE':
      return 'the local port is already taken, probably by another bridge or lighting app';
    case 'ENETUNREACH':
    case 'EHOSTUNREACH':
    case 'ENETDOWN':
      return 'no route to that address: check the interface is up and on the same subnet as the node';
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return 'that host name could not be resolved: pass a literal IP address instead';
    case 'EADDRNOTAVAIL':
      return 'the local address is not available; the network it was bound to may have gone away';
    case 'ERR_SOCKET_DGRAM_NOT_RUNNING':
      return 'the UDP socket has been closed';
    default:
      return err.message;
  }
}

/**
 * Send failures arrive at frame rate. One unreachable host prints thousands of
 * identical lines a minute (worse under OSC, which sends one packet per
 * channel) and buries everything else. Print the first of each kind
 * immediately, then at most one line per interval with a count of the rest.
 *
 * A dropped frame is not fatal: the next frame is 16ms away.
 */
const SEND_ERROR_REPEAT_MS = 5000;
const _sendErrors = new Map<string, { last: number; suppressed: number }>();

function reportSendError(protocol: string, target: string, err: NodeJS.ErrnoException): void {
  const code = err.code ?? 'error';
  const key = `${protocol}|${code}|${target}`;
  const now = Date.now();
  const seen = _sendErrors.get(key);

  if (seen && now - seen.last < SEND_ERROR_REPEAT_MS) {
    seen.suppressed++;
    return;
  }

  const repeats = seen && seen.suppressed > 0 ? ` (+${seen.suppressed} more since the last line)` : '';
  console.error(
    `[bridge] ${protocol} send to ${target} failed, ${code}: ${explainSocketError(err)}${repeats}`,
  );
  _sendErrors.set(key, { last: now, suppressed: 0 });
}

// ─── UDP socket (shared by Art-Net, sACN and OSC) ────────────────────────────

let udp: Socket | null = null;

/**
 * Create the shared output socket with its error handling already attached.
 * A dgram socket that emits 'error' with no listener throws out of the event
 * loop and takes the bridge down, so this is a factory rather than two
 * hand-rolled call sites.
 */
function createUdpSocket(reason: string): Socket {
  const socket = createSocket('udp4');

  socket.on('error', (err: NodeJS.ErrnoException) => {
    console.error(`[bridge] UDP socket error ${err.code ?? 'error'}: ${explainSocketError(err)}`);
  });

  // Node closes the socket after a fatal socket error. Drop the reference so
  // the send paths no-op on their `if (!udp)` guard instead of throwing on
  // every frame. Guarded because a later mode switch may already have replaced
  // this socket with a live one.
  socket.on('close', () => {
    if (udp === socket) {
      udp = null;
      console.warn('[bridge] UDP socket closed. No output until an output mode is selected again.');
    }
  });

  socket.bind(() => {
    try {
      // Without this, sends to a .255 broadcast address are dropped by the OS
      // on most systems, silently.
      socket.setBroadcast(true);
    } catch (err) {
      console.error(
        `[bridge] could not enable UDP broadcast: ${(err as Error).message}. Unicast and multicast still work.`,
      );
    }
    console.log(`[bridge] UDP socket ready (${reason})`);
  });

  return socket;
}

if (config.mode === 'artnet' || config.mode === 'sacn' || config.mode === 'osc') {
  udp = createUdpSocket(`startup, mode ${config.mode}`);
}

// sACN CID: 16-byte identifier, generated once per process
const SACN_CID = randomBytes(16);

// ─── ArtNet ──────────────────────────────────────────────────────────────────

const ARTNET_PORT = 6454;
const ARTNET_DEFAULT_HOST = '255.255.255.255';

/**
 * Build an ArtDmx packet per Art-Net 4 spec.
 *
 * Layout (530 bytes total = 18 header + 512 data):
 *   0..7   ID string "Art-Net" + null terminator (8 bytes, ASCII)
 *   8..9   OpCode:  OpOutput = 0x5000, transmitted LOW BYTE FIRST on the wire
 *                   (bytes 0x00, 0x50; writeUInt16LE(0x5000) does this)
 *   10..11 ProtVer: 14, HIGH BYTE FIRST (big-endian)
 *   12     Sequence (0 disables ordering enforcement on the receiver)
 *   13     Physical input port on the sender (cosmetic, 0 is fine)
 *   14     SubUni:  low byte of the 15-bit universe address (sub-net << 4 | uni)
 *   15     Net:     upper 7 bits of the universe address
 *   16..17 Length:  DMX data byte count, HIGH BYTE FIRST (512 for a full frame)
 *   18..529 DMX data (start-code is implicit 0 and NOT included here)
 *
 * `OpOutput` is 0x5000, not 0x0050. A receiver reads the two OpCode bytes as a
 * little-endian uint16, so the byte pattern 0x50 0x00 reads as 0x0050 (unknown,
 * silently dropped) and 0x00 0x50 reads as 0x5000 (ArtDmx, accepted).
 */
function buildArtDmxPacket(universe: number, data: number[]): Buffer {
  const buf = Buffer.alloc(530);

  // ID: "Art-Net\0"
  buf.write('Art-Net\0', 0, 'ascii');

  // OpCode: OpOutput / OpDmx = 0x5000, wire order is low byte first.
  buf.writeUInt16LE(0x5000, 8);

  // Protocol version 14, high byte first
  buf.writeUInt16BE(14, 10);

  // Sequence + Physical
  buf[12] = 0;
  buf[13] = 0;

  // Universe split into SubUni (low 8 bits) and Net (high 7 bits).
  buf[14] = universe & 0xff;
  buf[15] = (universe >> 8) & 0x7f;

  // Length of DMX data, high byte first. 512 = full universe.
  buf.writeUInt16BE(512, 16);

  // DMX data. Start code is implicit 0 and NOT transmitted as part of the data.
  for (let i = 0; i < 512; i++) {
    buf[18 + i] = data[i] ?? 0;
  }

  return buf;
}

let _artnetSendCount = 0;

function sendArtNet(universe: number, data: number[]): void {
  if (!udp) return;
  const host = config.artnet?.host ?? ARTNET_DEFAULT_HOST;
  const port = config.artnet?.port ?? ARTNET_PORT;
  const packet = buildArtDmxPacket(universe, data);
  udp.send(packet, port, host, (err) => {
    if (err) reportSendError('Art-Net', `${host}:${port}`, err);
  });
  _artnetSendCount++;
  if (_artnetSendCount === 1 || _artnetSendCount % 100 === 0) {
    const active = data.filter(v => v > 0).length;
    console.log(`[bridge] ArtNet → ${host}:${port} uni${universe} (${active} active ch, packet #${_artnetSendCount})`);
  }
}

// ─── sACN (E1.31) ────────────────────────────────────────────────────────────

const SACN_PORT = 5568;

// Source name, and the width of the framing-layer field that carries it.
// E1.31 §6.2.2 fixes that field at 64 bytes: null-terminated, null-padded,
// followed immediately by Priority at offset 108. The write below is capped at
// SACN_SOURCE_NAME_BYTES, so a longer name would be truncated rather than run
// over Priority and shift every field after it.
const SACN_SOURCE_NAME = 'gobo';
const SACN_SOURCE_NAME_BYTES = 64;

const ACN_IDENT = Buffer.from([
  0x41, 0x53, 0x43, 0x2d, 0x45, 0x31, 0x2e, 0x31, 0x37, 0x00, 0x00, 0x00,
]);

// E1.31 reserves universe 0 and everything from 64000 up; 1-63999 is all a
// conformant receiver will look at.
const SACN_UNIVERSE_MIN = 1;
const SACN_UNIVERSE_MAX = 63999;
const SACN_DEFAULT_BASE = 1;

/**
 * Sequence numbers are per universe (E1.31 §6.2.5): a receiver compares each
 * packet against the last one it saw for that universe and discards anything
 * out of order. A single process-wide counter looked like a jump of however
 * many universes were in the rotation, and receivers dropped frames until the
 * numbers caught up, roughly 170ms of black per gap.
 *
 * Keyed on the WIRE universe, not the scene universe, because the wire number
 * is the only one the receiver sees. Two scene universes sharing one wire
 * universe must draw from the same counter or every packet looks out of order.
 */
const _sacnSeq = new Map<number, number>();

function nextSacnSeq(wireUniverse: number): number {
  const current = _sacnSeq.get(wireUniverse) ?? 0;
  _sacnSeq.set(wireUniverse, (current + 1) & 0xff);
  return current;
}

/** Invalid bases already named in the log, so the warning stays a one-off. */
const _sacnBaseWarned = new Set<number>();

/**
 * The base universe to use: the configured one if it can legally go on the
 * wire, otherwise the default.
 *
 * Scene code can call sacn(0). The argument defaults to 1, but nothing stops a
 * 0, and E1.31 reserves universe 0. An unchecked base produces packets no
 * conformant receiver accepts, which looks like a dead rig. Fall back to the
 * default and log the fallback.
 */
function sacnBase(): number {
  const configured = config.sacn?.universe;
  if (configured === undefined) return SACN_DEFAULT_BASE;
  if (
    Number.isInteger(configured) &&
    configured >= SACN_UNIVERSE_MIN &&
    configured <= SACN_UNIVERSE_MAX
  ) {
    return configured;
  }

  if (!_sacnBaseWarned.has(configured)) {
    _sacnBaseWarned.add(configured);
    console.error(
      `[bridge] sACN: base universe ${JSON.stringify(configured)} is not a whole number in the legal E1.31 ` +
      `range ${SACN_UNIVERSE_MIN}-${SACN_UNIVERSE_MAX}; using ${SACN_DEFAULT_BASE} instead. ` +
      `Correct the sacn(<base>) call or bridge.config.json.`,
    );
  }
  return SACN_DEFAULT_BASE;
}

/**
 * Map a scene universe onto the sACN universe that goes on the wire.
 *
 * ONLY scene universe 0 is remapped; everything else goes out verbatim.
 *
 * Scene universes do not all start at 0. The fixture family (fixture(),
 * rgbStrip(), rgbwStrip()) defaults to universe 0, the channel family (ch(),
 * dim(), rgb()) writes universe 1, and the shipped demo scene patches on
 * universe 1. E1.31 reserves 0, so a default fixture scene was multicasting to
 * a universe conformant receivers drop. Remapping only that value leaves
 * working rigs alone: scene uni 1 stays sACN uni 1, scene uni 7 stays 7.
 *
 * Art-Net and OSC addressing is unchanged: both use the scene universe as-is.
 */
function sacnUniverseFor(sceneUniverse: number): number {
  return sceneUniverse === 0 ? sacnBase() : sceneUniverse;
}

/**
 * Which scene universe first claimed each wire universe, and which collisions
 * have been reported.
 *
 * Setting the base to B while the scene also writes universe B directly points
 * scene uni 0 and scene uni B at the same wire universe. Both still send and
 * each frame overwrites the other, so a fixture flickers between two looks.
 * Log both scene universes rather than merging silently.
 */
const _sacnWireOwner = new Map<number, number>();
const _sacnCollisionWarned = new Set<number>();

function checkWireCollision(sceneUniverse: number, wireUniverse: number): void {
  const owner = _sacnWireOwner.get(wireUniverse);
  if (owner === undefined) {
    _sacnWireOwner.set(wireUniverse, sceneUniverse);
    return;
  }
  if (owner === sceneUniverse || _sacnCollisionWarned.has(wireUniverse)) return;

  _sacnCollisionWarned.add(wireUniverse);
  console.error(
    `[bridge] sACN: scene uni ${owner} and scene uni ${sceneUniverse} both map to sACN uni ${wireUniverse}. ` +
    `They are NOT merged; each frame overwrites the other on the wire. Scene uni 0 is remapped to the base ` +
    `universe (currently ${sacnBase()}). Move one of them or pick another base with sacn(<base>).`,
  );
}

/** Build a full E1.31 UDP packet for one (wire) universe. */
function buildSACNPacket(universe: number, data: number[], priority = 100): Buffer {
  const TOTAL = 638; // 126-byte header, whose last byte is the DMX start code, + 512 slots
  const buf = Buffer.alloc(TOTAL, 0);

  // ── Root Layer ──────────────────────────────────────────────────
  buf.writeUInt16BE(0x0010, 0); // Preamble size
  buf.writeUInt16BE(0x0000, 2); // Postamble size
  ACN_IDENT.copy(buf, 4);      // ACN packet identifier [4-15]

  // Root PDU length: from offset 16 to end = 638-16 = 622, flags = 0x7000
  buf.writeUInt16BE(0x7000 | (TOTAL - 16), 16);
  buf.writeUInt32BE(0x00000004, 18); // Root vector (E1.31 data)
  SACN_CID.copy(buf, 22);           // CID [22-37]

  // ── Framing Layer ───────────────────────────────────────────────
  // PDU length from offset 38 to end = 638-38 = 600
  buf.writeUInt16BE(0x7000 | (TOTAL - 38), 38);
  buf.writeUInt32BE(0x00000002, 40);              // Framing vector (DATA_PACKET)

  // Source name [44-107]: "gobo\0" padded. buf is allocated zero-filled, so the
  // bytes after the name are already the nulls the spec asks for.
  buf.write(SACN_SOURCE_NAME, 44, SACN_SOURCE_NAME_BYTES, 'ascii');

  buf[108] = priority & 0xff;                     // Priority
  buf[109] = 0x00;                                // Reserved hi
  buf[110] = 0x00;                                // Reserved lo
  buf[111] = nextSacnSeq(universe);               // Sequence number, per universe
  buf[112] = 0x00;                                // Options
  buf.writeUInt16BE(universe, 113);               // Universe [113-114]

  // ── DMP Layer ───────────────────────────────────────────────────
  // PDU length from offset 115 to end = 638-115 = 523
  buf.writeUInt16BE(0x7000 | (TOTAL - 115), 115);
  buf[117] = 0x02;                    // DMP vector (SET_PROPERTY)
  buf[118] = 0xa1;                    // Address + data type
  buf.writeUInt16BE(0x0000, 119);     // First property address
  buf.writeUInt16BE(0x0001, 121);     // Address increment
  buf.writeUInt16BE(513, 123);        // Property count (start code + 512)
  buf[125] = 0x00;                    // DMX start code

  // DMX data [126-637]
  for (let i = 0; i < 512; i++) {
    buf[126 + i] = data[i] ?? 0;
  }

  return buf;
}

/** Multicast group for a universe, per E1.31: 239.255.<hi>.<lo>. */
function sacnMulticastAddr(universe: number): string {
  return `239.255.${(universe >> 8) & 0xff}.${universe & 0xff}`;
}

let _sacnSendCount = 0;
const _sacnRangeWarned = new Set<number>();

function sendSACN(sceneUniverse: number, data: number[]): void {
  if (!udp) return;

  const universe = sacnUniverseFor(sceneUniverse);

  if (universe < SACN_UNIVERSE_MIN || universe > SACN_UNIVERSE_MAX) {
    // Only a scene universe can land here: scene uni 0 maps to the base, which
    // sacnBase() has already forced into range. This runs once per universe per
    // frame, so warn once and stay quiet after that; at 60Hz an unthrottled
    // line floods the log.
    if (!_sacnRangeWarned.has(sceneUniverse)) {
      _sacnRangeWarned.add(sceneUniverse);
      console.error(
        `[bridge] sACN: scene uni ${sceneUniverse} is outside the legal E1.31 range ` +
        `${SACN_UNIVERSE_MIN}-${SACN_UNIVERSE_MAX}; skipping this universe. Scene universes go on the wire ` +
        `unchanged; only scene uni 0 is remapped, to the base universe.`,
      );
    }
    return;
  }

  checkWireCollision(sceneUniverse, universe);

  const priority = config.sacn?.priority ?? 100;
  const packet = buildSACNPacket(universe, data, priority);
  const addr = sacnMulticastAddr(universe);
  udp.send(packet, SACN_PORT, addr, (err) => {
    if (err) reportSendError('sACN', `${addr}:${SACN_PORT}`, err);
  });

  _sacnSendCount++;
  if (_sacnSendCount === 1 || _sacnSendCount % 100 === 0) {
    const active = data.filter(v => v > 0).length;
    console.log(
      `[bridge] sACN → ${addr}:${SACN_PORT} scene uni ${sceneUniverse} → sACN uni ${universe} ` +
      `(${active} active ch, packet #${_sacnSendCount})`,
    );
  }
}

// ─── OSC output ──────────────────────────────────────────────────────────────

/** Pad a buffer length to the next 4-byte boundary. */
function oscPad(len: number): number {
  return Math.ceil(len / 4) * 4;
}

/** Build a single OSC message: address + type tag + float arg. */
function buildOscMessage(address: string, value: number): Buffer {
  // Address string (null-terminated, padded to 4 bytes)
  const addrBuf = Buffer.alloc(oscPad(address.length + 1), 0);
  addrBuf.write(address, 'ascii');

  // Type tag ",f\0" padded to 4 bytes
  const tagBuf = Buffer.from([0x2c, 0x66, 0x00, 0x00]); // ",f\0\0"

  // Float32 big-endian
  const valBuf = Buffer.alloc(4);
  valBuf.writeFloatBE(value, 0);

  return Buffer.concat([addrBuf, tagBuf, valBuf]);
}

let _oscSendCount = 0;
const _oscPrevData = new Map<number, number[]>();

function sendOSC(universe: number, data: number[]): void {
  if (!udp) return;
  const host = config.osc?.host ?? '127.0.0.1';
  const port = config.osc?.port ?? 9000;
  const prev = _oscPrevData.get(universe);

  // Send any channel that is non-zero OR was non-zero last frame (so zeros get sent)
  for (let i = 0; i < data.length; i++) {
    const raw = data[i] ?? 0;
    const prevRaw = prev?.[i] ?? 0;
    if (raw === 0 && prevRaw === 0) continue;
    const address = `/gobo/${universe}/${i + 1}`;
    const msg = buildOscMessage(address, raw / 255);
    // One packet per channel, so an error here can fire hundreds of times per
    // frame; reportSendError collapses the repeats.
    udp.send(msg, port, host, (err) => {
      if (err) reportSendError('OSC', `${host}:${port}`, err);
    });
  }

  _oscPrevData.set(universe, [...data]);

  _oscSendCount++;
  if (_oscSendCount === 1 || _oscSendCount % 100 === 0) {
    const active = data.filter(v => v > 0).length;
    console.log(`[bridge] OSC → ${host}:${port} uni${universe} (${active} active ch, packet #${_oscSendCount})`);
  }
}

// ─── Mock output ─────────────────────────────────────────────────────────────

let _mockFrame = 0;

/**
 * Console output for when no rig is attached. The interval is configurable
 * (mock.logIntervalFrames) because the send rate is: the default of 30 frames
 * is about two lines a second at the UI's default 60 Hz, and wants doubling if
 * the send rate is raised to 120.
 */
function sendMock(universe: number, data: number[]): void {
  _mockFrame++;
  const interval = Math.max(1, Math.floor(config.mock?.logIntervalFrames ?? 30));
  if (_mockFrame % interval !== 0) return;

  const active = data
    .map((v, i) => ({ ch: i + 1, v }))
    .filter(({ v }) => v > 0);

  if (active.length > 0) {
    const summary = active.map(({ ch, v }) => `ch${ch}=${v}`).join('  ');
    console.log(`[mock] uni${universe} | ${summary}`);
  }
}

// ─── Where output is going ───────────────────────────────────────────────────

/**
 * One line describing where frames are going. The startup banner and the
 * runtime config log both use this, so they cannot drift from each other or
 * from the sender: the old sACN line printed a universe number the sender
 * never put on the wire.
 */
function describeOutput(): string {
  switch (config.mode) {
    case 'artnet':
      return `artnet → ${config.artnet?.host ?? ARTNET_DEFAULT_HOST}:${config.artnet?.port ?? ARTNET_PORT}`;
    case 'sacn': {
      // sacnBase(), not the raw config value: this line describes what the
      // sender does, including the fallback when the configured base is
      // unusable. It calls the sender's own function, so it cannot drift.
      const base = sacnBase();
      return `sacn → multicast :${SACN_PORT}, priority ${config.sacn?.priority ?? 100} ` +
        `(scene uni 0 → sACN uni ${base}; every other scene uni goes out unchanged, 1 → 1, 7 → 7)`;
    }
    case 'osc':
      return `osc → ${config.osc?.host ?? '127.0.0.1'}:${config.osc?.port ?? 9000}`;
    case 'mock':
      return 'mock → console only, nothing leaves this machine';
  }
}

// ─── Runtime config update ───────────────────────────────────────────────────

function handleConfigMessage(msg: Record<string, unknown>): void {
  if (msg.mode === undefined) {
    console.warn('[bridge] config message carried no mode, ignored');
    return;
  }

  if (!isOutputMode(msg.mode)) {
    // Keep the current mode: a typo must not take away a working output, and
    // dropping to mock would look like success.
    console.error(`[bridge] config message: ${unknownModeMessage(msg.mode)}. Staying in ${config.mode} mode.`);
    return;
  }

  const newMode = msg.mode;
  config.mode = newMode;

  if (msg.artnet && typeof msg.artnet === 'object') {
    const a = msg.artnet as Record<string, unknown>;
    config.artnet = {
      host: typeof a.host === 'string' ? a.host : config.artnet?.host ?? '127.0.0.1',
      port: typeof a.port === 'number' ? a.port : config.artnet?.port ?? 6454,
    };
  }

  if (msg.sacn && typeof msg.sacn === 'object') {
    const s = msg.sacn as Record<string, unknown>;
    config.sacn = {
      universe: typeof s.universe === 'number' ? s.universe : config.sacn?.universe ?? SACN_DEFAULT_BASE,
      priority: typeof s.priority === 'number' ? s.priority : config.sacn?.priority ?? 100,
    };
    // A new base moves scene uni 0 to a different wire universe, so the old
    // collision bookkeeping describes a mapping that no longer exists. The
    // warn-once state is cleared too, so a base that is still wrong is
    // reported again.
    _sacnRangeWarned.clear();
    _sacnBaseWarned.clear();
    _sacnWireOwner.clear();
    _sacnCollisionWarned.clear();
  }

  if (msg.osc && typeof msg.osc === 'object') {
    const o = msg.osc as Record<string, unknown>;
    config.osc = {
      host: typeof o.host === 'string' ? o.host : config.osc?.host ?? '127.0.0.1',
      port: typeof o.port === 'number' ? o.port : config.osc?.port ?? 9000,
    };
  }

  // Create UDP socket if switching to a network mode and none exists
  if ((newMode === 'artnet' || newMode === 'sacn' || newMode === 'osc') && !udp) {
    udp = createUdpSocket(`switched to ${newMode}`);
  }

  console.log(`[bridge] config updated: ${describeOutput()}`);
  warnIfSendingToSelf();
}

/**
 * Warn when the output host is one of this machine's own interface addresses.
 *
 * Writing your computer's IP instead of the node's is the most common Art-Net
 * mistake, and it fails silently: the frames are sent, the socket reports
 * success, and nothing reaches the rig. The bridge is the only part of the
 * system that can see the local interface list, so the check belongs here.
 */
function warnIfSendingToSelf(): void {
  const host = config.mode === 'artnet' ? config.artnet?.host
    : config.mode === 'osc' ? config.osc?.host
    : undefined;
  if (!host || host === '127.0.0.1' || host === 'localhost') return;

  for (const addrs of Object.values(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === 'IPv4' && !a.internal && a.address === host) {
        console.warn(
          `[bridge] ${host} is this machine's own address, so nothing reaches the rig. ` +
          `Use the node's IP, or the broadcast address for that subnet.`,
        );
        return;
      }
    }
  }
}

// ─── Route DMX message ───────────────────────────────────────────────────────

let _dmxMsgCount = 0;

function handleDmxMessage(universes: Record<string, number[]>): void {
  _dmxMsgCount++;
  if (_dmxMsgCount === 1) {
    console.log(`[bridge] receiving DMX data (${Object.keys(universes).length} universe(s))`);
  }
  for (const [uniStr, channels] of Object.entries(universes)) {
    const universe = parseInt(uniStr, 10);
    if (isNaN(universe) || channels.length < 1) continue;

    // No `default:` here on purpose. Every mode is listed and config.mode is
    // validated before it is assigned; a catch-all branch is what used to
    // route typo'd modes into mock with no complaint.
    switch (config.mode) {
      case 'artnet':
        sendArtNet(universe, channels);
        break;
      case 'sacn':
        sendSACN(universe, channels);
        break;
      case 'osc':
        sendOSC(universe, channels);
        break;
      case 'mock':
        sendMock(universe, channels);
        break;
    }
  }
}

// ─── WebSocket server ─────────────────────────────────────────────────────────

/**
 * Optional: serve the built UI from this same server.
 *
 * A browser cannot open a UDP socket, so a native process has to exist for
 * Art-Net to reach a rig at all. Serving the app from the bridge means that
 * process is the only thing to start, and the page's WebSocket is same-origin
 * rather than a second port to get wrong. Passed as `--ui <dir>`; without it
 * the bridge behaves exactly as before.
 */
const uiDirArg = process.argv.indexOf('--ui');
const UI_DIR = uiDirArg !== -1 && process.argv[uiDirArg + 1]
  ? resolve(process.argv[uiDirArg + 1])
  : null;

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

function serveUi(req: IncomingMessage, res: ServerResponse): void {
  const root = UI_DIR as string;
  const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0]);
  // Resolve inside the root and verify it stayed there. Local-only is not a
  // reason to serve arbitrary files off the disk.
  const candidate = resolve(root, '.' + (urlPath === '/' ? '/index.html' : urlPath));
  const target = candidate.startsWith(root) && existsSync(candidate) && statSync(candidate).isFile()
    ? candidate
    : resolve(root, 'index.html'); // single page app, unknown paths get the shell

  try {
    const body = readFileSync(target);
    const ext = target.slice(target.lastIndexOf('.'));
    res.writeHead(200, {
      'Content-Type': CONTENT_TYPES[ext] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
  }
}

const httpServer = createServer((req, res) => {
  if (UI_DIR) {
    serveUi(req, res);
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('gobo bridge running');
});

let listening = false;

const wss = new WebSocketServer({ server: httpServer });

wss.on('error', (err) => {
  // Until the server is up this is only the HTTP server's own error re-emitted,
  // and the handler below says the same thing in terms someone can act on.
  if (!listening) return;
  console.error(`[bridge] WebSocket server error ${(err as NodeJS.ErrnoException).code ?? 'error'}: ${err.message}`);
});

wss.on('connection', (ws: WebSocket) => {
  console.log(`[bridge] client connected (${wss.clients.size} total)`);

  // A client that vanishes mid-frame (laptop lid, wifi drop) emits 'error' on
  // its socket; with no listener that throws and kills the bridge along with
  // every other client's output.
  ws.on('error', (err) => {
    console.error(`[bridge] client socket error: ${err.message}`);
  });

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString()) as Record<string, unknown>;
      if (msg.type === 'dmx' && msg.universes) {
        handleDmxMessage(msg.universes as Record<string, number[]>);
      } else if (msg.type === 'config') {
        handleConfigMessage(msg);
      } else {
        console.log(`[bridge] unknown message type: ${msg.type}`);
      }
    } catch (err) {
      console.error('[bridge] malformed message:', (err as Error).message);
    }
  });

  ws.on('close', () => {
    console.log(`[bridge] client disconnected (${wss.clients.size} remaining)`);
  });
});

const PORT = 3001;

// Failing to listen is unrecoverable: there is nothing for the editor to
// connect to. Print one line and exit rather than throwing a stack trace.
// Errors after the server is up are survivable and must not stop output.
httpServer.on('error', (err: NodeJS.ErrnoException) => {
  if (!listening) {
    if (err.code === 'EADDRINUSE') {
      console.error(`[bridge] port ${PORT} is already in use. Another bridge is probably running; close it, then start this one.`);
    } else {
      console.error(`[bridge] could not listen on port ${PORT}, ${err.code ?? 'error'}: ${err.message}`);
    }
    process.exit(1);
  }
  console.error(`[bridge] HTTP server error ${err.code ?? 'error'}: ${err.message}`);
});

httpServer.listen(PORT, () => {
  listening = true;
  console.log(`[bridge] WebSocket server on ws://localhost:${PORT}`);
  console.log(`[bridge] output: ${describeOutput()}`);
  warnIfSendingToSelf();

  if (UI_DIR) {
    const url = `http://localhost:${PORT}`;
    console.log(`[bridge] serving the app from ${UI_DIR}`);
    console.log(`[bridge] open ${url}`);
    if (process.argv.includes('--open')) openBrowser(url);
  }
});

/** Open the default browser. Best effort: a failure here is not worth exiting
 *  over, since the URL has already been printed. */
function openBrowser(url: string): void {
  const cmd = process.platform === 'win32' ? 'cmd'
    : process.platform === 'darwin' ? 'open'
    : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try {
    spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
  } catch (err) {
    console.warn(`[bridge] could not open a browser: ${(err as Error).message}`);
  }
}
