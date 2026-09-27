/**
 * What each output is, and whether it can be used right now.
 *
 * This file is the only place that knows which outputs work where. The top-bar
 * connection control, the outputs panel and the connector prompt all read their
 * answers from here, so there is one table to correct when the answer changes.
 *
 * A browser cannot open a UDP socket, and no browser offers an API for it, so
 * Art-Net, sACN and OSC need a program on the machine to put the packets on
 * the wire. usb() and td() use APIs a page does have: WebSerial and WebSocket.
 */

import {
  connectorNotice,
  enableMidi,
  getMidiInputNames,
  getSeenControllers,
  isMidiEnabled,
  isMidiSupported,
  getUsbDroppedFrames,
  getConnectorInfo,
  getConnectorNetworks,
  getDirectUrl,
  getOutputConfig,
  isConnected,
  isDirectConnected,
  isUsbConnected,
  isUsbDmxSupported,
  type ConnectorNotice,
} from '@gobo/core';
import { PANEL_OPEN_EVENT } from './panel.js';
import { BLOCKED_BY_BROWSER, browserBlocksConnector, servedLocally } from './browser-access.js';
import { artnetTargetProblem, isLoopbackHost } from './artnet-target.js';

// ─── The table ───────────────────────────────────────────────────────────────

export type OutputId = 'usb' | 'td' | 'artnet' | 'sacn' | 'osc' | 'mock';

/** How the frames leave the page. */
export type OutputTransport = 'serial' | 'websocket' | 'udp';

/** What has to be true before the output can carry light. */
export type OutputNeed = 'hardware' | 'receiver' | 'connector';

/** 'conditional' means the code checks a condition before the output can be used. */
export type Support = 'yes' | 'conditional' | 'no';

export interface OutputInfo {
  id: OutputId;
  /** How the call is written in a scene. */
  label: string;
  transport: OutputTransport;
  /** Whether a plain browser tab can drive this. */
  browser: Support;
  /** Whether the desktop build can drive this. */
  desktop: Support;
  needs: OutputNeed;
  /** One plain paragraph for someone new to all of this. */
  plain: string;
}

export const OUTPUTS: readonly OutputInfo[] = [
  {
    id: 'usb',
    label: 'usb()',
    transport: 'serial',
    browser: 'conditional',
    desktop: 'yes',
    needs: 'hardware',
    plain:
      'Drives a DMX line out of an Enttec DMX USB Pro box plugged into this computer. '
      + 'Chrome or Edge, one universe.',
  },
  {
    id: 'td',
    label: 'td()',
    transport: 'websocket',
    browser: 'conditional',
    desktop: 'yes',
    needs: 'receiver',
    plain:
      'Hands every frame to TouchDesigner, which puts Art-Net on the network.',
  },
  {
    id: 'artnet',
    label: 'artnet()',
    transport: 'udp',
    browser: 'no',
    desktop: 'yes',
    needs: 'connector',
    plain:
      'Sends Art-Net to nodes on your network.',
  },
  {
    id: 'sacn',
    label: 'sacn()',
    transport: 'udp',
    browser: 'no',
    desktop: 'yes',
    needs: 'connector',
    plain:
      'Sends sACN (E1.31) multicast to your rig.',
  },
  {
    id: 'osc',
    label: 'osc()',
    transport: 'udp',
    browser: 'no',
    desktop: 'yes',
    needs: 'connector',
    plain:
      'Sends one OSC message per live channel, to a receiver such as TouchDesigner\'s OSC In.',
  },
  {
    id: 'mock',
    label: 'mock()',
    transport: 'websocket',
    browser: 'no',
    desktop: 'yes',
    needs: 'connector',
    plain:
      'A dry run. Nothing is driven; the connector prints which channels are live about twice a second.',
  },
];

// ─── Runtime checks ──────────────────────────────────────────────────────────

/**
 * The desktop build sets this on window from its preload script. Read through a
 * local cast rather than a global declaration so the UI still type-checks and
 * builds in a checkout with no Electron package present.
 */
interface DesktopFlag {
  desktop?: boolean;
}

