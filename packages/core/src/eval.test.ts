/**
 * Unit tests for the eval sandbox.
 *
 * dmx.test.ts already pins the channel-def half of the transaction. What is
 * tested here is everything else a scene can reach: the bridge output config,
 * the tempo, the display registries, and the gate that refuses to run at all
 * while the pattern engine is not usable. Each of those was a way for a scene
 * that never finished to change what the rig does anyway.
 *
 * Every test loads its own copy of the module graph (loadHarness) because
 * eval.ts, dmx.ts and scheduler.ts all hold module-level state and the pattern
 * engine is a one-way state machine: 'loading' cannot be re-entered once a
 * load has finished. A fresh graph per test is cheaper than rewinding one, and
 * no test can depend on the order it runs in.
 *
 * The bridge is stubbed at websocket.ts, the one seam eval.ts uses to reach
 * the wire; the pattern engine is stubbed at @strudel/core behind a gate the
 * test opens by hand, so the "still loading" window is deterministic instead
 * of a race with a real dynamic import.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';

// websocket.ts reads `window.location.hostname` at module-load time. It is
// stubbed below, but fixtures/dmx are pulled in for real, so give the headless
// runner the one property the graph might reach for.
const g = globalThis as { window?: { location: { hostname: string } } };
if (g.window === undefined) g.window = { location: { hostname: 'localhost' } };

type BridgeConfig = Record<string, unknown>;

/**
 * Minimal stand-in for a Strudel pattern. A class, not an object literal:
 * initStrudel() patches .flash()/.glow()/.wave() onto the prototype of a
 * sample pattern, and a literal would hand it Object.prototype.
 */
class FakePattern {
  queryArc(): Array<{ value: unknown }> {
    return [{ value: 0.5 }];
  }
}

function fakeStrudelCore(): Record<string, unknown> {
  const factory = (): FakePattern => new FakePattern();
  return {
    sine: factory,
    cosine: factory,
    square: factory,
    saw: factory,
    rand: factory,
    sequence: factory,
    cat: factory,
    stack: factory,
  };
}

interface HarnessOptions {
  /** 'reject' makes the @strudel/core import throw once the gate opens. */
  strudel?: 'resolve' | 'reject';
  /**
   * Install a switchable clearSimFixtures() that throws, to exercise the
   * finally. The value is the starting position of the switch; flip it later
   * with setSimClearBroken() when a test needs a working eval first. Omit to
   * leave fixtures.ts alone entirely.
   */
  breakSimClear?: boolean;
}

interface Harness {
  evalCode(code: string): { success: boolean; error?: string };
  initStrudel(): Promise<void>;
  isStrudelReady(): boolean;
  getStrudelError(): string | null;
  uni(universe: number, channel: number, value: number): void;
  tick(cyclePos: number): void;
  getUniverseBuffer(universe: number): Uint8Array;
  getBPM(): number;
  getSimFixtures(): readonly unknown[];
  /** Configs the sandbox managed to push to the bridge, oldest first. */
  sends: BridgeConfig[];
  /** Runs inside the stubbed sendConfig, to observe commit ordering. */
  setSendHook(fn: (() => void) | null): void;
  /** Flip the switchable clearSimFixtures() (needs `breakSimClear` set). */
  setSimClearBroken(on: boolean): void;
  /** Lets the stubbed @strudel/core import settle. */
  release(): void;
}

