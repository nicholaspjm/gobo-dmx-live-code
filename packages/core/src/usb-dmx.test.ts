import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  buildEnttecFrame,
  isUsbDmxSupported,
  connectUsbDmx,
  disconnectUsbDmx,
  isUsbConnected,
  sendUsbDmx,
  getUsbDroppedFrames,
} from './usb-dmx.js';

/**
 * No USB DMX interface is attached to CI, so the serial API is stubbed. What
 * these tests pin is the part that would be wrong silently on real hardware:
 * the byte layout of the frame, and the behaviour when the port stalls or is
 * unplugged mid-show.
 */

class FakeWriter {
  written: Uint8Array[] = [];
  private pending: Array<() => void> = [];
  constructor(private mode: 'instant' | 'manual' | 'reject' = 'instant') {}
  write(bytes: Uint8Array): Promise<void> {
    this.written.push(bytes);
    if (this.mode === 'reject') return Promise.reject(new Error('device gone'));
    if (this.mode === 'instant') return Promise.resolve();
    return new Promise((resolve) => this.pending.push(resolve));
  }
  flush(): void {
    for (const r of this.pending) r();
    this.pending = [];
  }
  close(): Promise<void> { return Promise.resolve(); }
  releaseLock(): void { /* no lock in the fake */ }
}

function stubSerial(writer: FakeWriter, opts: { failOpen?: boolean } = {}) {
  const port = {
    open: opts.failOpen ? () => Promise.reject(new Error('busy')) : () => Promise.resolve(),
    close: () => Promise.resolve(),
    writable: { getWriter: () => writer },
  };
  (globalThis as unknown as { navigator: unknown }).navigator = {
    serial: {
      requestPort: () => Promise.resolve(port),
      getPorts: () => Promise.resolve([port]),
    },
  };
  return port;
}

beforeEach(async () => {
  await disconnectUsbDmx();
  delete (globalThis as unknown as { navigator?: unknown }).navigator;
});

describe('buildEnttecFrame', () => {
  it('wraps channel data in the Enttec Pro send-DMX message', () => {
    const frame = buildEnttecFrame(new Uint8Array([10, 20, 30]));
    expect(frame[0]).toBe(0x7e);            // start of message
    expect(frame[1]).toBe(6);               // label 6, output only send DMX
    expect(frame[2]).toBe(4);               // length low byte: 3 channels + start code
    expect(frame[3]).toBe(0);               // length high byte
    expect(frame[4]).toBe(0x00);            // DMX start code
    expect([...frame.slice(5, 8)]).toEqual([10, 20, 30]);
    expect(frame[frame.length - 1]).toBe(0xe7);
  });

  it('encodes a full 512 channel universe with the length split across two bytes', () => {
    const frame = buildEnttecFrame(new Uint8Array(512).fill(255));
    // 513 = start code + 512 channels, so low byte 1 and high byte 2.
    expect(frame[2]).toBe(513 & 0xff);
    expect(frame[3]).toBe(513 >> 8);
    expect(frame.length).toBe(512 + 1 + 5);
    expect(frame[frame.length - 1]).toBe(0xe7);
  });

  it('handles an empty universe without producing a malformed frame', () => {
    const frame = buildEnttecFrame(new Uint8Array(0));
    expect(frame[2]).toBe(1);               // just the start code
    expect(frame[0]).toBe(0x7e);
    expect(frame[frame.length - 1]).toBe(0xe7);
  });
});

describe('support detection', () => {
  it('reports unsupported when the browser has no serial API', () => {
    expect(isUsbDmxSupported()).toBe(false);
  });

  it('reports supported once the API is present', () => {
    stubSerial(new FakeWriter());
    expect(isUsbDmxSupported()).toBe(true);
  });

  it('refuses to connect with a message naming the browsers that work', async () => {
    await expect(connectUsbDmx()).rejects.toThrow(/WebSerial/);
  });
});

describe('connecting', () => {
  it('opens the chosen port and reports connected', async () => {
    stubSerial(new FakeWriter());
    await connectUsbDmx();
    expect(isUsbConnected()).toBe(true);
  });

  it('stays disconnected when the port cannot be opened', async () => {
    stubSerial(new FakeWriter(), { failOpen: true });
    await expect(connectUsbDmx()).rejects.toThrow();
    expect(isUsbConnected()).toBe(false);
  });
});

describe('sending', () => {
  it('does nothing when no interface is connected', () => {
    const writer = new FakeWriter();
    expect(() => sendUsbDmx(new Uint8Array(512))).not.toThrow();
    expect(writer.written).toHaveLength(0);
  });

  it('writes one frame per call while the port keeps up', async () => {
    const writer = new FakeWriter('instant');
    stubSerial(writer);
    await connectUsbDmx();

    sendUsbDmx(new Uint8Array([1]));
    await Promise.resolve(); await Promise.resolve();
    sendUsbDmx(new Uint8Array([2]));
    await Promise.resolve(); await Promise.resolve();

    expect(writer.written).toHaveLength(2);
  });

  it('drops frames instead of queueing them when the interface stalls', async () => {
    const writer = new FakeWriter('manual');
    stubSerial(writer);
    await connectUsbDmx();
    const before = getUsbDroppedFrames();

    sendUsbDmx(new Uint8Array([1]));   // in flight, never resolves yet
    sendUsbDmx(new Uint8Array([2]));   // dropped
    sendUsbDmx(new Uint8Array([3]));   // dropped

    expect(writer.written).toHaveLength(1);
    expect(getUsbDroppedFrames()).toBe(before + 2);

    // Once the port drains, sending resumes rather than staying wedged.
    writer.flush();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    sendUsbDmx(new Uint8Array([4]));
    await Promise.resolve();
    expect(writer.written).toHaveLength(2);
  });

  it('disconnects when the interface is unplugged mid-show', async () => {
    const writer = new FakeWriter('reject');
    stubSerial(writer);
    await connectUsbDmx();
    expect(isUsbConnected()).toBe(true);

    sendUsbDmx(new Uint8Array([1]));
    // The rejection handler starts an async disconnect that awaits two closes,
    // so a real task turn is needed rather than a handful of microtasks.
    await new Promise((r) => setTimeout(r, 0));

    expect(isUsbConnected()).toBe(false);
  });
});

describe('reconnecting after a drop', () => {
  it('sends again after an unplug left a write in flight', async () => {
    // Regression: the in-flight flag survived the disconnect, so every send on
    // the next connection took the "already writing" branch and the rig stayed
    // dark with no error anywhere.
    const stalled = new FakeWriter('manual');
    stubSerial(stalled);
    await connectUsbDmx();
    sendUsbDmx(new Uint8Array([1]));      // never settles
    await disconnectUsbDmx();             // unplugged mid-write

    const fresh = new FakeWriter('instant');
    stubSerial(fresh);
    await connectUsbDmx();
    sendUsbDmx(new Uint8Array([9]));
    await Promise.resolve(); await Promise.resolve();

    expect(fresh.written).toHaveLength(1);
  });
});
