/**
 * WebSocket client: sends DMX universe state to the bridge on each tick.
 *
 * Runs in the browser. The bridge listens on ws://localhost:3001.
 *
 * Wire format (JSON):
 *   { type: "dmx", universes: { "1": [0, 128, 255, ...], ... } }
 */

/**
 * Pick the bridge host:
 *  - When served from localhost or a LAN IP (e.g. `npm run dev`), use the same host
 *    so phones/tablets on the LAN can reach the bridge on the dev machine.
 *  - When served from a public host (e.g. github.io), fall back to `localhost`.
 *    Browsers allow `ws://localhost` even from https pages (loopback exception),
 *    so the user just needs to run `npm run bridge` locally.
 */
function pickBridgeHost(): string {
  const h = window.location.hostname;
  if (h === 'localhost' || h === '127.0.0.1') return h;
  if (/^192\.168\./.test(h)) return h;
  if (/^10\./.test(h)) return h;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return h;
  return 'localhost';
}

const BRIDGE_URL = `ws://${pickBridgeHost()}:3001`;
const RECONNECT_DELAY_MS = 2000;

let _ws: WebSocket | null = null;
let _connected = false;
let _onStatusChange: ((connected: boolean) => void) | null = null;
let _reconnectTimer: ReturnType<typeof setTimeout> | null = null;

// The last output config the scene asked for, kept so it can be re-sent.
// The bridge only knows what it has been told since it started, and it falls
// back to bridge.config.json on boot. Without this, restarting the bridge (tsx
// watch does that on every file save) silently moves output back to the config
// file's host while the UI still reads "bridge", so a rig goes quiet with
// nothing on screen explaining why.
let _lastConfig: Record<string, unknown> | null = null;
let _configDelivered = false;

export function onStatusChange(fn: (connected: boolean) => void): void {
  _onStatusChange = fn;
}

export function isConnected(): boolean {
  return _connected;
}

export function connectBridge(url = BRIDGE_URL): void {
  if (_ws) {
    _ws.onopen = null;
    _ws.onclose = null;
    _ws.onerror = null;
    _ws.close();
    _ws = null;
  }
  if (_reconnectTimer) {
    clearTimeout(_reconnectTimer);
    _reconnectTimer = null;
  }

  try {
    _ws = new WebSocket(url);
  } catch {
    scheduleReconnect(url);
    return;
  }

  _ws.onopen = () => {
    _connected = true;
    // Re-apply the scene's output config. A fresh bridge starts on whatever
    // bridge.config.json says, which is not where the scene asked to send.
    flushConfig();
    _onStatusChange?.(true);
    console.log('[gobo] bridge connected');
  };

  _ws.onclose = () => {
    _connected = false;
    // The next bridge to accept us is a fresh process that has not been told
    // anything, so the config counts as undelivered until it is re-sent.
    _configDelivered = false;
    _onStatusChange?.(false);
    console.log('[gobo] bridge disconnected, reconnecting…');
    scheduleReconnect(url);
  };

  _ws.onerror = () => {
    // onclose fires immediately after onerror, reconnect handled there
  };
}

function scheduleReconnect(url: string): void {
  _reconnectTimer = setTimeout(() => connectBridge(url), RECONNECT_DELAY_MS);
}

/**
 * Send a config update to the bridge.
 * Reconfigures output mode, host, port, universe at runtime.
 */
export function sendConfig(config: Record<string, unknown>): void {
  // Recorded even when the socket is down, so it can be applied on connect and
  // so the UI can tell the operator their output is not going anywhere yet.
  _lastConfig = config;
  _configDelivered = false;
  flushConfig();
}

function flushConfig(): void {
  if (!_lastConfig) return;
  if (!_ws || _ws.readyState !== WebSocket.OPEN) return;
  try {
    _ws.send(JSON.stringify({ type: 'config', ..._lastConfig }));
    _configDelivered = true;
  } catch {
    // Socket might have closed between the readyState check and the send.
  }
}

/**
 * The output the scene last asked for, and whether the bridge has been told.
 * `delivered: false` means DMX is not reaching the configured target, either
 * because no bridge is running or because it dropped after the config was set.
 * Returns null when the scene has not selected an output at all.
 */
export function getOutputConfig(): { config: Record<string, unknown>; delivered: boolean } | null {
  return _lastConfig ? { config: _lastConfig, delivered: _configDelivered } : null;
}

/**
 * Send universe state to the bridge. Called on each scheduler tick.
 *
 * Skips idle universes (those that have never carried data) to cut traffic. A
 * universe that was non-zero and is now all-zero gets one final zero-frame so
 * downstream fixtures go dark. Without it, Art-Net / sACN / OSC receivers latch
 * their last value and a commented-out pattern leaves the rig on its last
 * colour.
 *
 * `_wasNonZero` tracks the per-universe "has been live" state across calls so
 * we can detect the dark transition. A universe is added when we send live data
 * and removed after the trailing zero-frame; from then on idle frames are
 * skipped again.
 */
const _wasNonZero = new Set<number>();

