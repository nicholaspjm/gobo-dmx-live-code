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
  mode: 'artnet' | 'sacn' | 'mock';
  artnet?: { host: string; port?: number };
  sacn?: { universe?: number; priority?: number };
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

if (config.mode === 'artnet' || config.mode === 'sacn') {
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

function buildArtDmxPacket(universe: number, data: number[]): Buffer {
  const buf = Buffer.alloc(530); // 18 header + 512 data
  buf.fill(0);

  // ID: "Art-Net\0"
  buf.write('Art-Net\0', 0, 'ascii');

  // OpCode: 0x0050 (ArtDmx), little-endian
  buf.writeUInt16LE(0x0050, 8);

  // Protocol version 14, big-endian
  buf.writeUInt16BE(14, 10);

  // Sequence (0 = don't enforce ordering)
  buf[12] = 0;
  // Physical
  buf[13] = 0;

  // Universe: SubUni (low byte) + Net (high 7 bits)
  buf[14] = universe & 0xff;
  buf[15] = (universe >> 8) & 0x7f;

  // Length of DMX data, big-endian
  buf.writeUInt16BE(512, 16);

  // DMX data
  for (let i = 0; i < 512; i++) {
    buf[18 + i] = data[i] ?? 0;
  }

  return buf;
}

function sendArtNet(universe: number, data: number[]): void {
  if (!udp) return;
  const host = config.artnet?.host ?? '255.255.255.255';
  const port = config.artnet?.port ?? ARTNET_PORT;
  const packet = buildArtDmxPacket(universe, data);
  udp.send(packet, port, host, (err) => {
    if (err) console.error('[bridge] ArtNet send error:', err.message);
  });
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

// ─── Mock output ─────────────────────────────────────────────────────────────

let _mockFrame = 0;
const LOG_INTERVAL = config.mock?.logIntervalFrames ?? 44;

function sendMock(universe: number, data: number[]): void {
  _mockFrame++;
  if (_mockFrame % LOG_INTERVAL !== 0) return;

  const active = data
    .map((v, i) => ({ ch: i + 1, v }))
    .filter(({ v }) => v > 0)
    .slice(0, 12);

  if (active.length > 0) {
    const summary = active.map(({ ch, v }) => `ch${ch}=${v}`).join('  ');
    console.log(`[mock] uni${universe} | ${summary}`);
  }
}

// ─── Route DMX message ───────────────────────────────────────────────────────

function handleDmxMessage(universes: Record<string, number[]>): void {
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
      const msg = JSON.parse(raw.toString()) as { type: string; universes?: Record<string, number[]> };
      if (msg.type === 'dmx' && msg.universes) {
        handleDmxMessage(msg.universes);
      }
    } catch {
      // Ignore malformed messages
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
