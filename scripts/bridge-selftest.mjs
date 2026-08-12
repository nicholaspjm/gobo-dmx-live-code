#!/usr/bin/env node
/**
 * DMX wire-path self test — proves packets actually leave this machine.
 *
 * Sends a short ramp/hold/fade test sequence straight out of a UDP socket
 * as Art-Net or sACN, bypassing the browser, the UI and the bridge's
 * WebSocket layer entirely. If a fixture responds to this, the network
 * side is fine and any remaining problem is upstream in the app.
 *
 * The packet builders below are a byte-for-byte reimplementation of the
 * ones in packages/bridge/src/index.ts. They are duplicated rather than
 * imported so this script stays zero-dependency and needs no build step —
 * if you change the wire format there, change it here too.
 *
 *   node scripts/bridge-selftest.mjs --help
 */

import { createSocket } from 'node:dgram';
import { randomBytes } from 'node:crypto';

// ─── CLI ─────────────────────────────────────────────────────────────────────

const USAGE = `
lumen bridge self test — send a DMX test sequence directly to the wire.

  node scripts/bridge-selftest.mjs [options]

Options
  --mode <artnet|sacn>   output protocol                 (default artnet)
  --host <ip>            Art-Net target address          (default 255.255.255.255)
  --port <n>             Art-Net UDP port                (default 6454)
  --universe <n>         universe number                 (default 1)
  --channels <a-b>       1-indexed channel range         (default 1-4)
  --duration <seconds>   total sequence length           (default 5)
  --fps <n>              frame rate                      (default 40)
  --priority <n>         sACN priority, 1-200            (default 100)
  --help                 print this and exit

Notes
  The sequence is a 40% ramp 0->255, a 20% hold at full, a 40% fade back to
  0, then one explicit all-zero frame so nothing stays latched.

  sACN ignores --host and --port: it always multicasts to 239.255.<hi>.<lo>
  on port 5568, derived from the universe number.

  A successful run only proves the packets were handed to the OS and left
  the interface. It cannot tell you whether a node or fixture received them.
`.trimStart();

const DEFAULTS = {
  mode: 'artnet',
  host: '255.255.255.255',
  port: 6454,
  universe: 1,
  channels: '1-4',
  duration: 5,
  fps: 40,
  priority: 100,
};

function fail(message) {
  console.error(`error: ${message}`);
  console.error('run with --help for usage.');
  process.exit(1);
}

function parseArgs(argv) {
  const opts = { ...DEFAULTS };
  const numeric = new Set(['port', 'universe', 'duration', 'fps', 'priority']);

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === '--help' || arg === '-h') {
      console.log(USAGE);
      process.exit(0);
    }

    if (!arg.startsWith('--')) fail(`unexpected argument "${arg}"`);

    // support both "--key value" and "--key=value"
    const eq = arg.indexOf('=');
    const key = (eq === -1 ? arg : arg.slice(0, eq)).slice(2);
    const value = eq === -1 ? argv[++i] : arg.slice(eq + 1);

    if (!(key in DEFAULTS)) fail(`unknown option "--${key}"`);
    if (value === undefined) fail(`--${key} needs a value`);

    if (numeric.has(key)) {
      const n = Number(value);
      if (!Number.isFinite(n)) fail(`--${key} expects a number, got "${value}"`);
      opts[key] = n;
    } else {
      opts[key] = value;
    }
  }

  if (opts.mode !== 'artnet' && opts.mode !== 'sacn') {
    fail(`--mode expects "artnet" or "sacn", got "${opts.mode}"`);
  }
  if (!Number.isInteger(opts.universe) || opts.universe < 0 || opts.universe > 32767) {
    fail(`--universe expects an integer 0-32767, got "${opts.universe}"`);
  }
  if (!Number.isInteger(opts.port) || opts.port < 1 || opts.port > 65535) {
    fail(`--port expects an integer 1-65535, got "${opts.port}"`);
  }
  if (opts.duration <= 0) fail('--duration must be greater than 0');
  if (opts.fps <= 0 || opts.fps > 200) fail('--fps must be between 1 and 200');
  if (!Number.isInteger(opts.priority) || opts.priority < 1 || opts.priority > 200) {
    fail(`--priority expects an integer 1-200, got "${opts.priority}"`);
  }

  const range = /^(\d+)\s*-\s*(\d+)$/.exec(String(opts.channels));
  if (!range) fail(`--channels expects a range like "1-4", got "${opts.channels}"`);
  const first = Number(range[1]);
  const last = Number(range[2]);
  if (first < 1 || last > 512) fail('--channels must fall inside 1-512');
  if (first > last) fail(`--channels range is backwards ("${opts.channels}")`);
  opts.firstChannel = first;
  opts.lastChannel = last;

  return opts;
}

const opts = parseArgs(process.argv.slice(2));

// ─── Art-Net packet (mirrors buildArtDmxPacket in the bridge) ────────────────

