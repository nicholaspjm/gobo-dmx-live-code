/**
 * Which universe leaves the USB box.
 *
 * A DMX line carries one universe, and the send sites named 0 unconditionally.
 * That is the universe `fixture()` patches into, so a scene built from fixtures
 * worked. `ch()`, `dim()` and `rgb()` write universe 1, so a scene written the
 * way the README writes them handed the interface 512 zeros — and said nothing,
 * because the on-screen level strip follows the universe the scene is really
 * driving rather than the one on the wire. Lit display, dark rig.
 *
 * These pin the selection itself. Resolving it against the active universes is
 * the UI's job and lives in main.ts.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { setUsbUniverse, getUsbUniverse } from './usb-dmx.js';

beforeEach(() => setUsbUniverse(null));

describe('usb universe selection', () => {
  it('starts unset, meaning follow whatever the scene drives', () => {
    expect(getUsbUniverse()).toBeNull();
  });

  it('remembers a universe a scene named', () => {
    setUsbUniverse(3);
    expect(getUsbUniverse()).toBe(3);
  });

  it('takes universe 0, which is not the same as not choosing', () => {
    // 0 is falsy and is also the universe fixture() patches into, so a nullish
    // check is the only one that can tell "send 0" from "decide for me".
    setUsbUniverse(0);
    expect(getUsbUniverse()).toBe(0);
    expect(getUsbUniverse()).not.toBeNull();
  });

  it('goes back to following the scene when the argument is dropped', () => {
    setUsbUniverse(2);
    setUsbUniverse(null);
    expect(getUsbUniverse()).toBeNull();
  });
});
