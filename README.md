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
  core/     Pattern engine, DMX state, eval sandbox, WebSocket client
  bridge/   Node.js WebSocket server → ArtNet / sACN / mock output
  ui/       Vite frontend — CodeMirror editor, visualizer, status bar
```

- The **browser** runs the scheduler (44 Hz), pattern evaluation, and DMX state management.
- The **bridge** is a stateless output router — it receives universe buffers from the browser and fires UDP packets.
- Patterns are queried via `queryArc(cyclePos, cyclePos + ε)` each tick; values (0.0–1.0) are scaled to DMX range (0–255).

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