/** True only inside the desktop build, where the sender runs in the app. */
export function isDesktopBuild(): boolean {
  const g = (globalThis as { gobo?: DesktopFlag }).gobo;
  return g?.desktop === true;
}

/** Whether this browser exposes WebSerial at all, which usb() needs. */
export function isWebSerialAvailable(): boolean {
  return isUsbDmxSupported();
}

/** Whether something is listening for frames on this machine (connector, or the
 *  sender inside the desktop build). */
export function isBridgeConnected(): boolean {
  return isConnected();
}

/**
 * A released desktop build, or null while none exists.
 *
 * Data rather than markup, so a panel never offers a download that no release
 * provides. While this is null the panel says "there is no desktop download
 * yet", so it has to be set when a desktop build ships.
 */
export interface DesktopRelease {
  label: string;
  url: string;
}

export const DESKTOP_RELEASE: DesktopRelease | null = {
  label: 'download the desktop app',
  url: 'https://github.com/nicholaspjm/gobo-dmx-live-code/releases/latest',
};

/** Where the connector binaries live. */
export const RELEASES_URL = 'https://github.com/nicholaspjm/gobo-dmx-live-code/releases/latest';

/** The connector file itself, so a click downloads it rather than opening a list of files. */
export function connectorDownloadUrl(): string {
  return `${RELEASES_URL}/download/${connectorFileName()}`;
}

/** Best guess at which file to offer, so the visitor is not made to choose. */
export function connectorFileName(): string {
  const ua = navigator.userAgent;
  if (/Windows/i.test(ua)) return 'gobo-connector-windows.exe';
  if (/Mac OS X|Macintosh/i.test(ua)) return 'gobo-connector-macos';
  return 'gobo-connector-linux';
}

/**
 * Whether a connector has ever reached this browser.
 *
 * Someone who already installed one does not need the download offered again.
 * If output is not arriving, their connector is not running, and offering the
 * file a second time suggests the first install failed.
 */
const SEEN_CONNECTOR_KEY = 'gobo-seen-connector-v1';

export function hasSeenConnector(): boolean {
  try { return localStorage.getItem(SEEN_CONNECTOR_KEY) === '1'; } catch { return false; }
}

export function rememberConnector(): void {
  try { localStorage.setItem(SEEN_CONNECTOR_KEY, '1'); } catch { /* private mode */ }
}

// ─── Verdicts ────────────────────────────────────────────────────────────────

export interface OutputVerdict {
  /** True when running a scene with this output would reach physical lights now. */
  ready: boolean;
  /** Short state for the badge, lowercase to match the rest of the bar. */
  badge: string;
  /** One line saying why, or what is already true. */
  reason: string;
  /** The reason is a problem with the scene rather than a missing piece. */
  warn?: boolean;
}

/** Can this output be used right now, and why not. */
export function outputVerdict(id: OutputId): OutputVerdict {
  if (id === 'usb') {
    if (isUsbConnected()) {
      // A dropped frame means the interface could not keep up: sendUsbDmx holds
      // the newest frame and counts one only when a newer frame displaces it
      // before it reaches the wire. A nonzero count means the rig is running
      // behind the scene, so it is reported. Zero is the normal case and is not
      // mentioned.
      const dropped = getUsbDroppedFrames();
      return {
        ready: true,
        badge: 'works here',
        reason: dropped === 0
          ? 'An interface is connected, so usb() drives it on the next run.'
          : `An interface is connected, so usb() drives it on the next run. ${dropped} frame`
            + `${dropped === 1 ? '' : 's'} could not be sent in time, so the rig is running a `
            + 'little behind the scene. Lower the send rate in settings if the count climbs.',
      };
    }
    if (!isWebSerialAvailable()) {
      return {
        ready: false,
        badge: 'needs chrome or edge',
        reason:
          'This browser has no WebSerial, so the page cannot open a USB interface. Chrome and Edge '
          + 'support it; Firefox and Safari do not.',
      };
    }
    return {
      ready: false,
      badge: 'needs a usb interface',
      reason: 'Choose usb here and pick the interface.',
    };
  }

  if (id === 'td') {
    if (isDirectConnected()) {
      return {
        ready: true,
        badge: 'works here',
        reason: `Connected to ${getDirectUrl() ?? 'the receiver'}.`,
      };
    }
    return {
      ready: false,
      badge: 'needs touchdesigner',
      reason:
        'Open TouchDesigner on this computer with a WebSocket DAT listening, then run td(). Over '
        + 'https a page can reach only this computer.',
    };
  }

  // The remaining four all go through a program running on this machine: the
  // three UDP outputs because a page cannot send those packets, and mock()
  // because the printing happens inside the connector.
  if (isBridgeConnected()) {
    const host = id === 'artnet' ? currentArtnetHost() : null;
    const problem = host === null ? null : artnetTargetProblem(host, getConnectorNetworks());
    if (host !== null && problem !== null) {
      return {
        ready: false,
        badge: isLoopbackHost(host) ? 'this computer only' : 'check the address',
        reason: problem,
        warn: true,
      };
    }
    return {
      ready: true,
      badge: 'works here',
      reason: 'The connector is running, so this goes out as soon as a scene uses it.',
    };
  }
  if (isDesktopBuild()) {
    return {
      ready: false,
      badge: 'starting up',
      reason: 'The desktop version sends this itself, and its sender has not connected yet.',
    };
  }
  return {
    ready: false,
    badge: 'needs the connector',
    reason: id === 'mock'
      ? 'The connector prints the channels, so it has to be running.'
      : 'Nothing is listening yet. Run the connector, then press ctrl+enter again.',
  };
}