/**
 * ArtDmx, 530 bytes = 18 header + 512 data.
 *
 *   0..7   "Art-Net\0"
 *   8..9   OpCode 0x5000 (OpOutput), low byte first on the wire
 *   10..11 ProtVer 14, high byte first
 *   12     Sequence (0 = receiver does not enforce ordering)
 *   13     Physical
 *   14     SubUni — low byte of the universe address
 *   15     Net    — upper 7 bits
 *   16..17 Length, high byte first
 *   18..   DMX data (start code is implicit 0 and not transmitted)
 */
function buildArtDmxPacket(universe, data) {
  const buf = Buffer.alloc(530);

  buf.write('Art-Net\0', 0, 'ascii');
  buf.writeUInt16LE(0x5000, 8);
  buf.writeUInt16BE(14, 10);
  buf[12] = 0;
  buf[13] = 0;
  buf[14] = universe & 0xff;
  buf[15] = (universe >> 8) & 0x7f;
  buf.writeUInt16BE(512, 16);

  for (let i = 0; i < 512; i++) buf[18 + i] = data[i] ?? 0;

  return buf;
}

// ─── sACN packet (mirrors buildSACNPacket in the bridge) ─────────────────────

const SACN_PORT = 5568;
const ACN_IDENT = Buffer.from([
  0x41, 0x53, 0x43, 0x2d, 0x45, 0x31, 0x2e, 0x31, 0x37, 0x00, 0x00, 0x00,
]);

// 16-byte component identifier, generated once per process, same as the bridge.
const SACN_CID = randomBytes(16);
let sacnSeq = 0;

/** E1.31 data packet, 638 bytes = 126 header + start code + 511 slots. */
function buildSACNPacket(universe, data, priority) {
  const TOTAL = 638;
  const buf = Buffer.alloc(TOTAL, 0);

  // Root layer
  buf.writeUInt16BE(0x0010, 0);              // preamble size
  buf.writeUInt16BE(0x0000, 2);              // postamble size
  ACN_IDENT.copy(buf, 4);                    // ACN packet identifier [4-15]
  buf.writeUInt16BE(0x7000 | (TOTAL - 16), 16);
  buf.writeUInt32BE(0x00000004, 18);         // root vector — E1.31 data
  SACN_CID.copy(buf, 22);                    // CID [22-37]

  // Framing layer
  buf.writeUInt16BE(0x7000 | (TOTAL - 38), 38);
  buf.writeUInt32BE(0x00000002, 40);         // DATA_PACKET
  buf.write('lumen', 44, 'ascii');           // source name [44-107]
  buf[108] = priority & 0xff;
  buf[109] = 0x00;                           // reserved
  buf[110] = 0x00;
  buf[111] = sacnSeq++ & 0xff;               // sequence
  buf[112] = 0x00;                           // options
  buf.writeUInt16BE(universe, 113);

  // DMP layer
  buf.writeUInt16BE(0x7000 | (TOTAL - 115), 115);
  buf[117] = 0x02;                           // SET_PROPERTY
  buf[118] = 0xa1;                           // address + data type
  buf.writeUInt16BE(0x0000, 119);            // first property address
  buf.writeUInt16BE(0x0001, 121);            // address increment
  buf.writeUInt16BE(513, 123);               // property count — start code + 512
  buf[125] = 0x00;                           // DMX start code

  for (let i = 0; i < 512; i++) buf[126 + i] = data[i] ?? 0;

  return buf;
}

/** Multicast group for a universe, per E1.31: 239.255.<hi>.<lo>. */
function sacnMulticastAddr(universe) {
  return `239.255.${(universe >> 8) & 0xff}.${universe & 0xff}`;
}

// ─── Sequence ────────────────────────────────────────────────────────────────

/**
 * Level at a point in the sequence, 0..1:
 * first 40% ramps up, next 20% holds full, last 40% fades back down.
 */
function levelAt(progress) {
  if (progress <= 0) return 0;
  if (progress >= 1) return 0;
  if (progress < 0.4) return progress / 0.4;
  if (progress < 0.6) return 1;
  return 1 - (progress - 0.6) / 0.4;
}

const isBroadcast = opts.mode === 'artnet' && opts.host.endsWith('.255');
const target =
  opts.mode === 'sacn'
    ? `${sacnMulticastAddr(opts.universe)}:${SACN_PORT}`
    : `${opts.host}:${opts.port}`;
const channelCount = opts.lastChannel - opts.firstChannel + 1;
const packetBytes = opts.mode === 'sacn' ? 638 : 530;
const frameMs = 1000 / opts.fps;

console.log('lumen bridge self test');
console.log(`  mode      ${opts.mode}${opts.mode === 'sacn' ? ` (priority ${opts.priority})` : ''}`);
console.log(`  target    ${target}${isBroadcast ? ' (broadcast)' : ''}${opts.mode === 'sacn' ? ' (multicast)' : ''}`);
console.log(`  universe  ${opts.universe}`);
console.log(`  channels  ${opts.firstChannel}-${opts.lastChannel} (${channelCount} ch)`);
console.log(`  duration  ${opts.duration}s at ${opts.fps} fps, ${packetBytes}-byte packets`);
console.log(`  sequence  ramp 0->255, hold full, fade to 0, then a blackout frame`);
console.log('');

