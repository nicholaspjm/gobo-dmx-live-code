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
  getDirectUrl,
  getOutputConfig,
  isConnected,
  isDirectConnected,
  isUsbConnected,
  isUsbDmxSupported,
} from '@gobo/core';

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
      'Drives a DMX line straight out of a USB DMX box plugged into this computer, the Enttec DMX '
      + 'USB Pro type. Nothing to install: choose usb below, pick the box, and the page '
      + 'talks to it. Needs Chrome or Edge, and one universe only.',
  },
  {
    id: 'td',
    label: 'td()',
    transport: 'websocket',
    browser: 'conditional',
    desktop: 'yes',
    needs: 'receiver',
    plain:
      'Hands every frame to TouchDesigner, and TouchDesigner puts Art-Net on the network for you. '
      + 'Nothing to install, as long as TouchDesigner is already open on this same computer with a '
      + 'WebSocket DAT listening.',
  },
  {
    id: 'artnet',
    label: 'artnet()',
    transport: 'udp',
    browser: 'no',
    desktop: 'yes',
    needs: 'connector',
    plain:
      'Sends Art-Net to your nodes over the network. A web page is not allowed to put that kind of '
      + 'packet on the network, so a small program on this computer has to do it.',
  },
  {
    id: 'sacn',
    label: 'sacn()',
    transport: 'udp',
    browser: 'no',
    desktop: 'yes',
    needs: 'connector',
    plain:
      'Sends sACN (E1.31) multicast to your rig. Same network packets as Art-Net, and the same '
      + 'rule: the page cannot send them, so a program on this computer has to.',
  },
  {
    id: 'osc',
    label: 'osc()',
    transport: 'udp',
    browser: 'no',
    desktop: 'yes',
    needs: 'connector',
    plain:
      'Sends one OSC message per live channel to a receiver such as TouchDesigner\'s OSC In. OSC '
      + 'travels as the same kind of network packet as Art-Net, so this needs the connector too. It '
      + 'is not a no-install option.',
  },
  {
    id: 'mock',
    label: 'mock()',
    transport: 'websocket',
    browser: 'no',
    desktop: 'yes',
    needs: 'connector',
    plain:
      'A dry run. No fixture is driven; the connector just prints which channels are live, about '
      + 'twice a second, so you can check a scene with the rig off. The printing happens inside the '
      + 'connector, so this needs it running.',
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
 * Data rather than markup because this repository ships no desktop binary yet.
 * A panel offering a download that no release provides would be a lie, so the
 * desktop row appears only once this is filled in.
 */
export interface DesktopRelease {
  label: string;
  url: string;
}

export const DESKTOP_RELEASE: DesktopRelease | null = null;

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
      return {
        ready: true,
        badge: 'works here',
        reason: 'An interface is connected, so usb() drives it on the next run.',
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
      reason: 'Choose usb here and pick the interface. Nothing to install.',
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
        'Open TouchDesigner on this computer with a WebSocket DAT listening, then run td(). A page '
        + 'served over https can only reach a receiver on this same machine.',
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
      : 'Nothing is listening on this computer yet. Run the connector, then press ctrl+enter again.',
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
 */
export function connectionSummary(): ConnectionSummary {
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
  if (direct && isDirectConnected()) live.push('direct');
  if (config && isBridgeConnected()) live.push('bridge');

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
  'Where your light goes. Two of these work in this browser as it stands: a USB DMX box plugged '
  + 'into this computer, or handing frames to TouchDesigner and letting it send. The rest go out '
  + 'as network packets, which needs a small program running here.';

export const DESKTOP_PITCH =
  'The desktop version is the same gobo with the sending program already inside it. Art-Net, '
  + 'sACN, OSC and the dry-run mode work the moment it opens, with nothing to start by hand. Same '
  + 'editor, same scenes, same files.';

/** Message for a scene whose output the page cannot carry on its own. */
export function blockedOutputMessage(output: string): string {
  return `${output} sends network packets, which this page cannot do on its own. Run the `
    + 'connector, then press ctrl+enter again. Using a USB DMX box instead? Click usb in the top '
    + 'bar, nothing to install.';
}

// ─── Panel ───────────────────────────────────────────────────────────────────

export interface OutputsPanel {
  setOpen: (open: boolean) => void;
  isOpen: () => boolean;
  /** Repaint the badges. Cheap, and called whenever a connection changes. */
  refresh: () => void;
}

/**
 * Mount the outputs panel. Mirrors the docs / library / settings panels: the
 * host owns mutual exclusion via `onOpen`, this owns its own contents.
 *
 * `onUsbRequest` is the same handler as the top-bar usb button. A click inside
 * the panel is still a user gesture, which is what requestPort() requires.
 */
export function mountOutputsPanel(opts: {
  panelEl: HTMLElement;
  bodyEl: HTMLElement;
  toggleEl: HTMLElement;
  closeEl: HTMLButtonElement;
  onUsbRequest: () => void;
  onOpen?: () => void;
}): OutputsPanel {
  const { panelEl, bodyEl, toggleEl, closeEl, onUsbRequest, onOpen } = opts;

  function isOpen(): boolean {
    return panelEl.classList.contains('open');
  }

  function setOpen(open: boolean): void {
    panelEl.classList.toggle('open', open);
    panelEl.setAttribute('aria-hidden', open ? 'false' : 'true');
    toggleEl.classList.toggle('active', open);
    toggleEl.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) {
      render();
      onOpen?.();
    }
  }

  toggleEl.addEventListener('click', () => setOpen(!isOpen()));
  closeEl.addEventListener('click', () => setOpen(false));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen()) setOpen(false);
  });

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
    box.className = up ? 'connector-status up' : 'connector-status';

    const head = document.createElement('div');
    head.className = 'connector-status-head';
    const dot = document.createElement('span');
    dot.className = 'connector-status-dot';
    const name = document.createElement('span');
    name.className = 'connector-status-name';
    name.textContent = up ? 'connector running' : 'connector not running';
    head.append(dot, name);

    const where = document.createElement('span');
    where.className = 'connector-status-where';
    where.textContent = up ? 'localhost:3001' : '';
    head.appendChild(where);

    const what = document.createElement('p');
    what.className = 'connector-status-what';
    what.textContent = up
      ? 'A small program on this computer, listening for frames from this page and putting '
        + 'Art-Net, sACN or OSC on the network. It starts with your computer and stays out of '
        + 'the way, which is why you may not remember running it. Nothing reaches your rig '
        + 'until a scene picks one of those outputs.'
      : 'Art-Net, sACN and OSC need a small program running on this computer, because a web '
        + 'page cannot put those packets on the network itself. Without it, usb() and td() '
        + 'still work from the browser alone.';
    box.append(head, what);
    return box;
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

    const foot = document.createElement('div');
    foot.className = 'outputs-foot';

    const why = document.createElement('p');
    why.className = 'outputs-why';
    why.textContent = WHY_BROWSER_CANNOT;
    foot.appendChild(why);

    // Inside the desktop build the sender is already in the app, so every
    // download prompt would be an offer of something the user is running.
    if (!isDesktopBuild()) {
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

  return { setOpen, isOpen, refresh };
}
