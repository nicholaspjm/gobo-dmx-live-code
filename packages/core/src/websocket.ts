/**
 * WebSocket client — sends DMX universe state to the bridge on each tick.
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

// Direct-to-TouchDesigner WebSocket (bypasses the bridge)
let _td_ws: WebSocket | null = null;
let _tdConnected = false;
let _tdUrl: string | null = null;
let _tdReconnectTimer: ReturnType<typeof setTimeout> | null = null;
let _onTDStatusChange: ((connected: boolean) => void) | null = null;

// Which socket the scheduler's DMX data flows to.
// Updated by user code via osc()/artnet()/sacn()/mock() → 'bridge'
// or td() → 'td'. Prevents double-sends when both sockets happen to be open.
export type OutputTarget = 'bridge' | 'td';
let _outputTarget: OutputTarget = 'bridge';

export function setOutputTarget(target: OutputTarget): void {
  _outputTarget = target;
}

export function getOutputTarget(): OutputTarget {
  return _outputTarget;
}

export function onStatusChange(fn: (connected: boolean) => void): void {
  _onStatusChange = fn;
}

export function onTDStatusChange(fn: (connected: boolean) => void): void {
  _onTDStatusChange = fn;
}

export function isConnected(): boolean {
  return _connected;
}

export function isTDConnected(): boolean {
  return _tdConnected;
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
    _onStatusChange?.(true);
    console.log('[lumen] bridge connected');
  };

  _ws.onclose = () => {
    _connected = false;
    _onStatusChange?.(false);
    console.log('[lumen] bridge disconnected — reconnecting…');
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
  if (!_ws || _ws.readyState !== WebSocket.OPEN) return;
  try {
    _ws.send(JSON.stringify({ type: 'config', ...config }));
  } catch {
    // Socket might have closed
  }
}

// ─── Direct TouchDesigner WebSocket ───────────────────────────────────────────
// Opens a second WebSocket straight to a TouchDesigner WebSocket DAT (server).
// TD receives the same wire format as the bridge:
//   { "type": "dmx", "universes": { "1": [0, 128, 255, ...] } }
// This bypasses the Node bridge entirely — useful when the only target is TD.

/**
 * Connect direct to TouchDesigner's WebSocket DAT (server mode).
 * @param host — defaults to localhost
 * @param port — defaults to 9980
 */
export function connectTD(host = 'localhost', port = 9980): void {
  const url = `ws://${host}:${port}`;
  _tdUrl = url;

  if (_tdReconnectTimer) {
    clearTimeout(_tdReconnectTimer);
    _tdReconnectTimer = null;
  }

  // Tear down any previous socket so switching host/port is clean
  if (_td_ws) {
    _td_ws.onopen = null;
    _td_ws.onclose = null;
    _td_ws.onerror = null;
    try { _td_ws.close(); } catch { /* already closed */ }
    _td_ws = null;
  }

  try {
    _td_ws = new WebSocket(url);
  } catch {
    scheduleTDReconnect();
    return;
  }

  _td_ws.onopen = () => {
    _tdConnected = true;
    _onTDStatusChange?.(true);
    console.log(`[lumen] TouchDesigner connected (${url})`);
  };

  _td_ws.onclose = () => {
    _tdConnected = false;
    _onTDStatusChange?.(false);
    console.log('[lumen] TouchDesigner disconnected — reconnecting…');
    scheduleTDReconnect();
  };

  _td_ws.onerror = () => {
    // onclose follows; reconnect handled there
  };
}

/** Stop direct TD output and close the socket. */
export function disconnectTD(): void {
  _tdUrl = null;
  if (_tdReconnectTimer) {
    clearTimeout(_tdReconnectTimer);
    _tdReconnectTimer = null;
  }
  if (_td_ws) {
    _td_ws.onopen = null;
    _td_ws.onclose = null;
    _td_ws.onerror = null;
    try { _td_ws.close(); } catch { /* already closed */ }
    _td_ws = null;
  }
  if (_tdConnected) {
    _tdConnected = false;
    _onTDStatusChange?.(false);
  }
}

function scheduleTDReconnect(): void {
  if (!_tdUrl) return;
  _tdReconnectTimer = setTimeout(() => {
    if (_tdUrl) connectTD(...parseUrl(_tdUrl));
  }, RECONNECT_DELAY_MS);
}

function parseUrl(url: string): [string, number] {
  const m = url.match(/^ws:\/\/([^:]+):(\d+)/);
  if (!m) return ['localhost', 9980];
  return [m[1], parseInt(m[2], 10)];
}

/**
 * Send the current editor source code to TouchDesigner as a text payload,
 * piggybacking on the same TD WebSocket we already use for DMX.
 *
 * Wire format:
 *   { "type": "code", "text": "<full editor contents>" }
 *
 * The TD callback script routes this into a Text DAT which a Text TOP can
 * render as a visual. Indentation and line breaks are preserved as plain
 * text; syntax highlighting colours are not (a Text TOP uses one colour
 * for the whole string).
 *
 * No-op when the TD socket isn't open. Safe to call every keystroke; the
 * payload is a few KB and TD handles it without fuss.
 */
export function sendCodeTD(text: string): void {
  if (!_td_ws || _td_ws.readyState !== WebSocket.OPEN) return;
  try {
    _td_ws.send(JSON.stringify({ type: 'code', text }));
  } catch {
    // Socket might have closed between check and send
  }
}

/**
 * Send universe state direct to TouchDesigner.
 * No-op when the TD socket isn't open.
 */
export function sendUniverseStateTD(universes: Map<number, Uint8Array>): void {
  if (_outputTarget !== 'td') return;
  if (!_td_ws || _td_ws.readyState !== WebSocket.OPEN) return;

  // Unlike the bridge path, we always send every known universe here —
  // even zero-only frames. TD's side caches incoming values into a table,
  // and if we skipped empty frames a channel that dropped to 0 would
  // latch on its last non-zero value (same bug we fixed for OSC).
  const payload: Record<string, number[]> = {};
  for (const [universe, buffer] of universes) {
    payload[String(universe)] = Array.from(buffer);
  }

  if (Object.keys(payload).length === 0) return;

  try {
    _td_ws.send(JSON.stringify({ type: 'dmx', universes: payload }));
  } catch {
    // Socket might have closed between check and send
  }
}

/**
 * Send universe state over the WebSocket.
 * Called on each scheduler tick.
 */
export function sendUniverseState(universes: Map<number, Uint8Array>): void {
  if (_outputTarget !== 'bridge') return;
  if (!_ws || _ws.readyState !== WebSocket.OPEN) return;

  const payload: Record<string, number[]> = {};
  for (const [universe, buffer] of universes) {
    // Only send universes that have at least one active channel
    const hasData = buffer.some((v) => v > 0);
    if (hasData) {
      payload[String(universe)] = Array.from(buffer);
    }
  }

  if (Object.keys(payload).length === 0) return;

  try {
    _ws.send(JSON.stringify({ type: 'dmx', universes: payload }));
  } catch {
    // Socket might have closed between the check and the send
  }
}
