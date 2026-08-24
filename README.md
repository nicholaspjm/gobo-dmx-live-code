# gobo

**Live-code DMX lighting in your browser.**

Write pattern code, watch it on a 512-channel visualizer, and send it to real hardware over a USB DMX interface, TouchDesigner, Art-Net or sACN.

The pattern engine is [@strudel/core](https://strudel.cc): the same waveform and cycle syntax used for live-coding music, wired up to DMX universes instead of audio.

[![Licence: AGPL v3](https://img.shields.io/badge/Licence-AGPL%20v3-blue.svg)](LICENSE)

![gobo editor, visualizer and fixture sim running a pattern](docs/media/demo.gif)

---

## The hosted build

**[Open gobo in your browser](https://nicholaspjm.github.io/gobo-dmx-live-code/)**. No install required.

> The web version runs the full editor and visualizer. A USB DMX interface and TouchDesigner are driven from the page with nothing installed; Art-Net, sACN and OSC need the connector running on your machine. Both routes are below.

---

## What it does

- `Ctrl+Enter` runs the code, and it takes effect on the next tick
- `sine()`, `cosine()`, `square()`, `saw()`, `rand()` and full mini-notation, via Strudel
- 512 channels per universe, multiple universes via `uni()`
- A 512-bar channel strip and a fixture simulation, drawn at 30 fps
- Built-in fixture profiles for RGB, RGBW, moving heads and strobes, and custom definitions
- Pixel strips, `rgbStrip()` / `rgbwStrip()`, with per-pixel, grid and chase helpers
- Output to Art-Net 4, sACN (E1.31), OSC, a USB DMX interface over WebSerial with nothing installed, TouchDesigner directly, or mock
- One working scene, autosaved to the browser as you type, saved as a plain `.js` file when you want a durable copy
- A share link that carries the whole scene, no server involved
- Three bundled demo scenes, on the examples tab of the docs panel
- Built-in, bundled public, saved and session fixtures in one library panel, with JSON import/export
- Click `docs` in the top bar for inline function reference, plus hover help and autocomplete
- Thirteen themes, named after the lights they look like. `tungsten` (warm charcoal / terracotta) by default, through `bastardAmber`, `cyclorama`, `blackout`, `glowtape` and `surprisePink`
- Semantic highlighting: fixtures, patterns, colour channels, movement, pixel methods and output config each get their own colour

---

## Two ways to run

### 1. In a browser, nothing installed

Open the [live link](https://nicholaspjm.github.io/gobo-dmx-live-code/) and start coding. The
editor, visualizer, fixture sim and share links need no output at all, and two outputs reach
real fixtures from the page as it stands:

| Call | What it drives | Conditions |
|------|----------------|------------|
| `usb()` | A USB DMX box plugged into this computer, the Enttec DMX USB Pro type. Click **usb** in the top bar to choose it, then call `usb()` | Chrome or Edge, one universe. A serial port is something a browser is allowed to open |
| `td()` | TouchDesigner, over a WebSocket. TD receives every frame and puts Art-Net on the network for you | TouchDesigner already open on the same machine: an https page may only open `ws://` to localhost |

### 2. With the connector, for Art-Net, sACN and OSC

`artnet()`, `sacn()` and `osc()` all leave as UDP network packets, and a web page is not
allowed to put packets on the network by itself. That is a rule every browser enforces, not a
gobo limitation, so a small program on this machine has to do the sending. `mock()` needs it
too, since the printing happens inside it.

From a checkout, one command is both halves:

```bash
git clone https://github.com/nicholaspjm/gobo-dmx-live-code.git
cd gobo-dmx-live-code
npm install
npm start
```

That is the whole thing: one process serving the app and speaking UDP, on
http://localhost:3001, with a browser opened for you. Because the app is served
from that same process, the page talks to it over a same-origin WebSocket.
Nothing to start twice, nothing to forget.

Use `npm run dev` while working on gobo itself: Vite on http://localhost:3000
with hot reload, and the bridge alongside it.

#### Just visiting the site?

There is no checkout to run anything from, so take the connector on its own.
Download one file from
[Releases](https://github.com/nicholaspjm/gobo-dmx-live-code/releases/latest).
It sets itself to start at login the first time it runs, so it is a one time
step; `--uninstall` undoes that.

Then open the app and press `ctrl+enter`.

Three quieter routes are prepared but not live yet, each of them skipping the
warning a downloaded file raises. On macOS and Linux that is Homebrew:

```bash
brew tap nicholaspjm/gobo https://github.com/nicholaspjm/gobo-dmx-live-code
brew install gobo-connector
```

Nothing gobo ships is signed, and a browser marks what it downloads as
quarantined, which is why Gatekeeper refuses the macOS connector and why
allowing it under Privacy and Security is often not enough on Apple Silicon.
Homebrew strips that attribute off what it installs, so the same unsigned
binary simply runs. The formula is
[Formula/gobo-connector.rb](Formula/gobo-connector.rb) in this repository, no
separate tap repo, and it covers Apple Silicon macs and x86_64 Linux, which is
what the release builds. It carries no checksums until a release publishes the
connector archives, so brew refuses it today. `npx gobo-connector` needs the
package published to npm, and `winget install nicholaspjm.gobo` needs the
manifests accepted into `microsoft/winget-pkgs`. None of the three works yet,
so the download above is the route.

Using a USB DMX box, or sending through TouchDesigner? None of the above: those
are the two the page drives on its own, back in section 1.

Want it always available? `npm run autostart` starts the bridge at login, so
opening the page just works from then on, hosted build included. It is a
per-user login item, needs no administrator rights, and
`npm run autostart -- --remove` undoes it. A web page cannot start a process
itself, so this is the way round to arrange it.

If nothing reaches the rig, run `npm run doctor`. It checks each link in the
chain and reports what it measured, including the two mistakes that fail
silently: sending to your own machine's IP, and the computer being on a
different subnet from the node.

`packages/bridge/bridge.config.json` sets the bridge's startup output. It ships in `artnet`
mode pointed at `127.0.0.1`, which only reaches software on the same machine. Edit the host
to your subnet broadcast or a node's IP for real hardware:

```json
{ "mode": "artnet", "artnet": { "host": "192.168.1.255", "port": 6454 } }
```

Supported modes: `artnet`, `sacn`, `osc`, `mock`. Calling `artnet()` / `sacn()` / `osc()` /
`mock()` from editor code overrides this at runtime (see [DMX output configuration](#dmx-output-configuration)).

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
fixture(1, 'rgb').red(sine())

// Multi-universe
uni(2, 1, sine().slow(4))
```

---

## Scenes and links

There is **one working scene**. It autosaves to the browser as you type, debounced at ~0.5 s;
switch that off under **autosave** in settings. A refresh, a crash or a closed laptop costs
you nothing. Click the name in the top bar to rename it.

A share link is the durable copy. **share** in the top bar copies a link carrying the entire
scene, described below.

The bundled demos live under the **docs** panel, on its examples tab: *start here* (the two
lines a new browser opens on), *language tour* (everything the language does), and *four-colour
bar demo* (one custom fixture end to end). Loading one replaces the editor, and asks first.

Saving a scene to a `.js` file, and opening one back, is not in this release. The code for it
is still here and still tested, behind one switch in `packages/ui/src/main.ts`.

Anything that replaces the whole buffer (open, share link, example) **arrives stopped** and
waits for `Ctrl+Enter`. It asks first if the current scene has changes you have not saved to a
file.

### Share links

**share** copies a URL of the form `<wherever gobo is served>/#s1=<the whole scene>`. The scene
is in the link: JSON, deflated with the browser's own `CompressionStream`, then base64url-encoded
into the fragment. If the clipboard is unavailable (an insecure context, or a browser that
refuses), the link is shown in a dialog to copy by hand. There is no server, so a link cannot
expire, 404, or be revoked. A URL fragment is never sent in an HTTP request, so even the host
serving gobo never sees your code.

The trade-off is length. Deflate gets typical scene source to around a third of its size and
base64 adds about a third back, so a 2 kB scene lands near 900 characters of link. Browsers
handle far longer URLs, but chat apps, mail gateways and QR codes start truncating somewhere
past 2000 characters. gobo reports the character count when it copies and warns when a link
crosses that mark. **For a big set, save a file and send the file.**

A link carries the code and the name, nothing else. Saved fixtures, settings and themes stay in
your browser, so a scene relying on a fixture you imported needs its `defineFixture()` call in
the scene itself to work on someone else's machine.

> **A shared link is someone else's code, and scene code is not sandboxed.** Opening one and
> pressing `Ctrl+Enter` runs it on your machine. A shared scene never auto-runs: it loads
> stopped, behind a banner saying where it came from. Read it before you run it.
> [SECURITY.md](SECURITY.md#share-links-carry-someone-elses-code-into-your-browser) has the
> detail.

### Scenes from the old multi-scene version

Earlier builds kept several named scenes in a top-bar dropdown. If you have any, a one-time
notice lists them with a download button each, so you can turn them into `.js` files. The old
storage is left exactly as it was: dismissing the notice deletes nothing, and neither does
anything else in this version.

---

## Keyboard shortcuts

| Key | Action |
|-----|--------|
| `Ctrl+Enter` | Evaluate code |
| `Ctrl+.` | Stop. Blackout by default, `freeze` if set that way in settings |
| `Ctrl+Space` | Stop, as an alias that also preempts the autocomplete popup |
| `Ctrl+Shift+F` | Format the buffer |
| `T` | Tap tempo (ignored while typing in the editor or any input) |
| `Alt+M` | Performance view: hide the top bar, sim panel and level strip |

---

## Architecture

```
packages/
  core/     Clock worker, scheduler, pattern eval, DMX state, WS client, fixtures
  bridge/   Node WebSocket server → Art-Net / sACN / OSC / mock UDP
  ui/       Vite frontend: CodeMirror editor, visualizer, sim panel, docs
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
   • clamp 0-1, scale to 0-255, write Uint8Array(512)
   ▼
Visualizer (rAF, 30 fps, read-only snapshot)   +   WS sender (wall-clock throttled)
                                                        │
                                                        ▼
                                                      Bridge
                                                        │
                                                        ▼
                                             UDP: Art-Net / sACN / OSC
```

### Engine

- **Clock lives in a Web Worker.** A `setInterval(16)` in [clockWorker.ts](packages/core/src/clockWorker.ts) posts `"tick"` messages to the main thread. Chromium doesn't throttle worker timers, so the clock keeps firing at ~60 Hz even when the tab is backgrounded ([scheduler.ts](packages/core/src/scheduler.ts)).
- **Cycle position** advances by `(bpm / 60) / 4` cycles per second (4 beats per cycle). `dt` is clamped at 100 ms so a machine sleep or long GC pause doesn't send the phase spinning ([scheduler.ts](packages/core/src/scheduler.ts)). An external clock provider (audio playhead) can override `cyclePos`; nothing installs one in this release.
- **Pattern evaluation** uses [@strudel/core](https://strudel.cc) as the pattern engine. `sine()`, `saw()`, mini-notation, `.slow / .fast / .add / .range / .early / .late` are Strudel patterns. Each tick, every registered channel calls `pattern.queryArc(cyclePos, cyclePos + ε)` to sample the value at that moment ([dmx.ts](packages/core/src/dmx.ts)). The gobo-specific chain methods `.flash / .glow / .wave` are added by monkey-patching `Pattern.prototype`; user code can add its own with `register(name, fn)` ([eval.ts](packages/core/src/eval.ts)). If Strudel fails to load, evaluation is disabled outright and the status bar says why; reload the page to retry. There is no degraded waveform mode.
- **Live eval is not sandboxed.** User code runs via `new Function(...)` in strict mode with a curated globals object (DMX API, fixture API, Strudel waveforms, `Math`, `console`). Those names shadow, they don't remove: the code runs in the page's own realm. Fast to hot-swap, not safe against hostile code ([eval.ts](packages/core/src/eval.ts), and [SECURITY.md](SECURITY.md)).
- **Universe state is `Map<number, Uint8Array(512)>`.** Zeroed and rewritten from scratch every tick, so a scene swap is atomic at the tick boundary ([dmx.ts](packages/core/src/dmx.ts)).

### Real-time behavior

- **Tab throttling.** The clock is in a worker, and the visualizer's rAF loop never drives DMX. Patterns keep running with the tab hidden or the window minimized.
- **Hot swap.** `evalCode` calls `clearDefs()`, which wipes pattern defs *and* universe buffers; the next tick rebuilds everything from the new code, so a swap reaches the wire whole ([dmx.ts](packages/core/src/dmx.ts)).
- **Send rate.** The sender is throttled against the wall clock rather than the tick count, using `1000 / sendRate` ms as its interval (default 60 Hz; 30 / 60 / 120 in settings). A slow render tick does not back up the send queue ([main.ts](packages/ui/src/main.ts), [settings.ts](packages/ui/src/settings.ts)).
- **Going dark.** Idle all-zero universes are skipped to save UDP bandwidth. When a universe goes from live to all-zero, exactly one trailing zero-frame is sent so downstream fixtures latch off; Art-Net and sACN receivers otherwise hold the last value indefinitely ([websocket.ts](packages/core/src/websocket.ts)).
- **Per-tick user errors are swallowed.** A broken pattern doesn't kill the clock; that channel outputs zero until you fix it ([scheduler.ts](packages/core/src/scheduler.ts)).
- **Bridge reconnect.** Every 2 s on close. Sends are dropped while disconnected ([websocket.ts](packages/core/src/websocket.ts)).
- **Latency floor.** One clock tick (~16 ms) + up to one send interval (~16 ms at 60 Hz) + WS hop + UDP hop. The bridge is stateless: each incoming WS message triggers an immediate UDP send, with no coalescing ([bridge/index.ts](packages/bridge/src/index.ts)).
- **Inline pattern widgets** hook the same `onTick` the DMX loop uses rather than a separate rAF, so their visuals stay phase-locked with the lights ([inline-viz.ts](packages/ui/src/inline-viz.ts)). The 512-bar visualizer runs its own rAF loop over a read-only snapshot with light exponential smoothing, so the on-screen strip never contends with the DMX path ([visualizer.ts](packages/ui/src/visualizer.ts)).

### Output protocols

The bridge is stateless: one WebSocket frame in, one UDP send out. Wire cadence matches whatever the browser sends.

| Mode | Packet | Transport | Notes |
|------|--------|-----------|-------|
| Art-Net | 530-byte ArtDmx (`OpOutput 0x5000`) | UDP to the configured host, port 6454; unicast or a broadcast address, your choice | Full 512-channel payload each frame |
| sACN (E1.31) | 638-byte E1.31 packet | UDP multicast `239.255.<hi>.<lo>`, port 5568 | Random CID per bridge process, source name `gobo`; one sequence counter shared across universes |
| OSC | `/gobo/<uni>/<ch>` float | UDP unicast | Only channels that are non-zero, plus one zero per channel transitioning off |
| Mock | n/a | n/a | Logs the non-zero channels of every 7th frame |

### Fixtures

A fixture profile is an ordered list of `{offset, name, type}` channel descriptors ([fixtures.ts](packages/core/src/fixtures.ts)). `fixture(start, id)` returns an object where each channel name becomes a setter that writes to `start + offset` on the target universe. Generic helpers `.color(r,g,b,w?) / .off() / .full()` walk the light-emitting channels of whatever fixture you gave them, so the same call works on `rgb`, `rgbw`, `dim-rgbw`, or a moving head ([fixtures.ts](packages/core/src/fixtures.ts)). Pixel strips (`rgbStrip`, `rgbwStrip`) lay out N × 3 or N × 4 contiguous channels and add `.pixel(i, …)`, `.pixelGrid([…])`, `.each(fn)`, `.rainbowChase(…)`. Roll your own with `defineFixture(id, def)`.

`group(...)` puts fixtures, strips and a fixture's `.pixels` behind the same setters, so one line covers a mixed rig. A fixture counts as one element however many channels it has and a strip counts one per pixel, which is what `.each((phase, i, count) => …)` walks: `group(washA, washB, bar.pixels).each(p => sine().early(p).slow(4))` is one phase ramp across the lot, in the order written. A role only some members have is applied to those; a role no member has throws rather than doing nothing.

Every channel write goes through one function ([dmx.ts](packages/core/src/dmx.ts)), which is where the value contract lives. An omitted value means full, so `wash.red()` is red on. Anything that is not a finite number or a pattern is rejected with the channel named: a quoted number, a signal that was never called, `null`, `NaN`. All of those used to be stored and read as 0 on every tick, which showed as a scene running green with the light off.

---

## DMX output configuration

Set the output from your code, at the top of the editor. Switching modes while running reconfigures the bridge:

```js
usb()                      // USB DMX box on this computer, nothing installed
// td('localhost', 9980)   // TouchDesigner WebSocket DAT, nothing installed
// artnet('2.0.0.100')     // Art-Net: node IP to unicast, or a broadcast address
// sacn(1, 100)            // sACN E1.31: second arg is priority
// osc('127.0.0.1', 9000)  // OSC: /gobo/<uni>/<ch> floats
// mock()                  // console log, printed by the connector
```

`usb()` and `td()` are driven by the page itself, so they work in a plain browser. `artnet()`,
`sacn()`, `osc()` and `mock()` go through the bridge, the only part that speaks UDP, so they
need it running: `npm start`, or the connector on its own. `npm run dev` starts the bridge with
the UI, `npm run dev:bridge` alone. `bridge.config.json` sets the startup default; these calls
override it at runtime.

---

## TouchDesigner

Two routes, and they differ in what has to be running:

- `td('localhost', 9980)` sends straight from the page to a **WebSocket DAT**, with no connector
  involved. TD then puts Art-Net on the network itself. This one works from the hosted site with
  nothing installed, as long as TD is open on the same machine.
- `osc('127.0.0.1', 9000)` feeds an **OSC In CHOP**, one channel per driven DMX address. OSC is
  UDP, so this route goes through the connector like Art-Net does.

Full setup for both: **[docs/touchdesigner.md](docs/touchdesigner.md)**.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Nothing on the rig, dot reads `disconnected` | Bridge not running, or the page can't reach `ws://<host>:3001` | `npm run dev`, or `npm run dev:bridge` on its own. The page reconnects by itself |
| Dot reads `bridge`, rig still dark | Bridge in the wrong mode. With no config file it starts in `mock` and only logs | Call `artnet(…)` / `sacn(…)` / `osc(…)` at the top of the scene and re-run; the bridge prints a `config updated` line naming the new mode |
| Bridge logs Art-Net sends, fixtures dark | Wrong destination. `artnet()` with no argument targets `127.0.0.1`, loopback only | Unicast the node (`artnet('2.0.0.100')`) or broadcast the subnet (`artnet('2.255.255.255')`); the bridge logs the address it used |
| Visualizer flat but the rig responds, or the reverse | The 512-bar strip only draws universe 0. `fixture()` / `rgbStrip()` default to universe 0; `ch()`, `dim()`, `rgb()` write universe **1** | Use `uni(0, ch, v)` to land on the visualized universe. Output is unaffected: every universe is sent |
| Fixtures stay lit after `Ctrl+.` | Stop action is set to `freeze`, which holds the last frame by design (the default is `blackout`) | Set it back to `blackout` in settings. Blackout only reaches the rig while the bridge is connected; closing the tab sends nothing |
| Rig stuck on its last colour after commenting a pattern out | The single zero-frame sent when a universe goes dark was lost, because the bridge was disconnected on that frame | Reconnect, then `Ctrl+.` to re-send zeros |
| Wrong fixtures respond, everything off by one | DMX is 1-based: `ch(1, …)` is channel 1, `fixture(start, id)` covers `start` … `start + channelCount - 1` | Check the fixture's address and channel count; address 1 is gobo's channel 1, not 0 |
| sACN lands on the wrong universe | `sacn(universe, priority)`'s first arg doesn't steer output. The bridge multicasts every universe it receives to `239.255.<hi>.<lo>` | Set the universe with `uni()` or the fixture universe arg. Priority (default 100) is the arg that counts; receivers arbitrate by it |
| Hosted https page can't reach a bridge on another machine | From `github.io` the page always dials `ws://localhost:3001`. Browsers allow loopback from https, but block `ws://` to any other host | Run the bridge on the browser's machine, or `npm run dev` locally and open the UI on that machine's LAN IP (`http://192.168.x.x:3000`) |
| Nothing arrives in TouchDesigner | Bridge still in Art-Net or mock mode, or the `OSC In CHOP` port doesn't match `osc(host, port)` | See [docs/touchdesigner.md](docs/touchdesigner.md); only channels you drive are transmitted |
| Stutter, or a saturated network | Send rate too high for the link | Drop **send rate** to 30 Hz in settings |
| A share link opens gobo but loads no scene | The link was truncated in transit. Chat apps and mail clients cut long URLs, and half a payload cannot be decoded | Re-send it as a link, not as text that wraps, or send a saved `.js` file instead |
| Opened a shared scene and nothing happens | Shared scenes arrive stopped on purpose, because they are someone else's code | Read the code, then `Ctrl+Enter` |

---

## Tech stack

- [TypeScript](https://www.typescriptlang.org/) + [Vite](https://vitejs.dev/)
- [@strudel/core](https://strudel.cc): cycle-based pattern engine
- [CodeMirror 6](https://codemirror.net/): code editor
- [ws](https://github.com/websockets/ws): WebSocket bridge (Node.js)
- ArtNet 4 / sACN E1.31: DMX protocol output

---

## Project

- [CHANGELOG.md](CHANGELOG.md): what landed in each release
- [CONTRIBUTING.md](CONTRIBUTING.md): dev setup, fixture contributions, PR expectations
- [SECURITY.md](SECURITY.md): threat model, what a share link hands you, and why the eval and the bridge are unguarded on purpose
- [fixtures/README.md](fixtures/README.md): public fixture file format

---

## Licence

**AGPL-3.0-or-later.** Use it, study it, change it, share it. A changed version
has to stay under the same terms, and because of section 13 that includes
running it as a network service: host a modified gobo and you have to publish
your changes. Nobody can take this, close it, and sell it.

Partly that is a choice and partly it is arithmetic: the app bundles
[@strudel/core](https://strudel.cc), which is AGPL, so the distributed app
cannot be anything else.

The connector under [`packages/bridge`](packages/bridge) is **MIT**. It contains
no AGPL code, depending only on `ws`, so other lighting projects can reuse it
freely.

There is no contributor licence agreement and there will not be one:
contributors keep their own copyright. See [GOVERNANCE.md](GOVERNANCE.md).