async function loadHarness(opts: HarnessOptions = {}): Promise<Harness> {
  vi.resetModules();

  // The load logs on both the success and failure paths; a dozen harnesses
  // per run would bury a real failure in it.
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});

  const sends: BridgeConfig[] = [];
  let sendHook: (() => void) | null = null;
  vi.doMock('./websocket.js', () => ({
    sendConfig: (config: BridgeConfig): void => {
      sends.push(config);
      sendHook?.();
    },
    sendUniverseState: (): void => {},
    connectBridge: (): void => {},
    isConnected: (): boolean => false,
    onStatusChange: (): void => {},
  }));

  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  vi.doMock('@strudel/core', async () => {
    await gate;
    if (opts.strudel === 'reject') throw new Error('module not found');
    return fakeStrudelCore();
  });
  vi.doMock('@strudel/mini', async () => {
    await gate;
    const mini = (): FakePattern => new FakePattern();
    return { mini, m: mini };
  });

  let simClearBroken = opts.breakSimClear === true;
  if (opts.breakSimClear !== undefined) {
    vi.doMock('./fixtures.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('./fixtures.js')>();
      return {
        ...actual,
        clearSimFixtures: (): void => {
          if (!simClearBroken) {
            actual.clearSimFixtures();
            return;
          }
          throw new Error('registry clear exploded');
        },
      };
    });
  }

  const evalMod = await import('./eval.js');
  const dmxMod = await import('./dmx.js');
  const schedulerMod = await import('./scheduler.js');
  const fixturesMod = await import('./fixtures.js');

  return {
    evalCode: evalMod.evalCode,
    initStrudel: evalMod.initStrudel,
    isStrudelReady: evalMod.isStrudelReady,
    getStrudelError: evalMod.getStrudelError,
    uni: dmxMod.uni,
    tick: dmxMod.tick,
    getUniverseBuffer: dmxMod.getUniverseBuffer,
    getBPM: schedulerMod.getBPM,
    getSimFixtures: fixturesMod.getSimFixtures,
    sends,
    setSendHook: (fn) => {
      sendHook = fn;
    },
    setSimClearBroken: (on) => {
      simClearBroken = on;
    },
    release,
  };
}

/** A harness with the pattern engine fully loaded: the normal show state. */
async function readyHarness(opts: HarnessOptions = {}): Promise<Harness> {
  const h = await loadHarness(opts);
  const loading = h.initStrudel();
  h.release();
  await loading;
  return h;
}

/**
 * Probe for a stranded staging map.
 *
 * dmx.ts does not expose `_staging`, but its whole effect is observable: while
 * it is set, uni() writes land in the scratch map instead of the live scene,
 * so a tick never sees them. Write a channel from outside any eval and check
 * it reaches the buffer.
 */
function stagingIsClosed(h: Harness): boolean {
  h.uni(1, 512, 1);
  h.tick(0);
  return h.getUniverseBuffer(1)[511] === 255;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.doUnmock('./websocket.js');
  vi.doUnmock('./fixtures.js');
  vi.doUnmock('@strudel/core');
  vi.doUnmock('@strudel/mini');
});

// ─── bridge config ────────────────────────────────────────────────────────────
// artnet() / sacn() / osc() / mock() used to send the moment they were called.
// A scene whose first line switched the bridge and whose last line threw had
// its channel defs rolled back and left the bridge pointed somewhere else, so
// the previous scene kept running into a void.

describe('bridge config is part of the transaction', () => {
  it('does not reach the bridge when the scene later throws', async () => {
    const h = await readyHarness();

    const result = h.evalCode('mock(); uni(1, 1, 1); boom()');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/boom/);
    expect(h.sends).toEqual([]);
  });

  it('does not reach the bridge when the scene will not even parse', async () => {
    const h = await readyHarness();

    expect(h.evalCode("artnet('10.0.0.5'); uni(1, 1,").success).toBe(false);
    expect(h.sends).toEqual([]);
  });

  it('reaches the bridge when the scene completes', async () => {
    const h = await readyHarness();

    expect(h.evalCode("artnet('10.0.0.5', 6455); uni(1, 1, 1)").success).toBe(true);
    expect(h.sends).toEqual([{ mode: 'artnet', artnet: { host: '10.0.0.5', port: 6455 } }]);
  });

  it('keeps each helper signature and its defaults', async () => {
    // Scene code written against 0.2.0 calls these with zero to two arguments
    // and relies on the documented defaults, so the buffering wrappers have to
    // produce byte-identical payloads to the immediate versions they replaced.
    const h = await readyHarness();

    expect(h.evalCode('artnet()').success).toBe(true);
    expect(h.evalCode('sacn()').success).toBe(true);
    expect(h.evalCode('osc()').success).toBe(true);
    expect(h.evalCode('mock()').success).toBe(true);
    expect(h.evalCode("sacn(3, 200); osc('10.0.0.9', 9001)").success).toBe(true);

    expect(h.sends).toEqual([
      { mode: 'artnet', artnet: { host: '127.0.0.1', port: 6454 } },
      { mode: 'sacn', sacn: { universe: 1, priority: 100 } },
      { mode: 'osc', osc: { host: '127.0.0.1', port: 9000 } },
      { mode: 'mock' },
      { mode: 'osc', osc: { host: '10.0.0.9', port: 9001 } },
    ]);
  });

  it('sends only the last config when a scene calls several', async () => {
    const h = await readyHarness();

    expect(h.evalCode("mock(); osc('10.0.0.9', 9001); artnet('10.0.0.5')").success).toBe(true);

    // Same end state as four immediate sends, without the intermediate hops.
    expect(h.sends).toEqual([{ mode: 'artnet', artnet: { host: '10.0.0.5', port: 6454 } }]);
  });

  it('sends the config only after the new scene is live', async () => {
    // Ordering matters at the bridge: it must never be told to output
    // somewhere new while the channel defs behind that output are still the
    // previous scene's.
    const h = await readyHarness();
    expect(h.evalCode('uni(1, 1, 1)').success).toBe(true);

    let channelAtSendTime = -1;
    h.setSendHook(() => {
      h.tick(0);
      channelAtSendTime = h.getUniverseBuffer(1)[1];
    });

    expect(h.evalCode('uni(1, 2, 1); mock()').success).toBe(true);

    // Channel 2 belongs to the new scene, and it was already resolving by the
    // time the config went out.
    expect(channelAtSendTime).toBe(255);
  });
});

