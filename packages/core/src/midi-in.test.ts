/**
 * A fader box driving the rig.
 *
 * No MIDI hardware in CI, so the Web MIDI API is stubbed. What these pin is
 * the part that would be wrong silently on real hardware: which controller a
 * value lands under, what an untouched controller reads as, and the refusals
 * that keep a scene from quietly reading the wrong knob.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { enableMidi, isMidiEnabled, isMidiSupported, midiCC, resetMidi, getSeenControllers } from './midi-in.js';

/** One fake input we can push messages through. */
class FakeInput {
  id = 'fake-1';
  name = 'Fake Fader Box';
  onmidimessage: ((e: { data: number[] }) => void) | null = null;
  /** status, data1, data2 — as the hardware would send them. */
  send(status: number, d1: number, d2: number): void {
    this.onmidimessage?.({ data: [status, d1, d2] });
  }
}

let input: FakeInput;

function stubMidi(): void {
  input = new FakeInput();
  (globalThis as unknown as { navigator: unknown }).navigator = {
    requestMIDIAccess: () => Promise.resolve({
      inputs: new Map([[input.id, input]]),
      onstatechange: null,
    }),
  };
}

beforeEach(() => {
  resetMidi();
  delete (globalThis as unknown as { navigator?: unknown }).navigator;
});

/** Read a pattern's value now, the way the tick does. */
function read(p: { queryArc(a: number, b: number): Array<{ value: unknown }> }): number {
  return p.queryArc(0, 0.001)[0].value as number;
}

describe('midi in', () => {
  it('says so when the browser has no Web MIDI', async () => {
    expect(isMidiSupported()).toBe(false);
    await expect(enableMidi()).rejects.toThrow(/no Web MIDI/);
  });

  it('refuses a controller before anything is connected, and says where to turn it on', () => {
    expect(() => midiCC(74)).toThrow(/MIDI is not connected yet.*outputs panel/s);
  });

  it('reads a controller as 0..1, not 0..127', async () => {
    stubMidi();
    await enableMidi();
    expect(isMidiEnabled()).toBe(true);
    input.send(0xb0, 74, 127);          // CC 74, channel 1, full
    expect(read(midiCC(74))).toBe(1);
    input.send(0xb0, 74, 0);
    expect(read(midiCC(74))).toBe(0);
  });

  it('keeps controllers on different channels apart', async () => {
    // Two controllers on one desk commonly send the same CC on different
    // channels, and silently reading the other one is maddening to debug with
    // a fader in your hand.
    stubMidi();
    await enableMidi();
    input.send(0xb0, 20, 127);          // ch 1
    input.send(0xb1, 20, 0);            // ch 2, same CC
    expect(read(midiCC(20))).toBe(1);
    expect(read(midiCC(20, { channel: 2 }))).toBe(0);
  });

  it('reads an untouched controller as its start, not as black', async () => {
    // Zero would mean a scene comes up dark and stays dark until every fader
    // has been wiggled, which is the wrong way round for something reached
    // for mid-show.
    stubMidi();
    await enableMidi();
    expect(read(midiCC(99))).toBe(0);
    expect(read(midiCC(99, { start: 1 }))).toBe(1);
  });

  it('ignores messages that are not control changes', async () => {
    stubMidi();
    await enableMidi();
    input.send(0x90, 60, 127);          // note on, not a CC
    expect(getSeenControllers()).toHaveLength(0);
  });

  it('remembers which controllers have moved, so the panel can list them', async () => {
    stubMidi();
    await enableMidi();
    input.send(0xb0, 7, 64);
    input.send(0xb2, 11, 64);
    const seen = getSeenControllers();
    expect(seen.map((s) => `${s.channel}:${s.cc}`).sort()).toEqual(['1:7', '3:11']);
  });

  it('refuses a controller number or channel outside the range', async () => {
    stubMidi();
    await enableMidi();
    expect(() => midiCC(200)).toThrow(/whole number from 0 to 127/);
    expect(() => midiCC(74, { channel: 0 })).toThrow(/from 1 to 16/);
    expect(() => midiCC(74, { start: 5 })).toThrow(/from 0 to 1/);
  });
});
