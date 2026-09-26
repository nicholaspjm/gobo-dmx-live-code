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
- One working scene, autosaved to the browser as you type
- A share link that carries the whole scene, no server involved
- Three bundled demo scenes, on the examples tab of the docs
- Built-in, bundled public, saved and session fixtures on one fixtures tab, with JSON import/export
- One panel behind the ☰ button: docs, fixtures, log, outputs, settings — plus hover help and autocomplete in the editor
- Thirteen themes, named after the lights they look like. `tungsten` (warm charcoal / terracotta) by default, through `bastardAmber`, `cyclorama`, `blackout`, `glowtape` and `surprisePink`
- Semantic highlighting: fixtures, patterns, colour channels, movement, pixel methods and output config each get their own colour

---

## Ways to run

gobo is a web page, and for most of what it does the page is all you need. Network lighting
is the exception: Art-Net, sACN and OSC leave as UDP packets, which no browser lets a web page
send, so something native has to run on your computer.

|  | The website | Run it locally | The website + connector |
|---|---|---|---|
| Install | nothing | the desktop app, or `npm start` | one small program that runs in the background |
| Editor, sim, share links | ✓ | ✓ | ✓ |
| USB DMX box, TouchDesigner | ✓ | ✓ | ✓ |
| Art-Net, sACN, OSC | | ✓ | ✓ |
| The browser asks permission | | never | once, in Chrome |

**If you are driving a network rig, run it locally.** It is the most streamlined of the three:
one program serves the app and sends the output, so there is nothing to connect, nothing
running in the background once you close it, and nothing for the browser to allow.

### The website