// ─── tempo ────────────────────────────────────────────────────────────────────

describe('setBPM is part of the transaction', () => {
  it('does not change tempo when the scene later throws', async () => {
    const h = await readyHarness();

    expect(h.evalCode('setBPM(150); uni(1, 1, 1); boom()').success).toBe(false);

    // The scene that asked for 150 was discarded; the one still on the rig
    // must not be running at its tempo.
    expect(h.getBPM()).toBe(120);
  });

  it('changes tempo when the scene completes', async () => {
    const h = await readyHarness();

    expect(h.evalCode('setBPM(150)').success).toBe(true);
    expect(h.getBPM()).toBe(150);
  });

  it('applies the last tempo when a scene calls setBPM several times', async () => {
    const h = await readyHarness();

    expect(h.evalCode('setBPM(90); setBPM(140)').success).toBe(true);
    expect(h.getBPM()).toBe(140);
  });

  it('keeps clamping and still rejects garbage', async () => {
    const h = await readyHarness();

    expect(h.evalCode('setBPM(9000)').success).toBe(true);
    expect(h.getBPM()).toBe(400);

    expect(h.evalCode("setBPM(parseInt('fast'))").success).toBe(true);
    expect(h.getBPM()).toBe(400);
  });

  it('does not let a garbage call discard a good one earlier in the scene', async () => {
    // Immediate setBPM() ignores non-finite input, so setBPM(130) followed by
    // a typo used to leave 130 running. "Last call wins" must not turn the
    // typo into the winner.
    const h = await readyHarness();

    expect(h.evalCode("setBPM(130); setBPM(parseInt('fast'))").success).toBe(true);
    expect(h.getBPM()).toBe(130);
  });
});

// ─── calls that escape the eval that bound them ───────────────────────────────
// register() writes its body onto the shared Pattern prototype, which outlives
// the eval that defined it on purpose. The body closes over that eval's
// artnet()/setBPM() bindings, so a call it makes later used to be judged
// against a transaction that had already settled and went straight out, while
// the scene that made the call rolled back. That left the rig on the previous
// scene's defs at the new scene's tempo, pointed at a new host.
//
// FakePattern.prototype is shared by every harness in this file (the class is
// declared once, above), which is the cross-eval prototype the bug lives on, so
// each test below registers under its own method name.

