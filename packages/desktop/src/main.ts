/**
 * gobo desktop: one window, with the bridge running inside it.
 *
 * A browser cannot open a UDP socket. There is no API for it, in any browser,
 * so Art-Net, sACN and OSC always need a native process. This build is that
 * process. The main process starts the same bridge the connector runs, in this
 * process exactly as scripts/start.mjs does, and the bridge serves the built UI
 * from its own HTTP server on port 3001. The window then loads
 * http://localhost:3001.
 *
 * Loading a URL rather than a file keeps one code path with the connector: the
 * page is served the same way, and its WebSocket is same origin, so nothing in
 * the UI needs a desktop-only branch to talk to the bridge.
 *
 * The renderer gets no Node access. The only thing crossing into the page is
 * window.gobo, from preload.cts.
 */

import { app, BrowserWindow, shell } from 'electron';
import { existsSync } from 'node:fs';
import { get as httpGet } from 'node:http';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** The bridge's port. It is fixed there, and the UI connects to it by number. */
const BRIDGE_PORT = 3001;
const APP_URL = `http://localhost:${BRIDGE_PORT}`;

/** Where the app lives for someone who wants to keep using their connector. */
const HOSTED_APP = 'https://nicholaspjm.github.io/gobo-dmx-live-code/';

/** How long to let the bridge come up before calling it a failure. */
const READY_TIMEOUT_MS = 15000;
const READY_POLL_MS = 100;

const here = dirname(fileURLToPath(import.meta.url));

/** The window, kept so 'second-instance' and macOS 'activate' can find it. */
let win: BrowserWindow | null = null;

interface Payload {
  /** Directory holding the built UI, the one passed to the bridge as --ui. */
  uiDir: string;
  /** The bridge's built entry point, imported into this process. */
  bridgeEntry: string;
}

/**
 * Where the UI build and the bridge build are.
 *
 * Packaged, both are plain files under resources/ rather than inside app.asar:
 * the bridge is imported as ESM and loads `ws` through normal Node resolution,
 * and neither is worth making work through an archive.
 */
function payloadPaths(): Payload {
  if (app.isPackaged) {
    return {
      uiDir: join(process.resourcesPath, 'ui'),
      bridgeEntry: join(process.resourcesPath, 'bridge', 'dist', 'index.js'),
    };
  }
  // dist/main.js -> packages/desktop -> packages -> repo root
  const repoRoot = resolve(here, '..', '..', '..');
  return {
    uiDir: join(repoRoot, 'dist'),
    bridgeEntry: join(repoRoot, 'packages', 'bridge', 'dist', 'index.js'),
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

/**
 * Whether the bridge's port can still be bound.
 *
 * The bridge exits the process when it cannot listen, which in here would close
 * the app with no window and no explanation. Asking first turns that into a
 * message. There is a gap between this check and the bridge's own listen, so
 * the readiness wait below is still the backstop.
 */
function portIsFree(port: number): Promise<boolean> {
  return new Promise((done) => {
    const probe = createServer();
    probe.once('error', () => done(false));
    probe.once('listening', () => probe.close(() => done(true)));
    // No host, matching the bridge, which listens on every interface. Probing
    // only 127.0.0.1 would miss a clash with something bound to 0.0.0.0.
    probe.listen(port);
  });
}

/** One request against the bridge's HTTP server; any answer counts as up. */
function serverAnswers(): Promise<boolean> {
  return new Promise((done) => {
    const req = httpGet({ host: '127.0.0.1', port: BRIDGE_PORT, path: '/', timeout: 1000 }, (res) => {
      res.resume();
      done(true);
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => done(false));
  });
}

/**
 * Wait for the server to answer before the window is pointed at it, so a slow
 * start shows an empty window rather than the browser's connection error page,
 * which someone would reasonably read as the app being broken.
 */
async function waitForServer(): Promise<boolean> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await serverAnswers()) return true;
    await delay(READY_POLL_MS);
  }
  return false;
}

/**
 * Start the bridge in this process.
 *
 * Same shape as scripts/start.mjs: hand it its flags through process.argv, then
 * import it. One process to start, one to stop, and the bridge's own blackout
 * on the last client leaving still applies when the window closes.
 */
async function startBridge(paths: Payload): Promise<void> {
  process.argv = [
    process.argv[0],
    paths.bridgeEntry,
    '--ui', paths.uiDir,
    // The bridge decides it is a packaged connector by looking at the name of
    // the running executable, and this one is not called node. Without this
    // flag it would register a login item pointing at the desktop app, which
    // nobody asked for. Its config path is passed for the same reason: the
    // default for a packaged build is beside the executable, which on Windows
    // is inside Program Files.
    '--no-install',
    '--config', join(app.getPath('userData'), 'bridge.config.json'),
  ];
  await import(pathToFileURL(paths.bridgeEntry).href);
}

/**
 * A page for the cases where there is nothing to show.
 *
 * Deliberately static: no script and no IPC, because the only thing this build
 * puts into a page is the window.gobo flag, and a failure screen is not a
 * reason to widen that.
 */
