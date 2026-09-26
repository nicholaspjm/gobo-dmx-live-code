/**
 * Scenes run through the real pattern engine.
 *
 * Every other test stubs strudel, which pins what gobo does with a pattern but
 * not that the pattern is the one strudel builds. These run whole scenes the
 * way the editor does, with @strudel/core and @strudel/mini loaded, and read
 * the DMX that comes out: every bundled example, and each place strudel's
 * music vocabulary was ported to light.
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

// The bridge client reads `window` and the screen fixtures touch `document` as
// they load. Nothing here needs either to work, only to exist.
const inert: unknown = new Proxy(function () {}, {
  get: (_t, k) => (k === Symbol.toPrimitive ? () => '' : k === 'then' ? undefined : inert),
  apply: () => inert,
  construct: () => inert as object,
  set: () => true,
});
const g = globalThis as Record<string, unknown>;
g.window ??= { location: { hostname: 'localhost', protocol: 'http:', search: '', hash: '' }, addEventListener() {}, document: inert };
g.document ??= inert;

type Core = typeof import('@gobo/core');
let core: Core;

beforeAll(async () => {
  core = await import('@gobo/core');
  await core.initStrudel();
}, 30_000);

beforeEach(() => {
  core.clearDefs();
  core.setBPM(120);
});

/** Run a scene and fail the test with its error if it does not run. */
function run(code: string): void {
  const r = core.evalCode(code);
  if (!r.success) throw new Error(r.error);
}

/** Channel `ch` of universe 0 at cycle position `t`. */
function at(t: number, ch = 1): number {
  core.tick(t);
  return core.getUniverseBuffer(0)[ch - 1];
}

describe('the bundled examples', () => {
  it('every one runs clean, lights something, and no pattern fails as it plays', async () => {
    const { EXAMPLES } = await import('./examples.js');
    for (const ex of EXAMPLES) {
      core.clearDefs();
      const r = core.evalCode(ex.code);
      expect(r.success, `${ex.id}: ${r.error ?? ''}`).toBe(true);
      let lit = 0;
      for (let t = 0; t < 4; t += 0.137) {
        core.tick(t);
        for (const u of [0, 1]) lit += core.getUniverseBuffer(u).filter((v) => v > 0).length;
      }
      expect(lit, ex.id).toBeGreaterThan(0);
      expect(core.getQueryFailures(), ex.id).toEqual([]);
    }
  });
});

describe('strudel written as strudel writes it', () => {
  it('takes a signal bare or called, and they are the same', () => {
    run("const a = fixture(1, 'dim')\nconst b = fixture(2, 'dim')\na.dim(sine.slow(4))\nb.dim(sine().slow(4))");
    for (const t of [0.1, 0.9, 2.3]) expect(at(t, 1)).toBe(at(t, 2));
  });

  it('reads a quoted string as mini-notation', () => {
    run("const w = fixture(1, 'dim')\nw.dim('1 - 1 -')");
    expect([at(0.1), at(0.3), at(0.6), at(0.8)]).toEqual([255, 0, 255, 0]);
  });

  it('takes a change as a value: .every(n, fast(2))', () => {
    run("const w = fixture(1, 'dim')\nw.dim(mini('1 0').every(2, fast(2)))");
    // Bar 0 is the one every(2) changes: four steps, not two.
    expect([at(0.1), at(0.3), at(0.6), at(0.8)]).toEqual([255, 0, 255, 0]);
    expect([at(1.1), at(1.3), at(1.6), at(1.8)]).toEqual([255, 255, 0, 0]);
  });
});

