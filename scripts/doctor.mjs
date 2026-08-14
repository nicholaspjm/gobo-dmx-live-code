#!/usr/bin/env node
/**
 * Output diagnostics: answers "why is nothing reaching my rig".
 *
 * Checks each link in the chain in order and stops guessing where it can
 * measure instead. Run it on the machine that is meant to be sending:
 *
 *   npm run doctor
 *   npm run doctor -- --host 2.0.0.100
 *
 * Everything here is read-only apart from sending a handful of Art-Net
 * frames to the host under test.
 */

import { createSocket } from 'node:dgram';
import { networkInterfaces, hostname, platform, release } from 'node:os';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { execFile } from 'node:child_process';

const ARTNET_PORT = 6454;
const BRIDGE_PORT = 3001;
const here = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = join(here, '..', 'packages', 'bridge', 'bridge.config.json');

const args = process.argv.slice(2);
function flag(name, fallback = null) {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
}
if (args.includes('--help')) {
  console.log(`gobo doctor

  npm run doctor                     check everything, send to the broadcast
                                     address of each live interface
  npm run doctor -- --host <ip>      also send to a specific node or broadcast
  npm run doctor -- --port <n>       Art-Net port (default ${ARTNET_PORT})
`);
  process.exit(0);
}
const port = Number(flag('port', ARTNET_PORT));
const explicitHost = flag('host');

const ok = (m) => console.log(`  ok    ${m}`);
const bad = (m) => console.log(`  FAIL  ${m}`);
const warn = (m) => console.log(`  note  ${m}`);
const head = (m) => console.log(`\n${m}`);

console.log(`gobo doctor · ${hostname()} · ${platform()} ${release()} · node ${process.version}`);

// 1. Interfaces, and the broadcast address that goes with each one.
head('1. network interfaces');
const live = [];
for (const [name, addrs] of Object.entries(networkInterfaces())) {
  for (const a of addrs ?? []) {
    if (a.family !== 'IPv4') continue;
    const ip = a.address.split('.').map(Number);
    const nm = a.netmask.split('.').map(Number);
    const bcast = ip.map((o, i) => (o & nm[i]) | (~nm[i] & 255)).join('.');
    const subnet = ip.map((o, i) => o & nm[i]).join('.');
    if (a.internal) {
      console.log(`  loopback  ${a.address}`);
    } else {
      live.push({ name, address: a.address, bcast, subnet, netmask: a.netmask });
      console.log(`  ${name}  ip ${a.address}  mask ${a.netmask}`);
      console.log(`      subnet ${subnet}  broadcast ${bcast}`);
    }
  }
}
if (live.length === 0) bad('no live IPv4 interface. Nothing can reach a rig.');
else if (live.length > 1) warn(`${live.length} live interfaces. The OS picks one for broadcast, so prefer a node IP or the broadcast of the rig's subnet.`);

// 2. What the bridge will start with.
head('2. bridge.config.json (the bridge boots with this)');
let cfg = null;
try {
  cfg = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  const host = cfg.artnet?.host ?? '(unset)';
  console.log(`  mode ${cfg.mode}   artnet host ${host}:${cfg.artnet?.port ?? ARTNET_PORT}`);
  if (cfg.mode === 'artnet' && host === '127.0.0.1') {
    warn('127.0.0.1 only reaches software on this machine. Calling artnet(<ip>) in a scene overrides it at runtime.');
  }
  if (cfg.mode === 'mock') bad('mode is mock. Nothing leaves this machine until that changes.');
} catch (err) {
  warn(`could not read ${CONFIG_PATH}: ${err.message}`);
}

// 3. Is a bridge actually running?
head('3. bridge process');
const bridgeUp = await new Promise((resolve) => {
  const sock = createSocket('udp4');
  sock.close();
  import('node:net').then(({ connect }) => {
    const c = connect({ port: BRIDGE_PORT, host: '127.0.0.1' });
    const done = (v) => { try { c.destroy(); } catch {} resolve(v); };
    c.on('connect', () => done(true));
    c.on('error', () => done(false));
    setTimeout(() => done(false), 1200);
  });
});
if (bridgeUp) ok(`something is listening on ${BRIDGE_PORT}, so the browser can reach a bridge`);
else bad(`nothing is listening on ${BRIDGE_PORT}. The web app cannot send DMX without it. Start it with: npm run dev:bridge`);

// 4. Can this machine actually put Art-Net on the wire?
head('4. sending Art-Net');
const targets = [];
if (explicitHost) targets.push(explicitHost);
for (const i of live) targets.push(i.bcast);
if (targets.length === 0) targets.push('127.0.0.1');

const packet = Buffer.alloc(530);
packet.write('Art-Net\0', 0, 'ascii');
packet.writeUInt16LE(0x5000, 8);
packet.writeUInt16BE(14, 10);
packet[14] = 0;
packet.writeUInt16BE(512, 16);

const sender = createSocket('udp4');
sender.on('error', () => {});
await new Promise((r) => sender.bind(r));
try { sender.setBroadcast(true); ok('broadcast enabled on the sending socket'); }
catch (err) { bad(`could not enable broadcast: ${err.message}`); }

const ownAddresses = new Set(live.map((i) => i.address));
for (const host of [...new Set(targets)]) {
  if (ownAddresses.has(host)) {
    bad(`${host} is THIS machine's own address, so the frames never leave it. Use the node's IP, or the broadcast address of that subnet.`);
  }
  const err = await new Promise((resolve) => {
    sender.send(packet, port, host, (e) => resolve(e));
  });
  if (!err && ownAddresses.has(host)) warn(`sent to ${host}:${port}, but see above`);
  else if (!err) ok(`sent to ${host}:${port}`);
  else if (err.code === 'EACCES') bad(`${host}:${port} refused (EACCES). Broadcast is being blocked, usually a firewall.`);
  else if (err.code === 'ENETUNREACH') bad(`${host}:${port} unreachable. This machine has no route to that subnet, so check the rig's IP against yours.`);
  else bad(`${host}:${port} failed: ${err.code ?? err.message}`);
}
sender.close();