Open the [live link](https://nicholaspjm.github.io/gobo-dmx-live-code/) and start coding. The
editor, visualizer, fixture sim and share links need no output at all, and two outputs reach
real fixtures from the page as it stands:

| Call | What it drives | Conditions |
|------|----------------|------------|
| `usb()` | A USB DMX box plugged into this computer, the Enttec DMX USB Pro type. Open the outputs tab from the connection light and pick **usb** to choose the box, then call `usb()` | Chrome or Edge, one universe. A serial port is something a browser is allowed to open |
| `td()` | TouchDesigner, over a WebSocket. TD receives every frame and puts Art-Net on the network for you | TouchDesigner already open on the same machine |

### Run it locally

**The desktop app** is the editor and the sender in one window. Download it from
[Releases](https://github.com/nicholaspjm/gobo-dmx-live-code/releases/latest): the `.dmg` for an
Apple Silicon Mac, the `Setup` `.exe` for Windows, the `.AppImage` for Linux. It is not signed
with a certificate, so the first time you open it your system will ask you to confirm; the steps
are [below](#the-first-time-you-open-a-download).

**From a checkout**, one command does the same thing:

```bash
git clone https://github.com/nicholaspjm/gobo-dmx-live-code.git
cd gobo-dmx-live-code
npm install
npm start
```

That is one process serving the app and speaking UDP, on http://localhost:3001, with a browser
opened for you. The page talks to it over a same-origin WebSocket: nothing to start twice,
nothing to forget. On an Intel Mac this is the route, since the downloads are Apple Silicon
builds.

Use `npm run dev` while working on gobo itself: Vite on http://localhost:3000 with hot reload,
and the bridge alongside it.

### The website and the connector

If you would rather keep using the hosted page, add the connector: the same sender, on its own.
Download the one for your system from
[Releases](https://github.com/nicholaspjm/gobo-dmx-live-code/releases/latest) and run it once. It
sets itself to start when you log in, and `--uninstall` undoes that. Then open the app and press
`ctrl+enter`.

On an Apple Silicon Mac or x86_64 Linux, Homebrew installs it without the first-run warning,
because what it installs is not marked as downloaded:

```bash
brew tap nicholaspjm/gobo https://github.com/nicholaspjm/gobo-dmx-live-code
brew install gobo-connector
brew services start gobo-connector
```

**Chrome asks before a website may reach a program on your computer**, and the connector is
one. When it asks about gobo, allow it. If you blocked it, the outputs tab in the app says so;
change it from the icon beside the address, under local network access. Running gobo locally
never meets this, because a page on your own computer reaching your own computer is not a
request the browser asks about.

The connector listens on `localhost:3001` and answers only gobo's own pages, so another website
open in the same browser cannot drive your rig through it. A copy of gobo hosted somewhere else,
a fork for instance, needs `--allow-origin https://that.site` when the connector starts.

From a checkout, `npm run autostart` starts the bridge at login instead, so the hosted page just
works from then on. It is a per-user login item, needs no administrator rights, and
`npm run autostart -- --remove` undoes it.

### The first time you open a download

Nothing gobo ships is signed with an Apple or Microsoft certificate, so your system will say it
cannot check who made it.

- **macOS:** open it once and let it be refused, then go to System Settings, Privacy &
  Security, and choose Open Anyway. A browser download of the connector also loses its execute
  bit, so `chmod +x gobo-connector-macos` first; if Open Anyway does not appear for it,
  `xattr -d com.apple.quarantine gobo-connector-macos` clears the flag the browser set. Or use
  Homebrew, above.
- **Windows:** SmartScreen says "Windows protected your PC". Choose More info, then Run anyway.
- **Linux:** `chmod +x` the file, then run it.

If you would rather not run an unsigned binary at all, `npm start` from a checkout is the same
program, built from source you can read.

### From a phone or tablet on the same network

The connector and the dev server answer only this computer unless you ask otherwise:

```bash
npm start -- --lan
```

or, for development, `GOBO_LAN=1 npm run dev`, which opens up both. Then open
`http://<this computer's address>:3001` on the other device (`:3000` for dev). Only do this on
a network you trust: web pages are still checked, but any program on that network can connect
and drive the rig. [SECURITY.md](SECURITY.md#the-connector-answers-this-computer-and-gobos-own-pages)
has the detail.

### When nothing reaches the rig

Run `npm run doctor`. It checks each link in the chain and reports what it measured, including
the two mistakes that fail silently: sending to your own machine's IP, and the computer being
on a different subnet from the node.

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
you nothing. It has no name: there is only the one, and it is the document on screen.

A share link is the durable copy. **share** in the top bar copies a link carrying the entire
scene and shows you what it copied, described below. The same dialog will hand you the code
as plain text instead, which is what to keep for a scene too long to paste as a link.

The bundled demos live under the panel's **docs** tab, on its examples sub-tab: *start here* (the two
lines a new browser opens on), *language tour* (everything the language does), and *four-colour
bar demo* (one custom fixture end to end). Loading one replaces the editor, and asks first.

**save** writes the scene to a `.js` file (`Ctrl+S`) and **open** reads one back. The file is
the code and nothing else, so it opens with syntax highlighting in any editor and diffs line by
line. One file is one performance: a show that lives only in this browser cannot be carried to
the laptop going to the gig, kept in git, or backed up.

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
crosses that mark. **For a big set, use "copy the code instead" in the same dialog and send that.**

A link carries the code and nothing else. Saved fixtures, settings and themes stay in your
browser, so a scene relying on a fixture you imported needs its `defineFixture()` call in the
scene itself to work on someone else's machine.

> **A shared link is someone else's code, and scene code is not sandboxed.** Opening one and
> pressing `Ctrl+Enter` runs it on your machine. A shared scene never auto-runs: it loads
> stopped, and asks before it replaces what you had. Read it before you run it.
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
| `Ctrl+Enter` | Evaluate the whole document |
| `Ctrl+.` | Stop. Blackout by default, `freeze` if set that way in settings. A second press blacks out either way |
| `Ctrl+Space` | Stop, as an alias that also preempts the autocomplete popup |
| `Ctrl+Shift+Enter` | Evaluate only the edits inside the selection, or the block around the cursor |

Turning on **ctrl+enter runs the block** in settings swaps those last two over, so the plain
chord takes the block and the shifted one takes the document.
| `Ctrl+Shift+F` | Format the buffer |
| `Alt+1`…`Alt+9` | Run that cue, when the scene calls `cue()` |
| `T` | Tap tempo (ignored while typing in the editor or any input) |
| `Alt+M` | Zen mode: hide the top bar, sim panel and level strip. Clicking the mark does the same |

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
- **Send rate.** The sender is throttled against the wall clock rather than the tick count, using `1000 / sendRate` ms as its interval (default 40 Hz; 25 / 30 / 40 / 44 in settings, since DMX itself carries about 44 frames a second). A slow render tick does not back up the send queue ([main.ts](packages/ui/src/main.ts), [settings.ts](packages/ui/src/settings.ts)).
- **Going dark.** Idle all-zero universes are skipped to save UDP bandwidth. When a universe goes from live to all-zero, exactly one trailing zero-frame is sent so downstream fixtures latch off; Art-Net and sACN receivers otherwise hold the last value indefinitely ([websocket.ts](packages/core/src/websocket.ts)).
- **Per-tick user errors are swallowed.** A broken pattern doesn't kill the clock; that channel outputs zero until you fix it ([scheduler.ts](packages/core/src/scheduler.ts)).
- **Bridge reconnect.** Two seconds after a close, doubling to a thirty-second ceiling, and back to two the moment a scene picks an output that needs it. Sends are dropped while disconnected ([websocket.ts](packages/core/src/websocket.ts)).
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

A fixture profile is an ordered list of `{offset, name, type}` channel descriptors ([fixtures.ts](packages/core/src/fixtures.ts)). `fixture(start, id)` returns an object where each channel name becomes a setter that writes to `start + offset` on the target universe. Generic helpers `.color(…) / .off() / .full()` walk the light-emitting channels of whatever fixture you gave them, so the same call works on `rgb`, `rgbw`, `dim-rgbw`, or a moving head ([fixtures.ts](packages/core/src/fixtures.ts)). A channel counts as a colour when it is named `red`/`green`/`blue`/`white` in any case and with any trailing number, or spelled `r`/`g`/`b`/`w` and declared `type: 'color'`. `.color()` takes one colour, several, or an array of them: a run spreads across whatever pixels the fixture has, and a single-position fixture like a par says so rather than dropping the rest. Pixel strips (`rgbStrip`, `rgbwStrip`) lay out N × 3 or N × 4 contiguous channels and answer `.color(…)` and `.fill(…)` alike, plus `.pixel(i, …)`, `.pixelGrid([…])`, `.each(fn)`, `.rainbowChase(…)`. Roll your own with `defineFixture(id, def)`.

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
| Nothing on the rig, dot reads `disconnected` | Bridge not running, or the page can't reach `ws://<host>:3001` | `npm start`, or the connector. The page reconnects by itself |
| The outputs tab says the browser is blocking the connector | Chrome's local network access permission was refused for the hosted site | Allow it from the icon beside the address, or run gobo locally, where there is nothing to allow |
| Connector running, a copy of gobo hosted elsewhere will not connect | The connector answers only its own pages and the official hosted site, and says so in its log | Start it with `--allow-origin https://that.site` |
| Dot reads `bridge`, rig still dark | Bridge in the wrong mode. With no config file it starts in `mock` and only logs | Call `artnet(…)` / `sacn(…)` / `osc(…)` at the top of the scene and re-run; the bridge prints a `config updated` line naming the new mode |
| Bridge logs Art-Net sends, fixtures dark | Wrong destination. `artnet()` with no argument targets `127.0.0.1`, loopback only | Unicast the node (`artnet('2.0.0.100')`) or broadcast the subnet (`artnet('2.255.255.255')`); the bridge logs the address it used |
| Visualizer flat but the rig responds, or the reverse | The scene is driving more than one universe. Every call defaults to universe 0, so something is naming another. The strip draws the lowest and says `(+1 more)` when there are others | Give the scene one universe, or point the interface at the one you want. On the connector every universe is sent, but a **USB** interface carries only one — the run says which universes are not reaching it |
| Fixtures stay lit after `Ctrl+.` | Stop action is set to `freeze`, which holds the last frame by design (the default is `blackout`) | Set it back to `blackout` in settings. Blackout only reaches the rig while the bridge is connected; closing the tab sends nothing |
| Rig stuck on its last colour after commenting a pattern out | The single zero-frame sent when a universe goes dark was lost, because the bridge was disconnected on that frame | Reconnect, then `Ctrl+.` to re-send zeros |
| Wrong fixtures respond, everything off by one | DMX is 1-based: `ch(1, …)` is channel 1, `fixture(start, id)` covers `start` … `start + channelCount - 1` | Check the fixture's address and channel count; address 1 is gobo's channel 1, not 0 |
| sACN lands on the wrong universe | `sacn(universe, priority)`'s first arg doesn't steer output. The bridge multicasts every universe it receives to `239.255.<hi>.<lo>` | Set the universe with `uni()` or the fixture universe arg. Priority (default 100) is the arg that counts; receivers arbitrate by it |
| Hosted https page can't reach a bridge on another machine | From `github.io` the page always dials `ws://localhost:3001`. Browsers allow loopback from https, but block `ws://` to any other host | Run the bridge on the browser's machine, or run gobo on that machine with `npm start -- --lan` and open it at `http://<its address>:3001` |
| Nothing arrives in TouchDesigner | Bridge still in Art-Net or mock mode, or the `OSC In CHOP` port doesn't match `osc(host, port)` | See [docs/touchdesigner.md](docs/touchdesigner.md); only channels you drive are transmitted |
| Stutter, or a saturated network | Send rate too high for the link | Drop **send rate** to 30 Hz in settings |
| A share link opens gobo but loads no scene | The link was truncated in transit. Chat apps and mail clients cut long URLs, and half a payload cannot be decoded | Re-send it as a link, not as text that wraps, or use **copy the code instead** in the share dialog and send the text |
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

- [Report a problem](https://github.com/nicholaspjm/gobo-dmx-live-code/issues/new/choose), or the **report a problem** button in the app's log tab, which fills in your versions
- [Discussions](https://github.com/nicholaspjm/gobo-dmx-live-code/discussions): questions, ideas you want to talk through, and things you made
- [CHANGELOG.md](CHANGELOG.md): what landed in each release
- [CONTRIBUTING.md](CONTRIBUTING.md): dev setup, fixture contributions, PR expectations
- [SECURITY.md](SECURITY.md): threat model, what a share link hands you, why the eval is unguarded on purpose, and what the connector will and will not answer
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
