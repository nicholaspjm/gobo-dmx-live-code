/**
 * WebSocket client — sends DMX universe state to the bridge on each tick.
 *
 * Runs in the browser. The bridge listens on ws://localhost:3001.
 *
 * Wire format (JSON):
 *   { type: "dmx", universes: { "1": [0, 128, 255, ...], ... } }
 */

// Use the server's hostname so this works from other devices on the LAN
const BRIDGE_URL = `ws://${window.location.hostname}:3001`;
const RECONNECT_DELAY_MS = 2000;

let _ws: WebSocket | null = null;
let _connected = false;
let _onStatusChange: ((connected: boolean) => void) | null = null;
let _reconnectTimer: ReturnType<typeof setTimeout> | null = null;

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

/**
 * Send universe state over the WebSocket.
 * Called on each scheduler tick.
 */
export function sendUniverseState(universes: Map<number, Uint8Array>): void {
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
