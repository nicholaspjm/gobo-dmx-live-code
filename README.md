# lumen

**Live-code DMX lighting in your browser.**

Write pattern code, see results instantly on a 512-channel visualizer, and send to real hardware via ArtNet or sACN.

Powered by [@strudel/core](https://strudel.cc) — the same waveform and cycle syntax used for live-coding music, wired up to DMX universes instead of audio.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## Try it now

**[Open lumen in your browser](https://nicholaspjm.github.io/dmx-live-code/)** — no install required.

> The web version runs the full editor and visualizer. To send DMX to real hardware, run the bridge server locally (see below).

---

## Features

- **Live eval** — `Ctrl+Enter` to run; code takes effect on the next tick
- **Pattern engine** — `sine()`, `cosine()`, `square()`, `saw()`, `rand()` and full mini-notation via Strudel
- **512 channels per universe** — multiple universes via `uni()`
- **Real-time visualizer** — 512-bar channel strip + fixture simulation, 30 fps
- **Fixture system** — built-in profiles for RGB, RGBW, moving heads, strobes, and custom definitions
- **Multiple outputs** — direct-to-TouchDesigner WebSocket, OSC, ArtNet (Art-Net 4), sACN (E1.31), or mock
- **Reference panel** — click `docs` in the top bar for inline function reference
- **Earth-tone UI** — warm charcoal / terracotta aesthetic, no harsh whites

---

## Quick start

### Browser only (no hardware)

Just open the [live link](https://nicholaspjm.github.io/dmx-live-code/) and start coding. The visualizer shows DMX output in real time.

### With hardware (local dev)

```bash
git clone https://github.com/nicholaspjm/dmx-live-code.git
cd dmx-live-code
npm install
npm run dev
```

This starts both the **UI** (http://localhost:3000) and the **bridge** (ws://localhost:3001).

Edit `packages/bridge/bridge.config.json` to configure your output:

```json
{ "mode": "artnet", "artnet": { "host": "192.168.1.255", "port": 6454 } }
```

Supported modes: `mock` (default), `artnet`, `sacn`.

---

## Pattern examples

```js
// Pulse channel 1 over 2 bars
ch(1, sine().slow(2))

// Fast strobe on channel 5
ch(5, square().fast(8))

// RGB fixture on channels 10-12
rgb(10, sine(), 0, cosine().slow(3))

// Static value
ch(3, 200)
ch(7, 0.75)

// Set tempo
setBPM(140)

// Sawtooth chase across 4 channels
ch(1, saw())
ch(2, saw().add(0.25))
ch(3, saw().add(0.5))
ch(4, saw().add(0.75))

// Named fixture access
fixture(1, 'generic-rgb').red(sine())

// Multi-universe
uni(2, 1, sine().slow(4))
```

---

## Keyboard shortcuts

| Key | Action |
|-----|--------|
| `Ctrl+Enter` | Evaluate code |
| `Ctrl+.` | Stop — zero all channels |

---

## Architecture

```
packages/
  core/     Clock worker, scheduler, pattern eval, DMX state, WS client, fixtures
  bridge/   Node WebSocket server → Art-Net / sACN / OSC / mock UDP
  ui/       Vite frontend — CodeMirror editor, visualizer, sim panel, docs
```

Data flow, one tick:

```
Clock (Web Worker, 60 Hz, setInterval)
   │  postMessage("tick")
   ▼
Scheduler (main thread)
   • advance cyclePos by (bpm / 60 / 4) * dt      (dt clamped ≤ 100 ms)
   • fire per-tick callbacks
   ▼
DMX.tick(cyclePos)
   • zero every universe buffer
   • for each channel def: pattern.queryArc(cyclePos, cyclePos + ε)
   • clamp 0–1, scale to 0–255, write Uint8Array(512)
   ▼
Visualizer (rAF, 30 fps, read-only snapshot)   +   WS sender (wall-clock throttled)
                                                        │
                                                        ▼
                                                 Bridge  or  TouchDesigner
                                                        │
                                                        ▼
                                             UDP: Art-Net / sACN / OSC
```

### Engine

- **Clock lives in a Web Worker.** A `setInterval(16)` in [clockWorker.ts:22](packages/core/src/clockWorker.ts:22) posts `"tick"` messages to the main thread. Chromium doesn't throttle worker timers, so the clock keeps firing at ~60 Hz even when the tab is backgrounded ([scheduler.ts:8](packages/core/src/scheduler.ts:8)).
- **Cycle position** advances by `(bpm / 60) / 4` cycles per second (4 beats per cycle). `dt` is clamped at 100 ms so a machine sleep or long GC pause doesn't send the phase spinning ([scheduler.ts:70](packages/core/src/scheduler.ts:70)). An external clock provider (audio playhead) can override `cyclePos` when audio-reactive mode is on.
- **Pattern evaluation** uses [@strudel/core](https://strudel.cc) as the actual pattern engine — `sine()`, `saw()`, mini-notation, `.slow / .fast / .add / .range / .early / .late` are real Strudel patterns. Each tick, every registered channel calls `pattern.queryArc(cyclePos, cyclePos + ε)` to sample the value at that exact moment ([dmx.ts:95](packages/core/src/dmx.ts:95)). The lumen-specific chain methods `.flash / .glow / .wave` are added by monkey-patching `Pattern.prototype`; user code can add its own with `register(name, fn)` ([eval.ts:96](packages/core/src/eval.ts:96), [eval.ts:252](packages/core/src/eval.ts:252)).
- **Live eval is not sandboxed** — user code runs via `new Function(...)` in strict mode with a curated globals object (DMX API, fixture API, Strudel waveforms, `Math`, `console`). Fast to hot-swap, not safe against hostile code — fine for a local live-coding tool ([eval.ts:272](packages/core/src/eval.ts:272)).
- **Universe state is `Map<number, Uint8Array(512)>`.** Zeroed and rewritten from scratch every tick, so a scene swap is atomic at the tick boundary ([dmx.ts:26](packages/core/src/dmx.ts:26), [dmx.ts:85](packages/core/src/dmx.ts:85)).

### Real-time behavior

The interesting bits for anyone asking "will this hold up during a set":

- **Tab-throttling immune.** The clock is in a worker; the on-screen visualizer's rAF loop is decoupled and never drives DMX. Hide the tab, minimize the window, patterns keep running.
- **Hot swap is atomic.** `evalCode` calls `clearDefs()` which wipes pattern defs *and* universe buffers; the next tick rebuilds everything from the new code ([dmx.ts:77](packages/core/src/dmx.ts:77)). No half-applied scene is ever sent to the wire.
- **Send rate is wall-clock throttled**, not "every Nth tick". Sender uses `1000 / sendRate` ms as its send interval (default 60 Hz, configurable), so a slow render tick doesn't back up the send queue ([main.ts:285](packages/ui/src/main.ts:285), [settings.ts:58](packages/ui/src/settings.ts:58)).
- **Going-dark zero-frame.** Idle all-zero universes are skipped to save UDP bandwidth, but when a universe transitions live → all-zero, exactly one trailing zero-frame is sent so downstream fixtures actually latch off — otherwise Art-Net/sACN receivers happily hold the last value forever ([websocket.ts:104](packages/core/src/websocket.ts:104)).
- **Per-tick user errors are swallowed.** A broken pattern doesn't kill the clock; that channel just outputs zero until you fix it ([scheduler.ts:91](packages/core/src/scheduler.ts:91)).
- **Bridge auto-reconnect** every 2 s on close; sends silently drop while disconnected — no queue, no backpressure ([websocket.ts:69](packages/core/src/websocket.ts:69)).
- **Latency floor.** One clock tick (~16 ms) + up to one send interval (~16 ms at 60 Hz) + WS hop + UDP hop. The bridge is stateless: each incoming WS message triggers an immediate UDP send, no coalescing ([bridge/index.ts:319](packages/bridge/src/index.ts:319)).
- **Inline pattern widgets** hook the same `onTick` the DMX loop uses rather than a separate rAF, so their visuals stay phase-locked with the lights ([inline-viz.ts:335](packages/ui/src/inline-viz.ts:335)). The main 512-bar visualizer runs a separate rAF loop with a read-only snapshot and light exponential smoothing so the on-screen strip never contends with the DMX path ([visualizer.ts:51](packages/ui/src/visualizer.ts:51)).

### Output protocols

Bridge is stateless — one WebSocket frame in, one UDP send out. Wire cadence matches whatever the browser sends.

| Mode | Packet | Transport | Notes |
|------|--------|-----------|-------|
| Art-Net | 530-byte ArtDmx (`OpOutput 0x5000`) | UDP broadcast (default) or unicast, port 6454 | Full 512-channel payload each frame |
| sACN (E1.31) | 638-byte E1.31 packet | UDP multicast `239.255.<hi>.<lo>`, port 5568 | Random CID per bridge process, monotonic seq per universe |
| OSC | `/lumen/<uni>/<ch>` float | UDP unicast | Only channels that are non-zero, plus one zero per channel transitioning off |
| TouchDesigner | JSON over WebSocket | browser → TD directly | Bypasses the bridge; TD's WebSocket DAT parses JSON (see setup below) |
| Mock | — | — | Logs a summary ~2×/s |

### Fixtures

A fixture profile is just an ordered list of `{offset, name, type}` channel descriptors ([fixtures.ts:58](packages/core/src/fixtures.ts:58)). `fixture(start, id)` returns an object where each channel name becomes a setter that writes to `start + offset` on the target universe. Generic helpers `.color(r,g,b,w?) / .off() / .full()` walk the light-emitting channels of whatever fixture you gave them, so the same call works on `rgb`, `rgbw`, `dim-rgbw`, or a moving head ([fixtures.ts:518](packages/core/src/fixtures.ts:518)). Pixel strips (`rgbStrip`, `rgbwStrip`) lay out N × 3 or N × 4 contiguous channels and add `.pixel(i, …)`, `.pixelGrid([…])`, `.each(fn)`, `.rainbowChase(…)`. Roll your own with `defineFixture(id, def)`.

---

## DMX output configuration

Set the output from your code, at the top of the editor. Switching modes while running reconfigures on the fly:

```js
td('localhost', 9980)      // direct WebSocket to TouchDesigner (no bridge)
// osc('127.0.0.1', 9000)  // OSC via bridge
// artnet('192.168.1.50')  // Art-Net via bridge
// sacn(1, 100)            // sACN E1.31 via bridge
// mock()                  // console log only
```

- **`td(host, port)`** bypasses the bridge entirely — the browser opens a WebSocket straight to TouchDesigner's WebSocket DAT.
- **`osc`, `artnet`, `sacn`, `mock`** all run through the local bridge (which speaks raw UDP). Start it with `npm run bridge`.

`packages/bridge/bridge.config.json` is still read on bridge startup as a default, but the runtime calls above override it.

---

## TouchDesigner — direct WebSocket setup

Use this when you want lumen to drive TouchDesigner with no bridge process. All values arrive as 0–1 floats, one per DMX channel.

**1. WebSocket DAT (server).**
Create `websocket1` (DAT → WebSocket). Parameters:

| Parameter | Value |
|-----------|-------|
| Active | `On` |
| Mode | `Server` |
| Network Port | `9980` |
| Format | `Text` |

**2. Table DAT.** Create `table1` (DAT → Table). Leave it empty.

**3. Code Text DAT.** Create `code_text` (DAT → Text). Leave it empty — lumen will push your live editor contents into it.

**4. Callback script.** Create `callbacks1` (DAT → Text) and set `websocket1`'s *Callbacks DAT* parameter to it. Paste:

```python
import json

def onReceiveText(dat, rowIndex, message, peer):
    try:
        data = json.loads(message)
    except Exception:
        return

    msg_type = data.get('type')

    if msg_type == 'dmx':
        table = op('table1')
        for uni_str, values in data.get('universes', {}).items():
            for i, v in enumerate(values):
                name = f'{uni_str}/{i + 1}'
                norm = v / 255.0
                row = table.row(name)
                if row is None:
                    table.appendRow([name, norm])
                else:
                    table[name, 1] = norm

    elif msg_type == 'code':
        code_dat = op('code_text')
        if code_dat is not None:
            code_dat.text = data.get('text', '')

    return

def onConnect(dat, peer): return
def onDisconnect(dat, peer): return
```

**5. DAT to CHOP.** Create `datto1` (CHOP → DAT to). Set *DAT* to `table1` and *First Column is Names* to `On`. Each channel now appears as a named CHOP channel (`1/1`, `1/2`, …) with values 0–1.

**6. Code visual (optional).** Create a Text TOP and set its *Text* parameter to a Python expression:

```
op('code_text').text
```

Set *Font* to a monospace face (e.g. `Consolas`, `JetBrains Mono`) so indentation lines up. The Text TOP renders the whole string in a single colour — indentation and line breaks are preserved, but syntax highlighting is not. Composite this TOP into your scene however you like.

lumen pushes the current editor contents to `code_text` on every keystroke (debounced ~250 ms), on every `Ctrl+Enter`, and once on (re)connect, so the visual always reflects what's actually running.

**7. In lumen.** Open the [live page](https://nicholaspjm.github.io/dmx-live-code/), leave the default `td('localhost', 9980)` line, and hit `Ctrl+Enter`. The status dot in the top bar should switch to `td` and channels will start appearing in `datto1`.

> **Note:** `localhost` works from the hosted page because Chromium allows `ws://localhost` even from https pages. If you run TD on a different machine, substitute its IP — but the page will need to be served over http (or TD behind wss/a reverse proxy).

---

## Tech stack

- [TypeScript](https://www.typescriptlang.org/) + [Vite](https://vitejs.dev/)
- [@strudel/core](https://strudel.cc) — cycle-based pattern engine
- [CodeMirror 6](https://codemirror.net/) — code editor
- [ws](https://github.com/websockets/ws) — WebSocket bridge (Node.js)
- ArtNet 4 / sACN E1.31 — DMX protocol output

---

## License

[MIT](LICENSE)