// ─── Socket ──────────────────────────────────────────────────────────────────

/** Turn a socket/send error into something a human can act on. */
function explain(err) {
  const code = err?.code ?? '';
  switch (code) {
    case 'EACCES':
    case 'EPERM':
      return isBroadcast
        ? 'the OS refused the broadcast send. a firewall or security policy is\n' +
          'blocking UDP broadcast — try a direct node address with --host <ip>.'
        : 'the OS refused the send. check firewall rules for outbound UDP on\n' +
          `port ${opts.mode === 'sacn' ? SACN_PORT : opts.port}.`;
    case 'EADDRINUSE':
      return 'the local UDP port is already taken — another lighting app or a\n' +
        'running bridge probably holds it. close it and try again.';
    case 'ENETUNREACH':
    case 'EHOSTUNREACH':
    case 'ENETDOWN':
      return `no route to ${target}. check the interface is up and on the same\n` +
        'subnet as the node (Art-Net rigs are usually 2.x.x.x or 10.x.x.x).';
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return `"${opts.host}" could not be resolved. pass a literal IP address to\n` +
        '--host — Art-Net nodes rarely have DNS names.';
    case 'EADDRNOTAVAIL':
      return 'the local address is not available on any interface — the network\n' +
        'you were bound to may have gone away.';
    case 'ERR_SOCKET_DGRAM_NOT_RUNNING':
      return 'the socket closed before the frame was sent.';
    default:
      return err?.message ?? String(err);
  }
}

function abort(err) {
  console.error('');
  console.error(`failed — ${err?.code ? `${err.code}: ` : ''}${err?.message ?? err}`);
  console.error(explain(err));
  try {
    socket.close();
  } catch {
    // socket may already be gone; nothing useful to do here
  }
  process.exit(1);
}

const socket = createSocket('udp4');
socket.on('error', abort);

const data = new Array(512).fill(0);
let frames = 0;
let started = 0;
let lastProgressLog = 0;
let nextFrameAt = 0;
let timer = null;

/** Write one level across the selected channels and put it on the wire. */
function sendFrame(value, done) {
  for (let ch = opts.firstChannel; ch <= opts.lastChannel; ch++) {
    data[ch - 1] = value;
  }

  const packet =
    opts.mode === 'sacn'
      ? buildSACNPacket(opts.universe, data, opts.priority)
      : buildArtDmxPacket(opts.universe, data);

  const port = opts.mode === 'sacn' ? SACN_PORT : opts.port;
  const host = opts.mode === 'sacn' ? sacnMulticastAddr(opts.universe) : opts.host;

  socket.send(packet, port, host, (err) => {
    if (err) abort(err);
    else if (done) done();
  });
  frames++;
}

function finish() {
  if (timer) clearTimeout(timer);
  timer = null;

  // Explicit blackout so nothing is left latched on the rig. Wait for the
  // send to complete before closing, or the socket dies under the packet.
  sendFrame(0, () => {
    const elapsed = (Date.now() - started) / 1000;
    socket.close(() => {
      console.log('');
      console.log(
        `done — sent ${frames} frames in ${elapsed.toFixed(1)}s ` +
        `(${(frames / elapsed).toFixed(1)} fps), final blackout frame sent`,
      );
      console.log(`packets left this machine for ${target} — the send path works.`);
      process.exit(0);
    });
  });
}

function tick() {
  timer = null;
  const elapsed = (Date.now() - started) / 1000;

  if (elapsed >= opts.duration) {
    finish();
    return;
  }

  const value = Math.round(levelAt(elapsed / opts.duration) * 255);
  sendFrame(value);

  if (elapsed - lastProgressLog >= 1) {
    lastProgressLog = Math.floor(elapsed);
    const phase = elapsed / opts.duration < 0.4 ? 'ramp' : elapsed / opts.duration < 0.6 ? 'hold' : 'fade';
    console.log(
      `  ${elapsed.toFixed(0)}s / ${opts.duration}s  ${phase}  ` +
      `ch${opts.firstChannel}-${opts.lastChannel} = ${value}  (${frames} frames)`,
    );
  }

  // Schedule against an absolute frame clock rather than setInterval, which
  // drifts badly under Windows' ~15ms timer granularity.
  nextFrameAt += frameMs;
  timer = setTimeout(tick, Math.max(0, nextFrameAt - Date.now()));
}

// Bind before sending so setBroadcast can be applied — without it a send to
// 255.255.255.255 is dropped by the OS on most systems, silently.
socket.bind(() => {
  try {
    socket.setBroadcast(true);
  } catch (err) {
    abort(err);
    return;
  }

  started = Date.now();
  nextFrameAt = started;
  tick();
});

// Ctrl-C should still black the rig out rather than leaving it latched.
process.on('SIGINT', () => {
  if (timer) clearTimeout(timer);
  console.log('');
  console.log('interrupted — sending blackout frame');
  try {
    sendFrame(0, () => socket.close(() => process.exit(130)));
  } catch {
    process.exit(130);
  }
});
