/**
 * MIDI in: a fader box driving the rig.
 *
 * The one input gobo had none of. Everything a scene could react to came from
 * the clock or from a control drawn in the editor, so the only way to ride a
 * level during a show was to reach for the trackpad and drag a slider on the
 * same screen the code is on. Every lighting desk ever built solves this with
 * a row of faders, and every cheap MIDI controller is a row of faders.
 *
 * Reads continuous controllers, and program change. A CC is a knob, a knob is
 * a level, and a level is what a channel wants. Program change is the message
 * every desk and pad controller sends for "recall number N", so it selects a
 * cue — see cues.ts — which is the one way a hardware button can change which
 * look is live.
 *
 * Notes and clock are still not handled. A note asks whether it latches and
 * for how long, and guessing at that here would be worse than leaving it out;
 * program change asks nothing, which is why it could be added and a note
 * could not.
 *
 * Values arrive 0..127 and are handed on as 0..1, because that is the domain
 * every other value in a scene is in. Nothing here needs to know what a
 * channel is.
 *
 * Requires a user gesture and a permission prompt, both browser rules rather
 * than ours, so enabling is driven from a button in the outputs panel exactly
 * as choosing a USB interface is.
 */

import type { PatternLike } from './dmx.js';
import { selectCueIndex } from './cues.js';

/** Minimal shape of the Web MIDI API, so this file builds without DOM MIDI types. */
interface MidiMessage {
  data: Uint8Array | number[];
}
interface MidiInputLike {
  id: string;
  name?: string | null;
  manufacturer?: string | null;
  onmidimessage: ((e: MidiMessage) => void) | null;
}
interface MidiAccessLike {
  inputs: Map<string, MidiInputLike> | { values(): IterableIterator<MidiInputLike> };
  onstatechange: ((e: unknown) => void) | null;
}
interface NavigatorWithMidi {
  requestMIDIAccess?: (options?: { sysex?: boolean }) => Promise<MidiAccessLike>;
}

function midiApi(): NavigatorWithMidi | null {
  const nav = globalThis.navigator as unknown as NavigatorWithMidi | undefined;
  return nav?.requestMIDIAccess ? nav : null;
}

/** Whether this browser exposes Web MIDI at all. Chrome and Edge do. */
export function isMidiSupported(): boolean {
  return midiApi() !== null;
}

let _access: MidiAccessLike | null = null;
let _enabled = false;
const _statusListeners = new Set<(enabled: boolean) => void>();

/**
 * The latest value of every controller seen, keyed "channel:cc".
 *
 * Kept per channel as well as per controller, because two controllers on one
 * desk commonly send the same CC number on different channels, and a scene
 * that asked for one and silently got the other would be maddening to debug
 * with a fader in your hand.
 */
const _values = new Map<string, number>();

/** Controllers seen since enabling, newest first, for the panel to list. */
const _seen: Array<{ channel: number; cc: number; at: number }> = [];

const key = (channel: number, cc: number): string => `${channel}:${cc}`;

export function onMidiStatusChange(fn: (enabled: boolean) => void): void {
  _statusListeners.add(fn);
}

export function isMidiEnabled(): boolean {
  return _enabled;
}

/** Every controller that has moved since MIDI was enabled, newest first. */
export function getSeenControllers(): ReadonlyArray<{ channel: number; cc: number; at: number }> {
  return _seen;
}

/** The names of the inputs currently attached, for the panel. */
export function getMidiInputNames(): string[] {
  if (!_access) return [];
  const it = (_access.inputs as { values(): IterableIterator<MidiInputLike> }).values();
  return [...it].map((i) => i.name ?? i.id);
}

