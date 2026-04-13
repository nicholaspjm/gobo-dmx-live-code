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
- **Hardware output** — ArtNet (Art-Net 4), sACN (E1.31), or mock mode
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

Edit `packages/bridge/bridge.config.json`:

| Mode | Config |
|------|--------|
| **Mock** | `{ "mode": "mock" }` — logs to console, no hardware needed |
| **ArtNet** | `{ "mode": "artnet", "artnet": { "host": "192.168.1.255", "port": 6454 } }` |
| **sACN** | `{ "mode": "sacn", "sacn": { "universe": 1, "priority": 100 } }` |

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