describe('sound, ported to light', () => {
  it('fadeOut leaves a tail after each step, in beats', () => {
    run("const w = fixture(1, 'dim')\nw.dim(mini('1 - - -').fadeOut(1))");
    expect(at(0.1)).toBe(255);
    expect(at(0.375)).toBe(128);   // half a beat into a one-beat tail
    expect(at(0.6)).toBe(0);
  });

  it("strudel's release does the same in seconds", () => {
    run("const w = fixture(1, 'dim')\nw.dim(mini('1 - - -').release(0.5))");  // a beat at 120 BPM
    expect(at(0.375)).toBe(128);
  });

  it('settle turns every step into a flash', () => {
    run("const w = fixture(1, 'dim')\nw.dim(mini('1 1 1 1').settle(0.5))");
    expect(at(0.0)).toBe(255);
    expect(at(0.0625)).toBe(128);
    expect(at(0.2)).toBe(0);
  });

  it('across puts a step at a position along a group', () => {
    run("const a = fixture(1, 'dim')\nconst b = fixture(2, 'dim')\nconst c = fixture(3, 'dim')\ngroup(a, b, c).dim(mini('1').across(0.5))");
    core.tick(0.1);
    expect(Array.from(core.getUniverseBuffer(0).slice(0, 3))).toEqual([0, 255, 0]);
  });

  it('jux runs the pattern on the left half and the changed copy on the right', () => {
    run("const ls = [1, 2, 3, 4].map((c) => fixture(c, 'dim'))\ngroup(...ls).dim(mini('1 - - -').jux(rev))");
    core.tick(0.1);
    expect(Array.from(core.getUniverseBuffer(0).slice(0, 4))).toEqual([255, 255, 0, 0]);
    core.tick(0.8);
    expect(Array.from(core.getUniverseBuffer(0).slice(0, 4))).toEqual([0, 0, 255, 255]);
  });

  it('palette turns numbers into the colours of a palette', () => {
    run("const w = fixture(1, 'rgb')\nw.color(mini('0 1').palette([red, blue]))");
    core.tick(0.1);
    expect(Array.from(core.getUniverseBuffer(0).slice(0, 3))).toEqual([255, 0, 0]);
    core.tick(0.6);
    expect(Array.from(core.getUniverseBuffer(0).slice(0, 3))).toEqual([0, 0, 255]);
  });

  it('velocity is a level', () => {
    run("const w = fixture(1, 'dim')\nw.dim(mini('1').velocity(0.5))");
    expect(at(0.1)).toBe(128);
  });
});

describe('all() is the grand master', () => {
  it('scales the dimmer of a fixture that has one, and leaves its colour alone', () => {
    run("const w = fixture(1, 'dim-rgb')\nw.color(red)\nw.dim(1)\nall(mul(0.5))");
    core.tick(0.1);
    expect(Array.from(core.getUniverseBuffer(0).slice(0, 4))).toEqual([128, 255, 0, 0]);
  });

  it('scales the colour of a fixture without one', () => {
    run("const w = fixture(1, 'rgb')\nw.color(red)\nall(mul(0.5))");
    expect(at(0.1)).toBe(128);
  });

  it('never moves a head', () => {
    run("const h = fixture(1, 'moving-head-basic')\nh.pan(1)\nh.dim(1)\nall(mul(0))");
    core.tick(0.1);
    const buf = core.getUniverseBuffer(0);
    expect(buf[0]).toBe(255);   // pan, untouched
    expect(buf[2]).toBe(0);     // the master dimmer, mastered to nothing
  });

  it('halves a raw DMX value rather than clamping it to full', () => {
    run('ch(10, 200)\nall(mul(0.5))');
    expect(at(0.1, 10)).toBe(100);
  });

  it('takes a fader', () => {
    run("const w = fixture(1, 'dim')\nw.dim(1)\nall(mul(slider('master', 0, 1, { start: 0.25 })))");
    expect(at(0.1)).toBe(64);
  });
});