// 5. Is anything on this machine already holding the Art-Net port?
head(`5. port ${port} on this machine`);
const held = await new Promise((resolve) => {
  const probe = createSocket({ type: 'udp4', reuseAddr: false });
  probe.once('error', (e) => resolve(e.code === 'EADDRINUSE'));
  probe.bind(port, () => { probe.close(); resolve(false); });
});
if (held) warn(`port ${port} is in use, most likely by a receiver such as TouchDesigner. That is fine for sending, and only matters if you also want to receive here.`);
else ok(`port ${port} is free, so nothing on this machine is receiving Art-Net`);

// 6. Windows firewall profile, the usual cause of silently dropped broadcast.
// ─── Art-Net discovery ───────────────────────────────────────────────────────

/**
 * Ask the network what Art-Net nodes are out there, and which universe each
 * one listens on.
 *
 * "The IPs are right but nothing arrives" is usually a universe mismatch:
 * gobo puts fixtures on universe 0 by default, and plenty of nodes ship
 * configured for universe 1. A node answering ArtPoll proves the path works
 * in both directions and reports the number it actually wants.
 */
async function discoverNodes(timeoutMs = 2500) {
  const poll = Buffer.alloc(14);
  poll.write('Art-Net', 0, 'ascii');
  poll.writeUInt16LE(0x2000, 8);   // OpPoll
  poll.writeUInt16BE(14, 10);      // protocol version
  poll[12] = 0;                    // TalkToMe
  poll[13] = 0;                    // Priority

  const found = new Map();
  const sock = createSocket({ type: 'udp4', reuseAddr: true });
  sock.on('error', () => {});
  sock.on('message', (msg, rinfo) => {
    if (msg.length < 200) return;
    if (msg.toString('ascii', 0, 7) !== 'Art-Net') return;
    if (msg.readUInt16LE(8) !== 0x2100) return;   // OpPollReply

    const netSwitch = msg[18];
    const subSwitch = msg[19];
    const numPorts = msg.readUInt16BE(172);
    const universes = [];
    for (let i = 0; i < Math.min(numPorts, 4); i += 1) {
      // Art-Net addresses are Net (7 bits), Sub-Net (4 bits), Universe (4 bits).
      universes.push(((netSwitch & 0x7f) << 8) | ((subSwitch & 0x0f) << 4) | (msg[190 + i] & 0x0f));
    }
    const clean = (b) => b.toString('ascii').replace(/.*$/, '').trim();
    found.set(rinfo.address, {
      ip: rinfo.address,
      short: clean(msg.subarray(26, 44)),
      long: clean(msg.subarray(44, 108)),
      report: clean(msg.subarray(108, 172)),
      universes,
    });
  });

  await new Promise((r) => sock.bind(6454, r));
  try { sock.setBroadcast(true); } catch { /* unicast still works */ }

  // Broadcast on every live interface: with more than one NIC the OS picks
  // just one for a plain broadcast, which may not be the lighting network.
  const targets = ['255.255.255.255', ...live.map((i) => i.bcast)];
  for (const t of new Set(targets)) {
    await new Promise((r) => sock.send(poll, ARTNET_PORT, t, () => r()));
  }
  await new Promise((r) => setTimeout(r, timeoutMs));
  sock.close();
  return [...found.values()];
}

head(`6. Art-Net nodes on the network`);
const nodes = await discoverNodes();
if (nodes.length === 0) {
  warn('no node answered ArtPoll within 2.5s.');
  warn('Not proof of a fault: plenty of nodes never reply. But if yours does normally, check the cable, the subnet, and the firewall.');
} else {
  for (const n of nodes) {
    ok(`${n.ip}  ${n.short || '(no name)'}${n.long && n.long !== n.short ? ` / ${n.long}` : ''}`);
    if (n.universes.length) {
      console.log(`            listening on universe ${n.universes.join(', ')}`);
      if (!n.universes.includes(0)) {
        warn(`this node does NOT listen on universe 0, which is where gobo puts fixtures by default.`);
        warn(`Either set the node to 0, or put your fixtures on ${n.universes[0]}: fixture(1, 'rgbw', ${n.universes[0]})`);
      }
    }
    if (n.report) console.log(`            reports: ${n.report}`);
  }
}

if (platform() === 'win32') {
  head('7. windows firewall');
  const out = await new Promise((resolve) => {
    execFile('netsh', ['advfirewall', 'show', 'currentprofile'], { timeout: 5000 }, (e, stdout) => resolve(e ? '' : stdout));
  });
  const on = /State\s+ON/i.test(out);
  const profile = /^(\w[\w ]*?) Profile Settings/im.exec(out)?.[1] ?? 'current';
  if (on) warn(`${profile} profile firewall is ON. If the network is set to Public, Windows drops incoming and some broadcast traffic. Set the network to Private, or allow node.exe.`);
  else ok(`${profile} profile firewall is off`);
}

head('next');
console.log(`  Send a real 5 second ramp to a target and watch the rig:
    npm run bridge:selftest -- --host ${explicitHost ?? live[0]?.bcast ?? '127.0.0.1'}
  That bypasses the browser and the bridge, so if the rig responds the wire is
  fine and the problem is in the app. If it does not, it is the network, the
  address, or the firewall.`);
