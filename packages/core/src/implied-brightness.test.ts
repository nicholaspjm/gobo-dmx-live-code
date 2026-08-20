/**
 * A colour on a fixture with a master dimmer implies its own brightness.
 *
 * The failure being prevented: a perfect yellow picture across 48 pixels with
 * channel one at zero and nothing visible at all. Defaulting the dimmer to full
 * would have prevented it too, and would be worse, because a rig then comes up
 * hot the moment a fixture is patched, on a half-written scene. So it is
 * inferred from what the run actually drove, and only when the run said nothing
 * about the dimmer itself.
 *
 * These pin the three rules and the two things they must not break: a
 * deliberate blackout, and a fixture nobody drove.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { fixture, defineFixture, clearFixtureActivity, raiseImpliedDimmers } from './fixtures.js';
import { beginStaging, commitStaging, abortStaging, clearDefs, tick, getUniverseBuffer } from './dmx.js';

/**
 * A fixture's named setters and its nested strips are attached at run time from
 * the definition, so the static type does not carry them. Named here once
 * rather than cast at every call.
 */
type Dimmable = { dim(level: number): void; off(): void; color(r: number, g: number, b: number): void };
type Stripped = { pixels: { fill(r: number, g: number, b: number): void } };

/**
 * One run, the way evalCode() makes one: staging open, the scene, then the
 * inference, then the commit. The inference has to sit inside the transaction,
 * so it is called in the same place here.
 */
function run(scene: () => void): { raised: string[]; ch: (n: number) => number } {
  clearDefs();
  beginStaging();
  clearFixtureActivity();
  scene();
  const raised = raiseImpliedDimmers();
  commitStaging();
  tick(0);
  const buf = getUniverseBuffer(0);
  return { raised, ch: (n: number) => buf[n - 1] };
}

/**
 * A dimmer gating a strip, which is the shape of the wash that started this.
 *
 * Declared here rather than reached for from the library: the real
 * 154-channel definition is loaded at runtime in the browser and is not
 * present under this runner. Only the shape matters, a master dimmer and a
 * strip channel, and this is that shape at a size worth reading.
 */
beforeEach(() => {
  clearDefs();
  clearFixtureActivity();
  defineFixture('dim-strip', {
    name: 'Dimmer + pixel bar',
    manufacturer: 'Generic',
    type: 'rgb',
    channelCount: 13,
    channels: [
      { offset: 0, name: 'dim', type: 'intensity', description: 'Master dimmer' },
      { offset: 1, name: 'pixels', type: 'strip', pixelCount: 4, pixelLayout: 'rgb' },
    ],
  });
});

describe('implied brightness', () => {
  it('raises the dimmer when a colour was driven and the dimmer was not', () => {
    const { raised, ch } = run(() => {
      fixture(1, 'dim-rgb').color(1, 0, 0);
    });
    expect(ch(1)).toBe(255);
    expect(raised).toHaveLength(1);
  });

  it('says so, rather than changing the output silently', () => {
    // This changes what a scene puts on the wire without the scene saying so,
    // which is the kind of help that is infuriating when it guesses wrong.
    const { raised } = run(() => {
      fixture(1, 'dim-rgb').color(1, 0, 0);
    });
    expect(raised[0]).toContain('0:1');
    expect(raised[0]).toContain('Dimmer');
  });

  it('leaves a deliberate blackout exactly as written', () => {
    const { raised, ch } = run(() => {
      const w = fixture(1, 'dim-rgb') as unknown as Dimmable;
      w.color(1, 0, 0);
      w.dim(0);
    });
    expect(ch(1)).toBe(0);
    expect(raised).toEqual([]);
  });

  it('leaves a half level exactly as written', () => {
    const { ch } = run(() => {
      const w = fixture(1, 'dim-rgb') as unknown as Dimmable;
      w.color(1, 0, 0);
      w.dim(0.5);
    });
    expect(ch(1)).toBe(128);
  });

  it('does not care what order the lines are in', () => {
    // Applied once at the end of the run rather than per call, so a scene that
    // sets the dimmer before the colour is still left alone.
    const { raised, ch } = run(() => {
      const w = fixture(1, 'dim-rgb') as unknown as Dimmable;
      w.dim(0.25);
      w.color(1, 0, 0);
    });
    expect(ch(1)).toBe(64);
    expect(raised).toEqual([]);
  });

  it('leaves a fixture nobody drove dark', () => {
    // The whole reason this is inferred rather than defaulted. Patching a
    // fixture must not light it.
    const { raised, ch } = run(() => {
      fixture(1, 'dim-rgb');
    });
    expect(ch(1)).toBe(0);
    expect(raised).toEqual([]);
  });

  it('leaves off() off', () => {
    // .off() writes the dimmer like any other emitter, so the run has set it
    // and there is nothing to infer. Tracking the scene's calls instead of the
    // channels they produced would have missed this and lit the rig back up.
    const { ch } = run(() => {
      const w = fixture(1, 'dim-rgb') as unknown as Dimmable;
      w.color(1, 0, 0);
      w.off();
    });
    expect(ch(1)).toBe(0);
  });

  it('sees pixels written through a strip channel', () => {
    // Strips never go through the fixture's own channel setter, so anything
    // watching that setter would miss them. This is the case that started it:
    // a 154-channel wash whose only emitters are its pixels.
    const { raised, ch } = run(() => {
      (fixture(1, 'dim-strip') as unknown as Stripped).pixels.fill(1, 1, 0);
    });
    expect(ch(1)).toBe(255);
    expect(raised).toHaveLength(1);
  });

  it('leaves a fixture with no master dimmer alone', () => {
    const { raised } = run(() => {
      fixture(1, 'rgb').color(1, 0, 0);
    });
    expect(raised).toEqual([]);
  });

  it('rolls back with the rest of the scene when the run is abandoned', () => {
    // The raise happens while staging is open, so a scene that throws after it
    // takes the raised dimmer down with everything else.
    clearDefs();
    beginStaging();
    clearFixtureActivity();
    fixture(1, 'dim-rgb').color(1, 0, 0);
    raiseImpliedDimmers();
    abortStaging();
    tick(0);
    expect(getUniverseBuffer(0)[0]).toBe(0);
  });

  it('forgets the previous run, so a fixture that is gone implies nothing', () => {
    run(() => {
      fixture(1, 'dim-rgb').color(1, 0, 0);
    });
    const { raised, ch } = run(() => {
      // A second run that patches nothing at all.
    });
    expect(raised).toEqual([]);
    expect(ch(1)).toBe(0);
  });
});