describe('sliders', () => {
  it("take strudel's form, slider(value, min, max), and are named in order", () => {
    run("const w = fixture(1, 'dim')\nw.dim(slider(0.5))");
    expect(at(0.1)).toBe(128);
    expect(core.getControls().map((c) => c.name)).toEqual(['slider 1']);
  });

  it('are patterns, so they chain and can be handed to a method', () => {
    run("const w = fixture(1, 'dim')\nconst x = fixture(2, 'dim')\nw.dim(slider('lvl', 0, 1, { start: 0.5 }).range(0.5, 1))\nx.dim(mini('1 0').fast(slider('rate', 1, 4, { start: 2 })))");
    expect(at(0.1, 1)).toBe(191);
    expect([at(0.1, 2), at(0.3, 2), at(0.6, 2), at(0.8, 2)]).toEqual([255, 0, 255, 0]);
  });
});

describe('looks and mutes', () => {
  it('a named block is a look, and cue() switches on a pattern of their names', () => {
    run("const w = fixture(1, 'dim')\nverse: {\n  w.dim(0.2)\n}\nchorus: {\n  w.dim(1)\n}\ncue(verse, chorus, mini('<verse chorus>'))");
    expect(at(0.5)).toBe(51);
    expect(at(1.5)).toBe(255);
  });

  it('an underscore mutes a line', () => {
    run("const w = fixture(1, 'dim')\nconst x = fixture(2, 'dim')\n_$: w.dim(1)\nx.dim(1)");
    expect(at(0.1, 1)).toBe(0);
    expect(at(0.1, 2)).toBe(255);
  });

  it('an error inside a look names its line on screen', () => {
    const r = core.evalCode("const w = fixture(1, 'rgb')\nverse: {\n  w.colr(blue)\n}\ncue(verse)\nverse()");
    expect(r.error).toMatch(/^line 3: /);
  });
});

describe('a level over a colour', () => {
  it('runs a chase in the colour already set, on a strip', () => {
    run("const s = rgbStrip(1, 2)\ns.color(red)\ns.each(mini('1 0'), 0)");
    core.tick(0.1);
    expect(Array.from(core.getUniverseBuffer(0).slice(0, 6))).toEqual([255, 0, 0, 255, 0, 0]);
    core.tick(0.6);
    expect(Array.from(core.getUniverseBuffer(0).slice(0, 6))).toEqual([0, 0, 0, 0, 0, 0]);
    expect(core.evalCode("const s = rgbStrip(1, 2)\ns.color(red)\ns.each(mini('1 0'), 0)").warning ?? '').not.toContain('set more than once');
  });

  it('does the same on a par with no dimmer, through a group', () => {
    run("const a = fixture(1, 'rgb')\nconst b = fixture(4, 'rgb')\nconst g = group(a, b)\ng.color(amber)\ng.each(0.5)");
    core.tick(0.1);
    expect(core.getUniverseBuffer(0)[0]).toBe(128);
    expect(core.getUniverseBuffer(0)[2]).toBeLessThan(20);   // amber stays amber, just dimmer
  });

  it('is white when no colour was set', () => {
    run("const s = rgbStrip(1, 1)\ns.each(0.5)");
    core.tick(0.1);
    expect(Array.from(core.getUniverseBuffer(0).slice(0, 3))).toEqual([128, 128, 128]);
  });
});

describe('each() with a pattern', () => {
  it('is the function form with the same phase spread', () => {
    const rig = "const a = fixture(1, 'dim')\nconst b = fixture(2, 'dim')\nconst c = fixture(3, 'dim')\nconst d = fixture(4, 'dim')\nconst rig = group(a, b, c, d)\n";
    run(`${rig}rig.each(sine.slow(2), 2)`);
    const byPattern = [0.3, 1.1].map((t) => { core.tick(t); return Array.from(core.getUniverseBuffer(0).slice(0, 4)); });
    core.clearDefs();
    run(`${rig}rig.each((p) => sine.early(p).slow(2))`);
    const byFunction = [0.3, 1.1].map((t) => { core.tick(t); return Array.from(core.getUniverseBuffer(0).slice(0, 4)); });
    expect(byPattern).toEqual(byFunction);
  });
});