/**
 * Which output the current scene asked for, or null when it has asked for none.
 *
 * Read from live state rather than from the text in the editor: the buffer can
 * say artnet() while the scene on air was evaluated before that line was typed.
 */
export function currentOutputId(): OutputId | null {
  if (getDirectUrl()) return 'td';
  const out = getOutputConfig();
  const mode = out ? String((out.config as { mode?: unknown }).mode ?? '') : '';
  if (mode === 'artnet' || mode === 'sacn' || mode === 'osc' || mode === 'mock') return mode;
  if (isUsbConnected()) return 'usb';
  return null;
}

/**
 * True when the scene's chosen output needs a program on this machine and none
 * is listening. Drives the lock badge, which is the standing version of the
 * connector banner, so it is silent inside the desktop build where there is
 * nothing to download.
 */
export function needsConnectorUnlock(): boolean {
  if (isDesktopBuild()) return false;
  const id = currentOutputId();
  if (id === null) return false;
  const info = OUTPUTS.find((o) => o.id === id);
  if (!info || info.needs !== 'connector') return false;
  return !isBridgeConnected();
}

/**
 * What to say about the connector's version, or null when there is nothing to
 * say.
 *
 * The important case is a connector that sends no version: it predates the
 * handshake (see HANDSHAKE_SINCE in core), and a build like that cost a rig
 * three rounds of debugging over a fix it did not have. A connector newer than
 * the page is not a fault and gets one quiet line.
 *
 * Nothing here blocks output. A connector older than the page carries every
 * frame it is given and lacks only the fixes made since.
 */
export function connectorVersionNotice(): ConnectorNotice | null {
  // The desktop build has its sender inside it, built from the same checkout,
  // so the two cannot disagree and there is no separate file to replace.
  if (isDesktopBuild()) return null;
  return connectorNotice(getConnectorInfo());
}

export interface ConnectionSummary {
  /**
   * 'idle' means no output has been chosen, which is not a failure.
   * 'ready' means the connector is running and waiting, with no scene output
   * pointed at it yet. Also not a failure, but shown because the connector is
   * a background process and otherwise the only way to know it is alive is to
   * choose an output and find out.
   */
  state: 'connected' | 'disconnected' | 'ready' | 'idle';
  /** What the top-bar label reads. */
  label: string;
  /** Tooltip, the longer version of the same answer. */
  title: string;
}

/**
 * One answer for the connection light, resolved from all three links at once.
 *
 * The bridge, direct output and a USB interface are independent, and a scene can
 * use two of them together. Reading only the bridge socket would put
 * "disconnected" over a rig being driven over USB.
 *
 * A stale connector goes in the tooltip. The label has room for three words,
 * and output is going out either way. The tooltip gets the facts on their own
 * line, so they do not run on from "click for the full list"; what to do about
 * it belongs in the panel that click opens.
 */
