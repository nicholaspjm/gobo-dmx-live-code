/**
 * What each output is, and whether it can be used right now.
 *
 * This file is the only place that knows which outputs work where. The top-bar
 * connection control, the outputs panel and the connector prompt all read their
 * answers from here, so there is one table to correct when the answer changes.
 *
 * The rule underneath the whole table: a browser cannot open a UDP socket. No
 * browser offers an API for it, so Art-Net, sACN and OSC need a program on the
 * machine to put the packets on the wire. usb() and td() avoid that by using
 * APIs a page does have, WebSerial and WebSocket.
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

// ─── The table ───────────────────────────────────────────────────────────────

export type OutputId = 'usb' | 'td' | 'artnet' | 'sacn' | 'osc' | 'mock';

/** How the frames leave the page. */
export type OutputTransport = 'serial' | 'websocket' | 'udp';

/** What has to be true before the output can carry light. */
export type OutputNeed = 'hardware' | 'receiver' | 'connector';

/** 'conditional' means the code enforces a condition, not that we are hedging. */
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
  /** One paragraph for someone who has never heard of any of this. */
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
 * Data rather than markup so that a panel never offers a download no release
 * provides. It stayed null for a release after the first desktop build shipped,
 * so the panel went on saying "there is no desktop download yet" to everyone
 * while one sat on the releases page.
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
 * Someone who already installed one does not need to be sold the download
 * again. If output is not arriving, their connector is simply not running, and
 * offering the file a second time reads as though the first install failed.
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
  /** True when running a scene with this output would reach real light now. */
  ready: boolean;
  /** Short state for the badge, lowercase to match the rest of the bar. */
  badge: string;
  /** One line saying why, or what is already true. */
  reason: string;
}