export function sendUniverseState(universes: Map<number, Uint8Array>): void {
  const bridgeOpen = _ws?.readyState === WebSocket.OPEN;
  const directOpen = isDirectOpen();
  if (!bridgeOpen && !directOpen) return;

  const payload: Record<string, number[]> = {};
  for (const [universe, buffer] of universes) {
    const hasData = buffer.some((v) => v > 0);
    if (hasData) {
      payload[String(universe)] = Array.from(buffer);
      _wasNonZero.add(universe);
    } else if (_wasNonZero.has(universe)) {
      // Just went dark: emit one zero-frame to clear downstream fixtures,
      // then drop out of the set so subsequent idle frames are skipped.
      payload[String(universe)] = Array.from(buffer);
      _wasNonZero.delete(universe);
    }
  }

  if (Object.keys(payload).length === 0) return;
  const frame = JSON.stringify({ type: 'dmx', universes: payload });

  if (bridgeOpen) {
    try {
      _ws!.send(frame);
    } catch {
      // Socket might have closed between the check and the send
    }
  }
  sendDirect(frame);
}

// ─── Direct output: browser straight to a WebSocket receiver ─────────────────
//
// A browser cannot open a UDP socket, so it can never speak Art-Net itself.
// It can speak WebSocket, though, and anything already running on the machine
// that receives WebSocket can do the UDP part. TouchDesigner's WebSocket DAT
// is the usual one: the page sends frames straight to TD, and TD puts Art-Net
// on the wire. That removes gobo's own bridge from the picture, so the hosted
// build works with nothing installed beyond what is already open.
//
// The catch is mixed content. A page served over https may only open ws:// to
// localhost or 127.0.0.1, which browsers treat as trustworthy. A receiver on
// another machine needs the page served over http, or the receiver behind wss.

let _direct: WebSocket | null = null;
let _directUrl: string | null = null;
let _directConnected = false;
let _directReconnectTimer: ReturnType<typeof setTimeout> | null = null;
let _onDirectStatusChange: ((connected: boolean) => void) | null = null;

export function onDirectStatusChange(fn: (connected: boolean) => void): void {
  _onDirectStatusChange = fn;
}

export function isDirectConnected(): boolean {
  return _directConnected;
}

export function getDirectUrl(): string | null {
  return _directUrl;
}

function isDirectOpen(): boolean {
  return _direct?.readyState === WebSocket.OPEN;
}

/**
 * True when the browser will refuse this connection as mixed content. Worth
 * reporting up front: the failure otherwise looks identical to "the receiver
 * is not running", and no amount of restarting the receiver fixes it.
 */
export function isBlockedAsMixedContent(host: string): boolean {
  const secure = typeof window !== 'undefined' && window.location?.protocol === 'https:';
  const trusted = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  return secure && !trusted;
}

/** Open a direct output socket to a WebSocket receiver such as TouchDesigner. */
export function connectDirect(host = 'localhost', port = 9980): void {
  const url = `ws://${host}:${port}`;
  _directUrl = url;

  if (_directReconnectTimer) {
    clearTimeout(_directReconnectTimer);
    _directReconnectTimer = null;
  }
  closeDirectSocket();

  try {
    _direct = new WebSocket(url);
  } catch {
    scheduleDirectReconnect();
    return;
  }

  _direct.onopen = () => {
    _directConnected = true;
    _onDirectStatusChange?.(true);
    console.log(`[gobo] direct output connected (${url})`);
  };
  _direct.onclose = () => {
    if (_directConnected) {
      _directConnected = false;
      _onDirectStatusChange?.(false);
    }
    scheduleDirectReconnect();
  };
  _direct.onerror = () => {
    // onclose follows, which handles the retry.
  };
}

/** Stop direct output and close the socket. */
export function disconnectDirect(): void {
  _directUrl = null;
  if (_directReconnectTimer) {
    clearTimeout(_directReconnectTimer);
    _directReconnectTimer = null;
  }
  closeDirectSocket();
  if (_directConnected) {
    _directConnected = false;
    _onDirectStatusChange?.(false);
  }
}

function closeDirectSocket(): void {
  if (!_direct) return;
  _direct.onopen = null;
  _direct.onclose = null;
  _direct.onerror = null;
  try { _direct.close(); } catch { /* already closed */ }
  _direct = null;
}

function scheduleDirectReconnect(): void {
  if (!_directUrl) return;
  if (_directReconnectTimer) return;
  _directReconnectTimer = setTimeout(() => {
    _directReconnectTimer = null;
    if (_directUrl) {
      const [, host, port] = /^ws:\/\/([^:]+):(\d+)$/.exec(_directUrl) ?? [];
      if (host && port) connectDirect(host, Number(port));
    }
  }, RECONNECT_DELAY_MS);
}

function sendDirect(frame: string): void {
  if (!isDirectOpen()) return;
  try {
    _direct!.send(frame);
  } catch {
    // Socket might have closed between the check and the send.
  }
}

/**
 * Push the editor's text to the receiver, for showing the running code inside
 * TouchDesigner. Ignored by receivers that only handle `dmx` messages.
 */
export function sendDirectCode(text: string): void {
  if (!isDirectOpen()) return;
  try {
    _direct!.send(JSON.stringify({ type: 'code', text }));
  } catch {
    // Socket might have closed between the check and the send.
  }
}
