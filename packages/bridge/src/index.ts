/**
 * lumen bridge — WebSocket server that routes DMX universe data to
 * ArtNet UDP, sACN E1.31, or mock (console log).
 *
 * Listens on ws://localhost:3001
 * Config: bridge.config.json in the working directory
 *
 * Wire format expected from the UI:
 *   { type: "dmx", universes: { "1": [0, 128, 255, ...], ... } }
 */

import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { createSocket, Socket } from 'dgram';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomBytes } from 'crypto';

// ─── Config ──────────────────────────────────────────────────────────────────

interface BridgeConfig {
  mode: 'artnet' | 'sacn' | 'osc' | 'mock';
  artnet?: { host: string; port?: number };
  sacn?: { universe?: number; priority?: number };
  osc?: { host: string; port: number };
  mock?: { logIntervalFrames?: number };
}

const __dir = dirname(fileURLToPath(import.meta.url));
const configPath = resolve(__dir, '..', 'bridge.config.json');

let config: BridgeConfig = { mode: 'mock' };
try {
  config = JSON.parse(readFileSync(configPath, 'utf-8')) as BridgeConfig;
  console.log(`[bridge] config loaded — mode: ${config.mode}`);
} catch {
  console.warn('[bridge] bridge.config.json not found, using mock mode');
}

// ─── UDP socket (shared for ArtNet + sACN) ───────────────────────────────────

let udp: Socket | null = null;

if (config.mode === 'artnet' || config.mode === 'sacn' || config.mode === 'osc') {
  udp = createSocket('udp4');
  udp.bind(() => {
    udp!.setBroadcast(true);
    console.log(`[bridge] UDP socket ready`);
  });
}

// sACN CID — 16-byte identifier, generated once per process
const SACN_CID = randomBytes(16);
let _sacnSeq = 0;

// ─── ArtNet ──────────────────────────────────────────────────────────────────

const ARTNET_PORT = 6454;

/**
 * Build an ArtDmx packet per Art-Net 4 spec.
 *
 * Layout (530 bytes total = 18 header + 512 data):
 *   0..7   ID string "Art-Net" + null terminator (8 bytes, ASCII)
 *   8..9   OpCode  — OpOutput = 0x5000, transmitted LOW BYTE FIRST on the wire
 *                   (so bytes are 0x00, 0x50 — writeUInt16LE(0x5000) does this)
 *   10..11 ProtVer — 14, HIGH BYTE FIRST (big-endian)
 *   12     Sequence (0 disables ordering enforcement on the receiver)
 *   13     Physical input port on the sender (cosmetic, 0 is fine)
 *   14     SubUni — low byte of the 15-bit universe address (sub-net << 4 | uni)
 *   15     Net    — upper 7 bits of the universe address
 *   16..17 Length — DMX data byte count, HIGH BYTE FIRST (512 for a full frame)
 *   18..529 DMX data (start-code is implicit 0 and NOT included here)
 *
 * The OpCode value is the one protocol-level detail most buggy implementations
 * get wrong: `OpOutput` is 0x5000, not 0x0050. A receiver interprets the two
 * OpCode bytes as a little-endian uint16, so the byte pattern 0x50 0x00 reads
 * as 0x0050 (unknown → silently dropped), while 0x00 0x50 reads as 0x5000
 * (ArtDmx → accepted).
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
  const host = config.artnet?.host ?? '255.255.255.255';
  const port = config.artnet?.port ?? ARTNET_PORT;
  const packet = buildArtDmxPacket(universe, data);
  udp.send(packet, port, host, (err) => {
    if (err) console.error('[bridge] ArtNet send error:', err.message);
  });
  _artnetSendCount++;
  if (_artnetSendCount === 1 || _artnetSendCount % 100 === 0) {
    const active = data.filter(v => v > 0).length;
    console.log(`[bridge] ArtNet → ${host}:${port} uni${universe} (${active} active ch, packet #${_artnetSendCount})`);
  }
}

// ─── sACN (E1.31) ────────────────────────────────────────────────────────────

const SACN_PORT = 5568;
const ACN_IDENT = Buffer.from([
  0x41, 0x53, 0x43, 0x2d, 0x45, 0x31, 0x2e, 0x31, 0x37, 0x00, 0x00, 0x00,
]);

/** Build a full E1.31 UDP packet for one universe. */
function buildSACNPacket(universe: number, data: number[], priority = 100): Buffer {
  const TOTAL = 638; // 126 header + 1 start code + 511 data... actually 126 + 512 = 638
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

  // Source name [44-107]: "lumen\0" padded
  buf.write('lumen', 44, 'ascii');

  buf[108] = priority & 0xff;                     // Priority
  buf[109] = 0x00;                                // Reserved hi
  buf[110] = 0x00;                                // Reserved lo
  buf[111] = _sacnSeq++ & 0xff;                   // Sequence number
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

function sacnMulticastAddr(universe: number): string {
  return `239.255.${(universe >> 8) & 0xff}.${universe & 0xff}`;
}

function sendSACN(universe: number, data: number[]): void {
  if (!udp) return;
  const priority = config.sacn?.priority ?? 100;
  const packet = buildSACNPacket(universe, data, priority);
  const addr = sacnMulticastAddr(universe);
  udp.send(packet, SACN_PORT, addr, (err) => {
    if (err) console.error('[bridge] sACN send error:', err.message);
  });
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
    const address = `/lumen/${universe}/${i + 1}`;
    const msg = buildOscMessage(address, raw / 255);
    udp.send(msg, port, host);
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

function sendMock(universe: number, data: number[]): void {
  _mockFrame++;
  // Log ~2x per second (every 7th frame at ~15hz send rate)
  if (_mockFrame % 7 !== 0) return;

  const active = data
    .map((v, i) => ({ ch: i + 1, v }))
    .filter(({ v }) => v > 0);

  if (active.length > 0) {
    const summary = active.map(({ ch, v }) => `ch${ch}=${v}`).join('  ');
    console.log(`[mock] uni${universe} | ${summary}`);
  }
}

// ─── Runtime config update ───────────────────────────────────────────────────

function handleConfigMessage(msg: Record<string, unknown>): void {
  if (msg.mode && typeof msg.mode === 'string') {
    const newMode = msg.mode as BridgeConfig['mode'];
    const oldMode = config.mode;
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
        universe: typeof s.universe === 'number' ? s.universe : config.sacn?.universe ?? 1,
        priority: typeof s.priority === 'number' ? s.priority : config.sacn?.priority ?? 100,
      };
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
      udp = createSocket('udp4');
      udp.bind(() => {
        udp!.setBroadcast(true);
        console.log(`[bridge] UDP socket ready (created for ${newMode})`);
      });
    }

    console.log(`[bridge] config updated — mode: ${config.mode}` +
      (config.mode === 'artnet' ? ` → ${config.artnet?.host}:${config.artnet?.port}` : '') +
      (config.mode === 'sacn' ? ` → universe ${config.sacn?.universe}` : '') +
      (config.mode === 'osc' ? ` → ${config.osc?.host}:${config.osc?.port}` : ''));
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
      default:
        sendMock(universe, channels);
    }
  }
}

// ─── WebSocket server ─────────────────────────────────────────────────────────

const httpServer = createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('lumen bridge running');
});

const wss = new WebSocketServer({ server: httpServer });

wss.on('connection', (ws: WebSocket) => {
  console.log(`[bridge] client connected (${wss.clients.size} total)`);

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
httpServer.listen(PORT, () => {
  console.log(`[bridge] WebSocket server on ws://localhost:${PORT}`);
  console.log(`[bridge] output mode: ${config.mode}`);
});