describe('an output call belongs to the eval in flight, not the one that bound it', () => {
  it('rolls back a register() body\'s config and tempo when the invoking scene throws', async () => {
    const h = await readyHarness();

    // Scene A binds the name only. The body has not run, so nothing it would
    // do has happened yet.
    const sceneA = h.evalCode(
      "register('boom', (p) => { setBPM(200); artnet('10.9.9.9'); return p })",
    );

    expect(sceneA.success).toBe(true);
    expect(h.getBPM()).toBe(120);
    expect(h.sends).toEqual([]);

    // A live scene for the failed one to fall back to.
    expect(h.evalCode('uni(1, 5, 1)').success).toBe(true);

    // Scene B invokes the body through scene A's captured bindings, then dies
    // on the next statement.
    const sceneB = h.evalCode('ch(1, sine().boom()); nope()');

    expect(sceneB.success).toBe(false);
    expect(sceneB.error).toMatch(/nope/);

    // The whole of scene B is gone, including the calls its chain method made
    // on the way through.
    expect(h.getBPM()).toBe(120);
    expect(h.sends).toEqual([]);

    // And the rig is still running scene A's defs, not the previous scene's
    // defs at the failed scene's tempo.
    h.tick(0);
    const buf = h.getUniverseBuffer(1);
    expect(buf[4]).toBe(255);
    expect(buf[0]).toBe(0);
  });

  it("applies a register() body's calls with the scene that invoked it", async () => {
    const h = await readyHarness();

    expect(
      h.evalCode("register('boomOk', (p) => { setBPM(200); artnet('10.9.9.9'); return p })").success,
    ).toBe(true);
    expect(h.evalCode('ch(1, sine().boomOk())').success).toBe(true);

    // Buffered, not blocked: a clean run still applies everything it asked for.
    expect(h.getBPM()).toBe(200);
    expect(h.sends).toEqual([{ mode: 'artnet', artnet: { host: '10.9.9.9', port: 6454 } }]);
  });

  it('sends an escaped config only after the invoking scene is live', async () => {
    // Joining the transaction has to mean joining its ordering too: the bridge
    // must not be redirected while the defs behind it are still the previous
    // scene's.
    const h = await readyHarness();

    expect(h.evalCode("register('boomOrder', (p) => { artnet('10.9.9.9'); return p })").success).toBe(true);
    expect(h.evalCode('uni(1, 1, 1)').success).toBe(true);

    let channelAtSendTime = -1;
    h.setSendHook(() => {
      h.tick(0);
      channelAtSendTime = h.getUniverseBuffer(1)[1];
    });

    expect(h.evalCode('uni(1, 2, sine().boomOrder())').success).toBe(true);

    // Channel 2 is the new scene's, and it was already resolving when the
    // config went out.
    expect(channelAtSendTime).toBe(128);
  });

  it('applies immediately when the body runs at query time with no eval in flight', async () => {
    const h = await readyHarness();

    expect(
      h.evalCode("register('boomLazy', (p) => { setBPM(200); artnet('10.9.9.9'); return p })").success,
    ).toBe(true);

    // The chain method is not called while the scene runs. It is called from
    // inside queryArc, so it fires when a frame asks for a value and not
    // before.
    expect(h.evalCode('ch(1, { queryArc: (b, e) => sine().boomLazy().queryArc(b, e) })').success).toBe(true);
    expect(h.getBPM()).toBe(120);
    expect(h.sends).toEqual([]);

    // The tick is where the body finally runs. There is no run in flight for
    // it to be committed or rolled back with, so it applies straight away.
    // That is the documented choice, and what these calls did before any
    // buffering existed.
    h.tick(0);

    expect(h.getBPM()).toBe(200);
    expect(h.sends).toEqual([{ mode: 'artnet', artnet: { host: '10.9.9.9', port: 6454 } }]);
    expect(h.getUniverseBuffer(1)[0]).toBe(128);
  });

  it('releases the active buffer when a run dies inside the registry clears', async () => {
    // A stranded active buffer is the worst failure this design has: every
    // later artnet()/setBPM(), from any caller, would be recorded into a
    // transaction nothing will ever flush and vanish. The clears run with the
    // buffer already claimed, and one of them throwing is a real way out.
    const h = await readyHarness({ breakSimClear: false });

    expect(h.evalCode("register('boomStrand', (p) => { setBPM(200); return p })").success).toBe(true);
    expect(h.evalCode('ch(1, { queryArc: (b, e) => sine().boomStrand().queryArc(b, e) })').success).toBe(true);

    h.setSimClearBroken(true);
    const result = h.evalCode('uni(1, 9, 1)');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/registry clear exploded/);
    h.setSimClearBroken(false);

    // No eval is in flight now, so the body's setBPM() must reach the
    // scheduler. If the failed run had left its buffer claimed, this would
    // disappear into it instead.
    h.tick(0);
    expect(h.getBPM()).toBe(200);
  });
});

// ─── pattern engine gate ──────────────────────────────────────────────────────