export function connectionSummary(): ConnectionSummary {
  const summary = resolveConnection();
  const notice = connectorVersionNotice();
  if (notice?.level === 'stale') {
    return { ...summary, title: `${summary.title}\n\n${notice.reason}` };
  }
  return summary;
}

/** The state of the three links, before anything is said about versions. */
function resolveConnection(): ConnectionSummary {
  const direct = getDirectUrl();
  const config = getOutputConfig();
  const usb = isUsbConnected();

  if (!direct && !config && !usb) {
    if (isBridgeConnected()) {
      return {
        state: 'ready',
        label: 'connector ready',
        title:
          'The connector is running on this computer and this page is talking to it. '
          + 'No frames are going anywhere yet, because the scene has not chosen an output: '
          + 'add artnet(), sacn() or osc() and run. Click for the full list.',
      };
    }
    return {
      state: 'idle',
      label: 'no output chosen',
      title: 'No scene output selected yet. Click to see what this browser can drive.',
    };
  }

  const live: string[] = [];
  if (usb) live.push('usb');
  // Named for what the reader sees: 'td' is the call a scene writes, and
  // 'connector' is what the docs, the package and the download call the
  // program. 'direct' and 'bridge' are internal names no panel or document
  // shows.
  if (direct && isDirectConnected()) live.push('td');
  if (config && isBridgeConnected()) live.push('connector');

  if (live.length > 0) {
    return {
      state: 'connected',
      label: live.join(' + '),
      title: `Output is going out over ${live.join(' and ')}. Click for the full list.`,
    };
  }
  return {
    state: 'disconnected',
    label: 'disconnected',
    title: 'The scene has chosen an output, but nothing is carrying it. Click to see why.',
  };
}

// ─── Copy ────────────────────────────────────────────────────────────────────

export const WHY_BROWSER_CANNOT =
  'Art-Net, sACN and OSC go out as network packets, and a web page is not allowed to put packets '
  + 'on the network by itself. Every browser enforces this, and gobo cannot switch it off.';

/**
 * The intro when gobo itself is running on this computer: the desktop app,
 * npm start or npm run dev. The sender is already here, so the general intro's
 * talk of a connector beside the page would send someone looking for a
 * program they do not need.
 */
export const PANEL_INTRO_LOCAL =
  'gobo is running on this computer, so every output below works with nothing else to start. '
  + 'Art-Net, sACN and OSC go straight out on the network.';

export const PANEL_INTRO =
  'usb() and td() work in this browser. The other outputs send network packets, which a page '
  + 'cannot do, so they need a program running on this computer: the connector, or gobo itself '
  + 'run locally.';

export const DESKTOP_PITCH =
  'The desktop version has the connector built in. Art-Net, sACN, OSC and the dry run work '
  + 'as soon as it opens.';

/** Message for a scene whose output the page cannot carry on its own. */
export function blockedOutputMessage(output: string): string {
  return `${output} sends network packets, which a page cannot do. Run the connector, then press `
    + 'ctrl+enter again. For a USB DMX box instead, open the outputs panel and pick usb.';
}

// ─── Where Art-Net is going ──────────────────────────────────────────────────

/** The call each output's "add to scene" button writes. Art-Net has its own list. */
const DEFAULT_CALL: Partial<Record<OutputId, string>> = {
  usb: 'usb()',
  td: 'td()',
  sacn: 'sacn()',
  osc: 'osc()',
  mock: 'mock()',
};

/** The host the scene on air sends Art-Net to, or null when it is not sending Art-Net. */
function currentArtnetHost(): string | null {
  const out = getOutputConfig();
  const c = out?.config as { mode?: unknown; artnet?: { host?: unknown } } | undefined;
  if (c?.mode !== 'artnet') return null;
  return typeof c.artnet?.host === 'string' ? c.artnet.host : '127.0.0.1';
}

// ─── Panel ───────────────────────────────────────────────────────────────────

export interface OutputsPanel {
  /** Repaint the badges. Cheap, and called whenever a connection changes. */
  refresh: () => void;
}

