/**
 * The entire boundary between the desktop app and the page.
 *
 * One frozen object, two fields, nothing callable. The page runs with
 * contextIsolation on and nodeIntegration off, and the UI already talks to the
 * bridge over its WebSocket, so there is nothing else it needs from here. The
 * flag exists so the app can say the connector download is beside the point in
 * this build: every output works, because the bridge is in the same process.
 *
 * A .cts file, and so a CommonJS dist/preload.cjs: Electron loads a sandboxed
 * preload as CommonJS regardless of the package being type: module.
 */

import { contextBridge } from 'electron';

export interface GoboDesktop {
  /** Always true here. The web build has no window.gobo at all. */
  desktop: true;
  /** The app's version, from package.json by way of main.ts. */
  version: string;
}

/**
 * Read a value the main process passed in through additionalArguments.
 *
 * A sandboxed preload cannot require anything from the app, so the command line
 * is the only channel. Guarded because process.argv is the runtime's, not ours.
 */
function argValue(prefix: string): string | undefined {
  try {
    const args: unknown = process.argv;
    if (!Array.isArray(args)) return undefined;
    const hit = args.find((a): a is string => typeof a === 'string' && a.startsWith(prefix));
    return hit?.slice(prefix.length);
  } catch {
    return undefined;
  }
}

const api: GoboDesktop = Object.freeze({
  desktop: true,
  // 'unknown' rather than a made-up number: a version string nothing set is
  // worse than an obviously absent one.
  version: argValue('--gobo-version=') ?? 'unknown',
});

contextBridge.exposeInMainWorld('gobo', api);