/** Can this output be used right now, and why not. */
export function outputVerdict(id: OutputId): OutputVerdict {
  if (id === 'usb') {
    if (isUsbConnected()) {
      // A dropped frame means the interface could not keep up: sendUsbDmx holds
      // the newest frame and only counts one when a newer frame displaces it
      // before it reached the wire. So a number here is worth reading — it says
      // the rig is running behind what the scene is asking for — and a zero is
      // worth staying quiet about, which is the normal case.
      const dropped = getUsbDroppedFrames();
      return {
        ready: true,
        badge: 'works here',
        reason: dropped === 0
          ? 'An interface is connected, so usb() drives it on the next run.'
          : `An interface is connected, so usb() drives it on the next run. ${dropped} frame`
            + `${dropped === 1 ? '' : 's'} could not be sent in time, which means the box is not `
            + 'keeping up: the rig is running a little behind the scene. Lower the send rate in '
            + 'settings if it climbs.',
      };
    }
    if (!isWebSerialAvailable()) {
      return {
        ready: false,
        badge: 'needs chrome or edge',
        reason:
          'This browser has no WebSerial, so the page cannot open a USB interface at all. Chrome '
          + 'and Edge have it, Firefox and Safari do not.',
      };
    }
    return {
      ready: false,
      badge: 'needs a usb box',
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
      badge: 'needs touchdesigner open',
      reason:
        'Open TouchDesigner here with a WebSocket DAT listening, then run td(). Over https a page '
        + 'can only reach this machine.',
    };
  }

  // The remaining four all go through a program running on this machine: the
  // three UDP outputs because a page cannot send those packets, and mock()
  // because the printing happens inside the connector.
  if (isBridgeConnected()) {
    return {
      ready: true,
      badge: 'works here',
      reason: 'Something on this computer is listening, so these frames go out.',
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
      ? 'The connector does the printing, so it has to be running.'
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
 * The case that matters is silence. No connector released so far announces
 * itself, so a page that hears nothing is talking to one built before the
 * handshake, and that is the build that cost a rig three rounds of debugging
 * over a fix it did not have. A connector ahead of the page is not a fault and
 * gets one quiet line.
 *
 * Nothing here blocks anything. A connector behind the page carries every frame
 * it is given; it is only missing whatever has been fixed since.
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
   * pointed at it yet, which is also not a failure but is worth seeing: it is
   * a background process, and the only way to know it is alive was to choose
   * an output and find out.
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
 * use two of them together. Reading only the bridge socket meant the label said
 * "disconnected" over a rig being driven happily over USB.
 *
 * A stale connector is folded into the tooltip rather than the label. The label
 * has room for three words and this is not more urgent than the ones already in
 * it: output is going out either way. Only the facts go here, on their own line
 * so they do not run on from a sentence ending in "click for the full list".
 * What to do about it is a paragraph, and belongs in the panel that click opens.
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
  // Named for the call a scene writes, not for the mechanism underneath. The
  // top bar said 'direct' and 'bridge' — the first a word no panel or document
  // shows the reader, the second a third name for the program this file calls
  // the connector a few lines above and the docs, the package and the download
  // all call the connector too. One program, three names, and the one on the
  // most-read control in the app matched none of the others.
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
  + 'on the network by itself. That is a rule every browser enforces, not something gobo can '
  + 'switch off.';

export const PANEL_INTRO =
  'Where your light goes. usb() and td() work in this browser. The rest send network packets, '
  + 'which a page cannot do, so something has to run on this computer: the connector beside this '
  + 'page, or gobo itself run locally, which needs nothing else.';

export const DESKTOP_PITCH =
  'The desktop version has the connector inside it. Art-Net, sACN, OSC and the dry run work '
  + 'the moment it opens.';

/** Message for a scene whose output the page cannot carry on its own. */
export function blockedOutputMessage(output: string): string {
  return `${output} sends network packets, which a page cannot do. Run the connector, then press `
    + 'ctrl+enter again. For a USB DMX box instead, open the outputs panel and pick usb.';
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
}): OutputsPanel {
  const { bodyEl, isOpen, onUsbRequest } = opts;

  // Drawn from scratch each time it comes into view: every badge on it is a
  // live verdict about hardware, and a stale one is the whole failure this
  // page exists to prevent.
  bodyEl.addEventListener(PANEL_OPEN_EVENT, () => render());

  /**
   * Whether the connector is running, said out loud.
   *
   * It is a background process that installs itself as a login item, so months
   * can pass between setting it up and wondering about it. Nothing on screen
   * answered "is it running, and what is it" except by choosing an output and
   * seeing whether light came out.
   */
  function renderConnectorStatus(): HTMLElement {
    const box = document.createElement('div');
    const up = isBridgeConnected();
    // Blocked is not the same answer as not running, and the fix is not the
    // same either: see browser-access.ts.
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

    // Deliberately the plain badge and not the sage one: being out of date is
    // not a state to congratulate, and it is not a failure either.
    if (notice) {
      const flag = document.createElement('span');
      flag.className = 'output-badge';
      flag.textContent = notice.badge;
      head.appendChild(flag);
    }

    const where = document.createElement('span');
    where.className = 'connector-status-where';
    // The version reads as part of the address, since both answer "which one am
    // I talking to". Left off when none was sent, which the line below explains
    // rather than leaving as a blank to puzzle over.
    const version = up ? getConnectorInfo()?.version : null;
    where.textContent = up ? (version ? `${version} · localhost:3001` : 'localhost:3001') : '';
    head.appendChild(where);

    const what = document.createElement('p');
    what.className = 'connector-status-what';
    what.textContent = up
      ? 'Listening for frames and putting Art-Net, sACN or OSC on the network. It starts with '
        + 'your computer, which is why you may not remember running it.'
      : blocked ? BLOCKED_BY_BROWSER
      : 'Art-Net, sACN and OSC need it. usb() and td() work without it.';
    box.append(head, what);

    // Printed, not folded away: a connector missing fixes is the answer to a
    // question nobody knew to ask, and someone who has to open something to
    // find it never will. Two classes, for the spacing of one and the
    // foreground colour of the other, so it reads as the answer rather than as
    // more of the blurb above it.
    if (notice) {
      const line = document.createElement('p');
      line.className = 'connector-status-what output-reason';
      line.textContent = notice.fix ? `${notice.reason} ${notice.fix}` : notice.reason;
      box.appendChild(line);
    }

    // When it is not running, the next question is always "so how do I start
    // it", and the answer was nowhere on screen. Folded away rather than
    // printed, because it is three routes and only one of them is yours.
    if (!up) box.appendChild(renderHowToStart());
    return box;
  }

  /**
   * How to start the connector, in a details element the panel opens on
   * demand.
   *
   * Three routes, because there genuinely are three: the packaged connector
   * most people download, the npm package, and running it from a clone. Each
   * says what you end up with, so nobody follows the wrong one and wonders why
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
    summary.append(icon, document.createTextNode('how do I start it?'));
    wrap.appendChild(summary);

    // npx only since the package was published under this project's own
    // account. Before that, an instruction to npx the name would have handed it,
    // and everyone who followed the instruction, to whoever published it first.
    const routes: Array<{ title: string; body: string; code?: string }> = [
      {
        title: 'or skip it: run gobo locally',
        body:
          'The simplest setup. The desktop app, or npm start in a copy of the repository, serves '
          + 'this same app and does the sending from one process, so there is no connector to '
          + 'start and nothing for the browser to allow.',
        code: 'npm start',
      },
      {
        title: 'the download',
        body:
          'Download the connector for this computer and run it once. It registers itself to start '
          + 'with your computer, keeps itself up to date, and otherwise stays out of the way: there '
          + 'is no window, and this panel turning green is how you know it is up. It is not signed, '
          + 'so the first run asks you to confirm it; the README says where.',
      },
      {
        title: 'with Homebrew',
        body:
          'On an Apple Silicon Mac or x86_64 Linux. It skips the confirmation a download asks for, '
          + 'and brew services starts it with the computer.',
        code: 'brew tap nicholaspjm/gobo https://github.com/nicholaspjm/gobo-dmx-live-code\n'
          + 'brew install gobo-connector\n'
          + 'brew services start gobo-connector',
      },
      {
        title: 'with Node',
        body: 'Runs the latest one without installing anything, until you close the terminal.',
        code: 'npx gobo-connector@latest',
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
      'It listens on localhost:3001, so only this computer can reach it, and it only answers gobo '
      + 'itself: another website open in the same browser cannot drive your rig through it. '
      + 'Whichever route you take, this panel goes green within a couple of seconds of it starting. '
      + 'If it does not, something else is already on that port, usually a second connector.';
    wrap.appendChild(foot);
    return wrap;
  }

  function render(): void {
    bodyEl.replaceChildren();

    const intro = document.createElement('p');
    intro.className = 'outputs-intro';
    intro.textContent = PANEL_INTRO;
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
      reason.className = 'output-reason';
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

      list.appendChild(row);
    }
    bodyEl.appendChild(list);

    // ── Inputs ───────────────────────────────────────────────────────────
    // Everything above is where light goes. This is the one place something
    // comes back, and it belongs here because this panel is where a person
    // looks for hardware, whichever direction it points.
    const inHead = document.createElement('h3');
    inHead.className = 'outputs-subhead';
    inHead.textContent = 'inputs';
    bodyEl.appendChild(inHead);

    const midiRow = document.createElement('div');
    midiRow.className = 'output-row';

    const midiTitle = document.createElement('div');
    midiTitle.className = 'output-head';
    const midiName = document.createElement('span');
    midiName.className = 'output-label';
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
      'A fader or knob on a MIDI controller, as a value a scene can use: midi(74) is controller 74, '
      + '0 to 1, read live. Nothing to install, and the browser asks for permission once.';

    const midiReason = document.createElement('p');
    midiReason.className = 'output-reason';
    if (!isMidiSupported()) {
      midiReason.textContent =
        'This browser has no Web MIDI, so the page cannot see a controller at all. Chrome and Edge '
        + 'have it, Firefox and Safari do not.';
    } else if (!isMidiEnabled()) {
      midiReason.textContent = 'Turn it on here and the browser will ask once. Then midi(74) works in a scene.';
    } else {
      const names = getMidiInputNames();
      const seen = getSeenControllers();
      const heard = seen.length === 0
        ? ' Move a fader and the controller number appears here.'
        : ' Heard so far: ' + seen.slice(0, 8).map((s) => `cc ${s.cc}${s.channel === 1 ? '' : ` ch ${s.channel}`}`).join(', ') + '.';
      midiReason.textContent = (names.length === 0
        ? 'Listening, but nothing is plugged in.'
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

    // Inside the desktop build the sender is already in the app, and a page
    // served from this computer came from npm start or npm run dev, which run
    // it alongside. Either way every download here would be an offer of
    // something the user is already running.
    if (!isDesktopBuild() && !servedLocally()) {
      const note = document.createElement('p');
      note.className = 'outputs-note';
      note.textContent = hasSeenConnector()
        ? 'The connector has run on this computer before. If Art-Net or sACN is going nowhere, it '
          + 'is not running just now. It normally starts itself when you log in.'
        : `The connector is one file, ${connectorFileName()}. Run it and leave it running; the `
          + 'page finds it by itself.';
      foot.appendChild(note);

      const actions = document.createElement('div');
      actions.className = 'outputs-actions';

      const dl = document.createElement('a');
      dl.className = 'scene-action';
      dl.href = RELEASES_URL;
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
      // Only claim the desktop version once there is one to download. Saying
      // "it all works in the desktop app" while no release exists would be a
      // promise nothing here can keep.
      desktopLine.textContent = DESKTOP_RELEASE
        ? DESKTOP_PITCH
        : 'There is no desktop download yet, so the connector is how these three work today.';
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