function handleMessage(e: MidiMessage): void {
  const d = e.data;
  if (!d || d.length < 2) return;
  const status = d[0] & 0xf0;

  // 0xC0 is program change: one byte, meaning "recall number N". It is the
  // message every desk and every pad controller sends for exactly that, and
  // it is the one place a hardware button can pick a look — so it selects a
  // cue. Notes are still not handled: a note asks whether it latches and for
  // how long, and program change asks nothing, which is why this is the one
  // that could be added without guessing at an answer.
  if (status === 0xc0) {
    // 1-based, the way cue numbers are on the buttons it comes from.
    selectCueIndex(d[1] + 1);
    return;
  }

  if (d.length < 3) return;
  // 0xB0 is the control-change status; the low nibble is the channel.
  if (status !== 0xb0) return;
  const channel = (d[0] & 0x0f) + 1;
  const cc = d[1];
  const value = d[2] / 127;
  _values.set(key(channel, cc), value);

  // Remembered so the panel can say "move a fader and it will appear here",
  // which is how someone finds out what number their hardware sends without
  // a manual. Newest first, and one row per controller.
  const at = Date.now();
  const existing = _seen.findIndex((s) => s.channel === channel && s.cc === cc);
  if (existing !== -1) _seen[existing].at = at;
  else _seen.unshift({ channel, cc, at });
}

function attach(input: MidiInputLike): void {
  input.onmidimessage = handleMessage;
}

/**
 * Ask for MIDI access and start listening.
 *
 * Must be called from a user gesture: browsers refuse the permission prompt
 * otherwise, which is why the UI drives this from a button rather than a scene
 * doing it on the way past.
 */
export async function enableMidi(): Promise<void> {
  const nav = midiApi();
  if (!nav?.requestMIDIAccess) {
    throw new Error('This browser has no Web MIDI. Chrome and Edge have it; Firefox and Safari do not.');
  }
  // sysex is not asked for: it widens the permission prompt considerably and
  // nothing here reads a sysex message.
  const access = await nav.requestMIDIAccess({ sysex: false });
  _access = access;

  const inputs = (access.inputs as { values(): IterableIterator<MidiInputLike> }).values();
  for (const input of [...inputs]) attach(input);

  // A controller plugged in after this point still works, which matters
  // because the lead is usually found halfway through setting up.
  access.onstatechange = (): void => {
    const later = (access.inputs as { values(): IterableIterator<MidiInputLike> }).values();
    for (const input of [...later]) attach(input);
    for (const fn of _statusListeners) fn(_enabled);
  };

  _enabled = true;
  for (const fn of _statusListeners) fn(true);
}

/** Forget every value and stop listening. Used when a scene is torn down in tests. */
export function resetMidi(): void {
  _values.clear();
  _seen.length = 0;
}

/**
 * A controller, as a pattern.
 *
 * The same shape slider() returns: a value read at query time, so moving the
 * fader moves the light on the next tick rather than on the next run.
 *
 * A controller nobody has touched reads as its fallback rather than as zero.
 * Zero would mean a scene comes up black and stays black until every fader has
 * been wiggled, which is the wrong way round for something you reach for
 * mid-show.
 */
export function midiCC(cc: number, opts: { channel?: number; start?: number } = {}): PatternLike {
  if (!Number.isInteger(cc) || cc < 0 || cc > 127) {
    throw new Error(`midi(${String(cc)}): a controller number is a whole number from 0 to 127.`);
  }
  const channel = opts.channel ?? 1;
  if (!Number.isInteger(channel) || channel < 1 || channel > 16) {
    throw new Error(`midi(${cc}): channel must be a whole number from 1 to 16 (got ${String(channel)}).`);
  }
  const start = opts.start ?? 0;
  if (!Number.isFinite(start) || start < 0 || start > 1) {
    throw new Error(`midi(${cc}): start must be a number from 0 to 1 (got ${String(start)}).`);
  }
  if (!_enabled) {
    throw new Error(
      `midi(${cc}): MIDI is not connected yet. Open the outputs panel from the connection light and `
      + 'turn on midi in, then run again. The browser asks for permission once.',
    );
  }
  const k = key(channel, cc);
  return {
    queryArc() {
      return [{ value: _values.get(k) ?? start }];
    },
  };
}
