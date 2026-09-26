/**
 * The listener with its access checks, knocked on for real.
 *
 * access.test.ts pins the rules. These pin that the rules are actually in front
 * of the socket: a real HTTP server on a spare loopback port, a real ws server
 * behind it, and real ws clients sending the headers a browser would. A policy
 * that is correct but never consulted would pass every test in the other file.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { request } from 'http';
import { connect } from 'net';
import { networkInterfaces } from 'os';
import { WebSocketServer, WebSocket } from 'ws';

import { createPolicy } from './access.js';
import { listenAll, type Listening } from './listen.js';

let listening: Listening;
let port: number;
const refused: string[] = [];

beforeAll(async () => {
  const wss = new WebSocketServer({ noServer: true });
  wss.on('connection', (ws) => ws.send('hello'));
  listening = await listenAll({
    // Port 0 for a spare one, and one address, because two addresses given
    // port 0 would each get a different port.
    port: 0,
    addresses: ['127.0.0.1'],
    policy: createPolicy({ lan: false, hostedApp: 'https://nicholaspjm.github.io/gobo-dmx-live-code/' }),
    wss,
    onRequest: (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('served');
    },
    onRefused: (_req, r) => refused.push(`${r.during} ${r.check}: ${r.reason}`),
  });
  const address = listening.servers[0].address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  port = address.port;
});

afterAll(async () => {
  await listening.close();
});

/** Open a WebSocket with the given headers; resolve with what happened. */
function knock(headers: { origin?: string; host?: string }): Promise<'open' | number> {
  return new Promise((done, fail) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/`, {
      ...(headers.origin !== undefined ? { origin: headers.origin } : {}),
      ...(headers.host !== undefined ? { headers: { host: headers.host } } : {}),
    });
    ws.on('open', () => {
      ws.close();
      done('open');
    });
    ws.on('unexpected-response', (_req, res) => {
      done(res.statusCode ?? 0);
      res.resume();
    });
    ws.on('error', (err) => {
      // After an unexpected response ws may also report an error; the answer
      // has already been given by then.
      if (!/Unexpected server response/.test(err.message)) fail(err);
    });
  });
}

function get(host: string): Promise<number> {
  return new Promise((done, fail) => {
    const req = request({ host: '127.0.0.1', port, path: '/', headers: { host } }, (res) => {
      res.resume();
      done(res.statusCode ?? 0);
    });
    req.on('error', fail);
    req.end();
  });
}

describe('the connector, knocked on', () => {
  it('opens for gobo on the hosted site', async () => {
    expect(await knock({ origin: 'https://nicholaspjm.github.io' })).toBe('open');
  });

  it('opens for a page served from this computer', async () => {
    expect(await knock({ origin: 'http://localhost:3000' })).toBe('open');
  });

  it('opens for a client that is not a browser', async () => {
    expect(await knock({})).toBe('open');
  });

  it('turns away a page on any other site, with a 403 rather than a hang', async () => {
    expect(await knock({ origin: 'https://attacker.example' })).toBe(403);
  });

  it('turns away DNS rebinding, where Origin and Host agree on a name', async () => {
    expect(await knock({
      origin: `http://attacker.example:${port}`,
      host: `attacker.example:${port}`,
    })).toBe(403);
  });

  it('says why, once per refusal, to whoever is logging', () => {
    expect(refused.some((r) => r.startsWith('upgrade origin: only gobo itself'))).toBe(true);
    // Rebinding is caught by the Host check, not the Origin one, which is what
    // stops the log offering --allow-origin as the fix for it.
    expect(refused.some((r) => r.startsWith('upgrade host: attacker.example is not localhost'))).toBe(true);
  });

  it('checks the host on plain requests too', async () => {
    expect(await get(`localhost:${port}`)).toBe(200);
    expect(await get(`attacker.example:${port}`)).toBe(403);
  });

  it('is not reachable from the network at all', async () => {
    // The whole point of loopback binding. Skipped only on a machine with no
    // external IPv4 address to try from.
    const external = Object.values(networkInterfaces())
      .flat()
      .find((a) => a && a.family === 'IPv4' && !a.internal);
    if (!external) return;
    const outcome = await new Promise<string>((done) => {
      const socket = connect({ host: external.address, port }, () => {
        socket.destroy();
        done('connected');
      });
      socket.on('error', (err: NodeJS.ErrnoException) => done(err.code ?? 'error'));
    });
    expect(outcome).toBe('ECONNREFUSED');
  });
});