function failurePage(heading: string, paragraphs: string[]): string {
  const body = paragraphs.map((p) => `<p>${p}</p>`).join('\n');
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>gobo</title><style>
  html, body { height: 100%; margin: 0; }
  body {
    background: #1a1714; color: #e8dfd0; font-size: 14px; line-height: 1.6;
    font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', Consolas, monospace;
    display: flex; align-items: center; justify-content: center; padding: 32px;
  }
  main { max-width: 46em; }
  h1 { font-size: 16px; color: #c4724a; margin: 0 0 16px; font-weight: 600; }
  p { margin: 0 0 12px; }
  code { color: #b8956a; }
  a { color: #b8956a; }
</style></head>
<body><main><h1>${heading}</h1>${body}</main></body></html>`;
}

async function showFailure(heading: string, paragraphs: string[]): Promise<void> {
  if (!win) return;
  const html = failurePage(heading, paragraphs);
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  win.show();
}

function createWindow(): BrowserWindow {
  const w = new BrowserWindow({
    // Room for the editor and the console beside a stage, and small enough for
    // a laptop at a tech table.
    width: 1280,
    height: 820,
    minWidth: 720,
    minHeight: 480,
    title: 'gobo',
    // The editor's own background, so the frame does not flash white while the
    // first paint is on its way.
    backgroundColor: '#1a1714',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(here, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      // The only way to hand a sandboxed preload a value from here.
      additionalArguments: [`--gobo-version=${app.getVersion()}`],
    },
  });

  w.once('ready-to-show', () => w.show());
  w.on('closed', () => { win = null; });

  // Links in the app (docs, the repository) belong in a real browser, not in a
  // window with no address bar and no way back.
  w.webContents.setWindowOpenHandler(({ url }) => {
    openExternally(url);
    return { action: 'deny' };
  });

  // Only fires for navigation the page starts, so the failure screens loaded
  // through loadURL below are not affected.
  w.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith(APP_URL)) return;
    event.preventDefault();
    openExternally(url);
  });

  return w;
}

/** Hand a URL to the user's browser, http and https only. */
function openExternally(url: string): void {
  if (!/^https?:\/\//i.test(url)) return;
  void shell.openExternal(url);
}

async function main(): Promise<void> {
  // A second copy would fight the first for port 3001 and lose, and the first
  // one already has the window.
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }

  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  await app.whenReady();
  win = createWindow();

  const paths = payloadPaths();
  if (!existsSync(paths.bridgeEntry) || !existsSync(join(paths.uiDir, 'index.html'))) {
    await showFailure('Nothing to run yet', app.isPackaged
      ? [
          'This copy is missing the editor or the bridge, so there is nothing to serve.',
          'The install looks incomplete. Installing it again is the fix.',
        ]
      : [
          'The editor or the bridge has not been built, so there is nothing to serve.',
          'Run <code>npm run desktop:build</code> in the repository, then start this again.',
          `Looked for <code>${paths.uiDir}</code> and <code>${paths.bridgeEntry}</code>.`,
        ]);
    return;
  }

  if (!(await portIsFree(BRIDGE_PORT))) {
    await showFailure('Port 3001 is already taken', [
      'The bridge could not start, so this window has nothing to show.',
      'The usual cause is the gobo connector already running. It starts itself when you log in '
        + 'and it uses the same port. Quit it, then open this app again.',
      `You can also leave the connector where it is and use the app in a browser: <a href="${HOSTED_APP}">${HOSTED_APP}</a>. `
        + 'The connector does the same job this app does internally.',
    ]);
    return;
  }

  try {
    await startBridge(paths);
  } catch (err) {
    await showFailure('The bridge did not start', [
      'Without it there is no output and nothing to serve the editor from.',
      `The error was: <code>${(err as Error).message}</code>`,
    ]);
    return;
  }

  if (!(await waitForServer())) {
    await showFailure('The bridge did not answer', [
      `It started but nothing was listening on port ${BRIDGE_PORT} after ${READY_TIMEOUT_MS / 1000} seconds.`,
      'Another program taking the port at the same moment would do this, as would a firewall '
        + 'blocking local connections. Close anything else that speaks Art-Net and try again.',
    ]);
    return;
  }

  try {
    await win.loadURL(APP_URL);
  } catch (err) {
    await showFailure('The editor did not load', [
      `The bridge is listening on ${APP_URL} but the page did not load.`,
      `The error was: <code>${(err as Error).message}</code>`,
    ]);
  }
}

app.on('window-all-closed', () => {
  // The bridge lives in this process, so on Windows and Linux, where closing
  // the last window means quitting, staying alive would hold port 3001 and the
  // rig's output for a window nobody can see. macOS apps are expected to stay
  // in the dock, and 'activate' below brings the window back.
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (win) return;
  win = createWindow();
  void win.loadURL(APP_URL);
});

void main();
