/**
 * Binding the connector's port, with the access checks in front of it.
 *
 * Its own module so a test can start the real listener on a spare port and
 * knock on it: index.ts binds 3001 the moment it is imported, which no test can
 * share with a connector that is already running.
 *
 * One HTTP server per address rather than one server on every interface. The
 * loopback default is two addresses (see bindAddresses in access.ts), and a
 * Node server listens once. Both share the request handler and the WebSocket
 * server, so to everything above this module they are one connector.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http';
import type { Duplex } from 'stream';
import type { WebSocketServer } from 'ws';
import { checkHost, checkUpgrade, type AccessPolicy, type Check } from './access.js';

export interface ListenOptions {
  port: number;
  /** From bindAddresses(). `undefined` means every interface. */
  addresses: (string | undefined)[];
  policy: AccessPolicy;
  /** A WebSocketServer made with { noServer: true }. */
  wss: WebSocketServer;
  /** Called for every HTTP request that passed the host check. */
  onRequest: (req: IncomingMessage, res: ServerResponse) => void;
  /** Called for every request or upgrade that was turned away. */
  onRefused?: (req: IncomingMessage, refusal: Refusal) => void;
}

/** What was turned away, by which check, and when. */
export interface Refusal {
  check: Check;
  reason: string;
  during: 'request' | 'upgrade';
}

export interface Listening {
  servers: Server[];
  /** What was actually bound, in words, for the startup log. */
  bound: string[];
  close(): Promise<void>;
}

/**
 * Errors that mean the address does not exist on this machine, as opposed to
 * something else holding the port. They are only forgiven for ::1: a machine
 * with IPv6 switched off has no IPv6 loopback, and the IPv4 one is enough.
 */
const ADDRESS_MISSING = new Set(['EADDRNOTAVAIL', 'EAFNOSUPPORT', 'EINVAL']);

function listenOne(server: Server, port: number, address: string | undefined): Promise<void> {
  return new Promise((done, fail) => {
    const onError = (err: Error): void => fail(err);
    server.once('error', onError);
    const ready = (): void => {
      server.off('error', onError);
      done();
    };
    if (address === undefined) server.listen(port, ready);
    else server.listen(port, address, ready);
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((done) => server.close(() => done()));
}

function refuseUpgrade(socket: Duplex, reason: string): void {
  // A plain HTTP answer on the raw socket, which is all a refused upgrade gets.
  // The browser reports a failed connection either way; the reason is for
  // anyone looking with curl.
  const body = `gobo's connector refused this connection: ${reason}.\n`;
  socket.end(
    'HTTP/1.1 403 Forbidden\r\n'
    + 'Content-Type: text/plain; charset=utf-8\r\n'
    + `Content-Length: ${Buffer.byteLength(body)}\r\n`
    + 'Connection: close\r\n\r\n'
    + body,
  );
}

function makeServer(opts: ListenOptions): Server {
  const server = createServer((req, res) => {
    const verdict = checkHost(req.headers.host, opts.policy);
    if (!verdict.ok) {
      opts.onRefused?.(req, { check: verdict.check, reason: verdict.reason, during: 'request' });
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(`gobo's connector refused this request: ${verdict.reason}.\n`);
      return;
    }
    opts.onRequest(req, res);
  });

  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    // Installed before anything is written. A client that drops mid-handshake
    // errors this socket, and an error with no listener takes the process down,
    // which for this process means the rig freezes on its last frame.
    socket.on('error', () => { /* the client has gone; nothing to answer */ });
    const verdict = checkUpgrade({ host: req.headers.host, origin: req.headers.origin }, opts.policy);
    if (!verdict.ok) {
      opts.onRefused?.(req, { check: verdict.check, reason: verdict.reason, during: 'upgrade' });
      refuseUpgrade(socket, verdict.reason);
      return;
    }
    opts.wss.handleUpgrade(req, socket, head, (ws) => opts.wss.emit('connection', ws, req));
  });

  return server;
}

/**
 * Bind every address, or none.
 *
 * A failure partway through closes whatever was already bound before it
 * rejects, so a connector that could not start leaves no half of itself
 * listening. EADDRINUSE on any address rejects: something else is on the port,
 * and a connector sharing 3001 with another one is the confusion that message
 * exists to prevent.
 */
export async function listenAll(opts: ListenOptions): Promise<Listening> {
  const servers: Server[] = [];
  const bound: string[] = [];
  for (const address of opts.addresses) {
    const server = makeServer(opts);
    try {
      await listenOne(server, opts.port, address);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? '';
      if (address === '::1' && ADDRESS_MISSING.has(code)) continue;
      await Promise.all(servers.map(closeServer));
      throw err;
    }
    servers.push(server);
    bound.push(address ?? 'every interface');
  }
  return {
    servers,
    bound,
    close: async () => {
      await Promise.all(servers.map(closeServer));
    },
  };
}