/**
 * Render the outputs page. The panel shell (panel.ts) owns opening, closing
 * and which tab is showing; this owns the contents.
 *
 * `onUsbRequest` is the same handler the outputs row would reach for anyway. A
 * click inside the panel is still a user gesture, which is what requestPort()
 * requires.
 */
export function mountOutputsPanel(opts: {
  bodyEl: HTMLElement;
  /** Whether this page is the one currently on screen. */
  isOpen: () => boolean;
  onUsbRequest: () => void;
  /** Put an output call into the scene. The scene still runs on ctrl+enter. */
  onUseCode?: (code: string) => void;
}): OutputsPanel {
  const { bodyEl, isOpen, onUsbRequest, onUseCode } = opts;

  function useButton(code: string): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'scene-action';
    b.textContent = 'add to scene';
    b.title = `Write ${code} into the scene. Ctrl+enter runs it.`;
    b.addEventListener('click', () => onUseCode?.(code));
    return b;
  }

  /**
   * The Art-Net lines that reach this computer's networks. Only the connector
   * can see the network, so there is nothing to offer without one.
   */
  function renderArtnetTargets(): HTMLElement | null {
    if (!isBridgeConnected()) return null;
    const networks = getConnectorNetworks();
    if (networks.length === 0) return null;
    const host = currentArtnetHost();

    const wrap = document.createElement('div');
    wrap.className = 'artnet-targets';
    const intro = document.createElement('p');
    intro.className = 'output-plain';
    intro.textContent = networks.length === 1
      ? 'This computer is on one network. This line reaches every node on it:'
      : 'This computer is on these networks. Each line reaches every node on one:';
    wrap.appendChild(intro);
    for (const n of networks) {
      const code = `artnet('${n.broadcast}')`;
      const line = document.createElement('div');
      line.className = 'artnet-target';
      const pre = document.createElement('code');
      pre.className = 'connector-how-code';
      pre.textContent = code;
      const me = document.createElement('span');
      me.className = 'artnet-target-me';
      me.textContent = `this computer: ${n.address}`;
      line.append(pre, me);
      if (onUseCode && host !== n.broadcast) line.appendChild(useButton(code));
      wrap.appendChild(line);
    }
    return wrap;
  }

  // Redrawn from scratch each time it comes into view, because every badge
  // is a live verdict about hardware and a stale badge would misreport it.
  bodyEl.addEventListener(PANEL_OPEN_EVENT, () => render());

  /**
   * Whether the connector is running, and which one it is.
   *
   * It is a background process that installs itself as a login item, so months
   * can pass between setting it up and checking on it. Without this box, the
   * only way to tell is to choose an output and see whether light comes out.
   */
  function renderConnectorStatus(): HTMLElement {
    const box = document.createElement('div');
    const up = isBridgeConnected();
    // Blocked and not running have different fixes: see browser-access.ts.
    const blocked = !up && browserBlocksConnector();
    box.className = up ? 'connector-status up' : 'connector-status';

    const notice = up ? connectorVersionNotice() : null;

    const head = document.createElement('div');
    head.className = 'connector-status-head';
    const dot = document.createElement('span');
    dot.className = 'connector-status-dot';
    const name = document.createElement('span');
    name.className = 'connector-status-name';
    name.textContent = up ? 'connector running' : blocked ? 'connector blocked by this browser' : 'connector not running';
    head.append(dot, name);

    // The plain badge: the sage one marks a good state, and an out-of-date
    // connector is neither good news nor a failure.
    if (notice) {
      const flag = document.createElement('span');
      flag.className = 'output-badge';
      flag.textContent = notice.badge;
      head.appendChild(flag);
    }

    const where = document.createElement('span');
    where.className = 'connector-status-where';
    // The version sits with the address, since both identify which connector
    // this is. It is left off when none was sent, and the notice line below
    // explains why.
    const version = up ? getConnectorInfo()?.version : null;
    where.textContent = up ? (version ? `${version} · localhost:3001` : 'localhost:3001') : '';
    head.appendChild(where);

    const what = document.createElement('p');
    what.className = 'connector-status-what';
    // Only the standalone connector starts with the computer. Served locally,
    // the sender is the program that served this page, which someone started.
    const local = isDesktopBuild() || servedLocally();
    what.textContent = up
      ? local
        ? 'Listening for frames and putting Art-Net, sACN or OSC on the network. It is part of the '
          + 'gobo that served this page, so it runs for as long as that does.'
        : 'Listening for frames and putting Art-Net, sACN or OSC on the network. It starts with '
          + 'your computer, which is why you may not remember running it.'
      : blocked ? BLOCKED_BY_BROWSER
      : 'Art-Net, sACN and OSC need it. usb() and td() work without it.';
    box.append(head, what);

    // Shown in full: someone who does not know their connector is missing
    // fixes will not open anything to find out. Two classes, for the spacing
    // of one and the foreground colour of the other, so it stands apart from
    // the description above it.
    if (notice) {
      const line = document.createElement('p');
      line.className = 'connector-status-what output-reason';
      line.textContent = notice.fix ? `${notice.reason} ${notice.fix}` : notice.reason;
      box.appendChild(line);
    }

    // When it is not running, the next question is how to start it. Folded
    // into a details element, because there are four routes and each person
    // needs only one.
    if (!up) box.appendChild(renderHowToStart());
    return box;
  }

  /**
   * How to start the connector, in a details element the panel opens on
   * demand.
   *
   * Four routes: the packaged connector most people download, Homebrew, the
   * npm package, and the desktop app with the connector built in. Each says
   * what you end up with, so nobody follows the wrong one and wonders why
   * there is no window.
   */
  function renderHowToStart(): HTMLElement {
    const wrap = document.createElement('details');
    wrap.className = 'connector-how';

    const summary = document.createElement('summary');
    summary.className = 'connector-how-summary';
    const icon = document.createElement('span');
    icon.className = 'connector-how-icon';
    icon.textContent = 'i';
    icon.setAttribute('aria-hidden', 'true');
    summary.append(icon, document.createTextNode('starting the connector'));
    wrap.appendChild(summary);

    // The npx route depends on gobo-connector being published under this
    // project's own npm account. An instruction to npx an unclaimed name hands
    // everyone who follows it to whoever publishes that name first.
    const mac = /Mac OS X|Macintosh/i.test(navigator.userAgent);
    const routes: Array<{ title: string; body: string; code?: string; link?: { href: string; label: string } }> = [
      {
        title: 'download',
        body:
          'Download the connector for this computer and run it once. It registers itself to start '
          + 'with your computer and keeps itself up to date. It has no window; this panel turns '
          + 'green when it is up. It is not signed, '
          + (mac
            ? 'so on a Mac make it runnable first (the command below), then open it from Finder '
              + 'with right-click, Open. If macOS still refuses, use Open Anyway in System Settings, '
              + 'Privacy & Security.'
            : 'so the first run asks you to confirm it.'),
        code: mac ? 'chmod +x ~/Downloads/gobo-connector-macos' : undefined,
        link: { href: connectorDownloadUrl(), label: `download ${connectorFileName()}` },
      },
      {
        title: 'Homebrew',
        body:
          'For an Apple Silicon Mac or x86_64 Linux. It skips the confirmation a download asks for, '
          + 'and brew services starts it with the computer.',
        code: 'brew tap nicholaspjm/gobo https://github.com/nicholaspjm/gobo-dmx-live-code\n'
          + 'brew install gobo-connector\n'
          + 'brew services start gobo-connector',
      },
      {
        title: 'Node',
        body: 'Runs the latest version without installing anything. It stops when you close the terminal.',
        code: 'npx gobo-connector@latest',
      },
      {
        title: 'desktop app',
        body:
          'This same app with the connector built in, so there is nothing to start and nothing for '
          + 'the browser to allow.',
        link: { href: RELEASES_URL, label: 'download the desktop app' },
      },
    ];

    for (const r of routes) {
      const row = document.createElement('div');
      row.className = 'connector-how-route';
      const t = document.createElement('div');
      t.className = 'connector-how-title';
      t.textContent = r.title;
      const b = document.createElement('p');
      b.className = 'connector-how-body';
      b.textContent = r.body;
      row.append(t, b);
      if (r.link) {
        const a = document.createElement('a');
        a.className = 'scene-action';
        a.href = r.link.href;
        a.target = '_blank';
        a.rel = 'noopener';
        a.textContent = r.link.label;
        row.appendChild(a);
      }
      if (r.code) {
        const pre = document.createElement('pre');
        pre.className = 'connector-how-code';
        pre.textContent = r.code;
        row.appendChild(pre);
      }
      wrap.appendChild(row);
    }

    const foot = document.createElement('p');
    foot.className = 'connector-how-body connector-how-foot';
    foot.textContent =
      'It listens on localhost:3001, so only this computer can reach it, and it answers only gobo, '
      + 'so another website open in the same browser cannot drive your rig through it. This panel '
      + 'goes green within a couple of seconds of the connector starting. If it does not, something '
      + 'else is already using that port, usually a second connector.';
    wrap.appendChild(foot);
    return wrap;
  }

  function render(): void {
    bodyEl.replaceChildren();

    const intro = document.createElement('p');
    intro.className = 'outputs-intro';
    intro.textContent = isDesktopBuild() || servedLocally() ? PANEL_INTRO_LOCAL : PANEL_INTRO;
    bodyEl.appendChild(intro);

    bodyEl.appendChild(renderConnectorStatus());

    const current = currentOutputId();
    const list = document.createElement('div');
    list.className = 'outputs-list';

    for (const info of OUTPUTS) {
      const verdict = outputVerdict(info.id);
      const row = document.createElement('div');
      row.className = 'output-row';
      if (info.id === current) row.classList.add('current');

      const head = document.createElement('div');
      head.className = 'output-row-head';

      const name = document.createElement('span');
      name.className = 'output-name';
      name.textContent = info.label;

      const badge = document.createElement('span');
      badge.className = verdict.ready ? 'output-badge ok' : 'output-badge';
      badge.textContent = verdict.badge;

      head.append(name, badge);

      if (info.id === current) {
        const tag = document.createElement('span');
        tag.className = 'output-current-tag';
        tag.textContent = 'this scene';
        head.appendChild(tag);
      }

      const plain = document.createElement('p');
      plain.className = 'output-plain';
      plain.textContent = info.plain;

      const reason = document.createElement('p');
      reason.className = verdict.warn ? 'output-reason output-warn' : 'output-reason';
      reason.textContent = verdict.reason;

      row.append(head, plain, reason);

      // The one row with an action of its own: choosing a serial port needs a
      // gesture, and this click is one.
      if (info.id === 'usb' && !isUsbConnected() && isWebSerialAvailable()) {
        const action = document.createElement('button');
        action.type = 'button';
        action.className = 'scene-action';
        action.textContent = 'choose an interface';
        action.addEventListener('click', onUsbRequest);
        row.appendChild(action);
      }

      if (info.id === 'artnet') {
        const targets = renderArtnetTargets();
        if (targets) row.appendChild(targets);
      } else if (onUseCode && info.id !== current) {
        // td() is how the page reaches TouchDesigner, so it is offered before
        // it works; usb() needs an interface chosen first, and the rest need
        // something listening.
        const code = DEFAULT_CALL[info.id];
        const offer = info.id === 'td' || verdict.ready;
        if (code && offer) row.appendChild(useButton(code));
      }

      list.appendChild(row);
    }
    bodyEl.appendChild(list);

    // ── Inputs ───────────────────────────────────────────────────────────
    // Everything above sends light out. MIDI comes in, and sits in this panel
    // because this is where people look for hardware in either direction.
    const inHead = document.createElement('h3');
    inHead.className = 'outputs-subhead';
    inHead.textContent = 'inputs';
    bodyEl.appendChild(inHead);

    const midiRow = document.createElement('div');
    midiRow.className = 'output-row';

    const midiTitle = document.createElement('div');
    midiTitle.className = 'output-row-head';
    const midiName = document.createElement('span');
    midiName.className = 'output-name';
    midiName.textContent = 'midi(cc)';
    midiTitle.appendChild(midiName);

    const midiTag = document.createElement('span');
    midiTag.className = 'output-badge';
    midiTag.textContent = !isMidiSupported()
      ? 'needs chrome or edge'
      : isMidiEnabled() ? 'listening' : 'not connected';
    if (isMidiEnabled()) midiTag.classList.add('ok');
    midiTitle.appendChild(midiTag);

    const midiPlain = document.createElement('p');
    midiPlain.className = 'output-plain';
    midiPlain.textContent =
      'Reads a fader or knob on a MIDI controller as a value from 0 to 1 that a scene can use: '
      + 'midi(74) is controller 74, read live. There is nothing to install; the browser asks for '
      + 'permission once.';

    const midiReason = document.createElement('p');
    midiReason.className = 'output-reason';
    if (!isMidiSupported()) {
      midiReason.textContent =
        'This browser has no Web MIDI, so the page cannot see a controller. Chrome and Edge '
        + 'support it; Firefox and Safari do not.';
    } else if (!isMidiEnabled()) {
      midiReason.textContent = 'Turn it on here and allow the browser prompt. midi(74) then works in a scene.';
    } else {
      const names = getMidiInputNames();
      const seen = getSeenControllers();
      const heard = seen.length === 0
        ? ' Move a fader and the controller number appears here.'
        : ' Heard so far: ' + seen.slice(0, 8).map((s) => `cc ${s.cc}${s.channel === 1 ? '' : ` ch ${s.channel}`}`).join(', ') + '.';
      midiReason.textContent = (names.length === 0
        ? 'Listening, but no controller is plugged in.'
        : `Listening to ${names.join(', ')}.`) + heard;
    }

    midiRow.append(midiTitle, midiPlain, midiReason);

    if (isMidiSupported() && !isMidiEnabled()) {
      const action = document.createElement('button');
      action.type = 'button';
      action.className = 'scene-action';
      action.textContent = 'turn on midi in';
      // The permission prompt needs a gesture, and this click is one.
      action.addEventListener('click', () => {
        void enableMidi().then(refresh).catch((err: unknown) => {
          midiReason.textContent = (err as Error).message;
        });
      });
      midiRow.appendChild(action);
    }

    bodyEl.appendChild(midiRow);

    const foot = document.createElement('div');
    foot.className = 'outputs-foot';

    const why = document.createElement('p');
    why.className = 'outputs-why';
    why.textContent = WHY_BROWSER_CANNOT;
    foot.appendChild(why);

    // No download offers inside the desktop build (the sender is in the app),
    // on a page served from this computer (npm start and npm run dev run the
    // sender alongside), or while a connector is up, where a download offer
    // under a green light suggests the running one is the wrong one.
    if (!isDesktopBuild() && !servedLocally() && !isBridgeConnected()) {
      const note = document.createElement('p');
      note.className = 'outputs-note';
      note.textContent = hasSeenConnector()
        ? 'The connector has run on this computer before. If Art-Net or sACN output is not '
          + 'arriving, it is not running right now. It normally starts when you log in.'
        : `The connector is one file, ${connectorFileName()}. Run it and leave it running; the `
          + 'page finds it automatically.';
      foot.appendChild(note);

      const actions = document.createElement('div');
      actions.className = 'outputs-actions';

      const dl = document.createElement('a');
      dl.className = 'scene-action';
      dl.href = connectorDownloadUrl();
      dl.target = '_blank';
      dl.rel = 'noopener';
      dl.textContent = 'download the connector';
      actions.appendChild(dl);

      if (DESKTOP_RELEASE) {
        const desktop = document.createElement('a');
        desktop.className = 'scene-action';
        desktop.href = DESKTOP_RELEASE.url;
        desktop.target = '_blank';
        desktop.rel = 'noopener';
        desktop.textContent = DESKTOP_RELEASE.label;
        actions.appendChild(desktop);
      }

      foot.appendChild(actions);

      const desktopLine = document.createElement('p');
      desktopLine.className = 'outputs-note';
      // Mention the desktop version only when a release exists to download.
      desktopLine.textContent = DESKTOP_RELEASE
        ? DESKTOP_PITCH
        : 'There is no desktop download yet, so Art-Net, sACN and OSC need the connector.';
      foot.appendChild(desktopLine);
    }

    bodyEl.appendChild(foot);
  }

  function refresh(): void {
    // Nothing to repaint while it is closed; opening renders from scratch.
    if (isOpen()) render();
  }

  return { refresh };
}