describe('pattern engine gate', () => {
  it('refuses while the engine is still loading', async () => {
    const h = await loadHarness();
    const loading = h.initStrudel();

    // The window that used to be open: the load has started, so the previous
    // error (if any) is already cleared, but nothing is ready yet.
    expect(h.isStrudelReady()).toBe(false);
    expect(h.getStrudelError()).toBeNull();

    const result = h.evalCode('ch(1, sine())');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/loading/);
    // The refusal has to say what is wrong. Running with an empty context
    // reported "sine is not defined", which reads as a typo in the scene.
    expect(result.error).not.toMatch(/is not defined/);

    // And a refused run is a no-op, not a half-run.
    h.tick(0);
    expect(h.getUniverseBuffer(1)[0]).toBe(0);

    h.release();
    await loading;

    expect(h.isStrudelReady()).toBe(true);
    expect(h.evalCode('ch(1, sine())').success).toBe(true);
  });

  it('refuses with the load error after the engine fails to load', async () => {
    const h = await readyHarness({ strudel: 'reject' });

    expect(h.isStrudelReady()).toBe(false);
    // The wording comes from whatever the loader threw, so assert the shape
    // (a reason was recorded) and that the refusal carries it through to the
    // operator rather than inventing its own.
    const reason = h.getStrudelError();
    expect(reason).toBeTruthy();

    const result = h.evalCode('ch(1, sine())');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/pattern engine unavailable/);
    expect(result.error).toContain(reason as string);
  });

  it('keeps refusing during a retry after a failure', async () => {
    const h = await readyHarness({ strudel: 'reject' });
    expect(h.getStrudelError()).toBeTruthy();

    // A retry clears the error before it awaits the import: the same window
    // as a cold start, reached from a state the operator can see is broken.
    const retry = h.initStrudel();
    expect(h.getStrudelError()).toBeNull();
    expect(h.isStrudelReady()).toBe(false);

    const result = h.evalCode('ch(1, sine())');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/loading/);

    await retry;
  });
});

// ─── rollback ─────────────────────────────────────────────────────────────────

describe('a failed run leaves no state behind', () => {
  it('never leaves the staging map open after a throw', async () => {
    const h = await readyHarness();
    expect(h.evalCode('uni(1, 1, 1)').success).toBe(true);
    expect(h.evalCode('uni(1, 2, 1); boom()').success).toBe(false);

    // If the staging map were stranded, this write would vanish into it and
    // every later write from outside an eval with it.
    expect(stagingIsClosed(h)).toBe(true);
  });

  it('never leaves the staging map open when a registry clear throws', async () => {
    // The clears used to sit outside the try, so a throw from one of them
    // escaped evalCode with the staging map still open, and every subsequent
    // uni() call, from any caller, silently went nowhere.
    const h = await readyHarness({ breakSimClear: true });

    const result = h.evalCode('uni(1, 1, 1)');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/registry clear exploded/);
    expect(stagingIsClosed(h)).toBe(true);
  });

  it('leaves the display registries empty rather than holding a fragment', async () => {
    const h = await readyHarness();

    expect(h.evalCode("fixture(1, 'rgb', 7).color(1, 1, 1)").success).toBe(true);
    expect(h.getSimFixtures().length).toBe(1);

    // Registers two fixtures, then dies. Neither is part of a scene that runs.
    const result = h.evalCode("fixture(20, 'rgb', 7); fixture(21, 'rgb', 7); boom()");

    expect(result.success).toBe(false);
    expect(h.getSimFixtures().length).toBe(0);
  });

  it('still swaps the scene on the next good run', async () => {
    const h = await readyHarness();

    expect(h.evalCode('mock(); setBPM(100); uni(1, 1, 1); boom()').success).toBe(false);
    expect(h.sends).toEqual([]);
    expect(h.getBPM()).toBe(120);

    expect(h.evalCode("artnet('10.0.0.5'); setBPM(128); uni(1, 3, 1)").success).toBe(true);

    expect(h.sends).toEqual([{ mode: 'artnet', artnet: { host: '10.0.0.5', port: 6454 } }]);
    expect(h.getBPM()).toBe(128);

    h.tick(0);
    const buf = h.getUniverseBuffer(1);
    expect(buf[2]).toBe(255);
    expect(buf[0]).toBe(0);
  });
});
