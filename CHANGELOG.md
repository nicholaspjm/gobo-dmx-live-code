# Changelog

All notable changes to lumen are recorded here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-08-12

First public release. There was never a published 0.1.0 — everything below landed during pre-0.2 development, and the commit-level detail for that period lives in git rather than being restated here.

### Added

- **Pattern engine** — `sine()`, `cosine()`, `square()`, `saw()`, `rand()` built on [@strudel/core](https://strudel.cc), with the usual chain methods (`.slow` / `.fast` / `.range` / `.add` / `.mul` / `.early` / `.late`). Patterns are sampled once per tick and written straight into DMX buffers. If strudel fails to load, a numeric fallback waveform shim keeps the same API working.
- **Mini-notation sequencing** — `mini()` / `m()` from `@strudel/mini`, plus `sequence()`, `cat()`, `stack()`. Write a drum grid per channel (`spot.white(mini('1 - - 1'))`) instead of hand-rolling envelopes.
- **`register(name, fn)`** — define custom chain methods from editor code; they attach to the Pattern prototype and survive `.slow()` / `.fast()` / `.add()` chains.
- **Fixture system** — `fixture(startChannel, id, universe)` returns one setter per named channel. Built-in profiles: `dim`, `rgb`, `rgbw`, `rgba`, `dim-rgb`, `dim-rgbw`, `moving-head-basic`, `moving-head-spot`, `strobe`. `defineFixture(id, def)` declares custom profiles inline.
- **Standard fixture API** — `.color(r, g, b[, w])`, `.off()` and `.full()` on every instance, built-in or custom. `.color()` skips channels the fixture lacks so one line works across rgb / rgbw / dim-rgbw / moving heads; `.off()` zeroes light-emitting channels only, leaving pan / tilt / gobo aim intact. `.set(name, value)` and `.channels()` round out the generic surface.
- **Pixel strips** — `rgbStrip()` and `rgbwStrip()` primitives, or a `{ type: 'strip', pixelCount, pixelLayout }` channel embedded inside a `defineFixture()` profile. Per-pixel helpers: `.fill()`, `.pixel(i, …)` (monochrome or full colour), `.each((phase, i, count) => …)`, `.pixelGrid([[…], […]])` with `.repeat()` / `.hold()` / `.mirror()` fill modes, and a built-in `.rainbowChase()`.
- **Low-level DMX** — `ch()`, `uni()`, `dim()`, `rgb()` for addressing raw channels; 512 channels per universe, any number of universes.
- **Scenes** — named code buffers persisted to localStorage, with a topbar picker for new / save-as / rename / reset-to-seed / delete, debounced autosave, and a file-picker-style dropdown grouped into default, recent, and other. The `default` scene is protected from save, rename, and delete. First run seeds a demo scene plus `ultratronics 11`, a live-performance template built around real onset and section analysis of the track.
- **Fixture library panel** — four tiers in one list: built-in profiles, public fixtures bundled from `fixtures/*.json` at build time, fixtures saved to the browser, and session-only ones declared by `defineFixture()`. Import and export as JSON; a share button opens a pre-filled GitHub new-file URL so proposing a fixture for the public library is one click.
- **Fixture validation** — every fixture coming in from a file or the bundle runs through a strict validator (rejects id collisions with built-ins, out-of-range sizes, unknown schema keys, unsafe characters). CI runs the same validator on any PR touching `fixtures/`.
- **Inline visualizations** — `.viz('color' | 'wave' | 'meter' | 'strip')` on a fixture or strip drops a live widget at the end of the source line, and `.flash()` / `.glow()` / `.wave()` decorate any pattern in place. Both are opt-in per call and driven from the scheduler tick, so they stay phase-locked with output.
- **Fixture simulator** — a panel rebuilt after every eval from the fixtures the scene actually declares, rendering RGB/RGBW globes, dimmer globes, and pixel strips. Hover tooltips show name, type, universe, channel range, and live values; fixtures with `pan` / `tilt` / `direction` channels get a small XY indicator tracking their position.
- **Docs and hover help** — a tabbed reference panel (welcome / patterns / fixtures / viz / output / reference) with ranked search, plus hover tooltips giving signature, description, and example for any lumen identifier. Autocomplete and hover help are generated from the same help source, and the editor highlights lumen commands and fixture-bound identifiers semantically.
- **Settings and themes** — sliding settings panel with theme, stop action (blackout or freeze), autosave, format-on-run, inline viz, sim tooltips, and send rate (30 / 60 / 120 Hz). Nine themes — ember, slate, forest, midnight, paper, ikeda, datamatrix, terminal, puredata — swap instantly because the editor and canvas read CSS variables.
- **Output paths** — a Node bridge on `ws://localhost:3001` fans DMX out over Art-Net, sACN (E1.31), OSC, or a mock console logger; `artnet()`, `sacn()`, `osc()` and `mock()` reconfigure it at runtime from editor code. OSC sends `/lumen/<universe>/<channel>` with one float in 0–1, which an OSC In CHOP picks up directly for TouchDesigner work.
- **Editor keybindings** — `Ctrl+Enter` eval, `Ctrl+.` stop, `Ctrl+Space` as a second stop alias that preempts autocomplete, `Ctrl+S` save, `Ctrl+Shift+S` save-as, `Ctrl+Shift+F` format via a lazily loaded Prettier. Tap tempo on the `T` key or the topbar button, and the BPM readout is click-to-edit.
- **512-bar canvas visualizer** at ~30 fps with smoothing, themed from the same variables as the rest of the UI, and a GitHub Pages workflow that publishes the UI on every push to `main`.

### Changed

- Art-Net is the default output and universe `0` is the default universe, matching Art-Net and TouchDesigner convention. `fixture()`, `rgbStrip()` and `rgbwStrip()` all take an explicit universe argument, and the inline viz and sim panel read per-universe buffers.
- Fixture ids dropped the `generic-` prefix (`generic-rgbw` → `rgbw`). The old ids still resolve through an alias map, so existing scenes keep working. `moving-head-spot`'s `color` channel was renamed to `colorWheel` to free `.color()` for the generic helper.
- The scheduler runs off a Web Worker clock rather than a main-thread timer, and advances cycle position from elapsed wall-clock time. Output keeps flowing while the tab is backgrounded, and the send throttle is a time-based interval driven by the send-rate setting rather than a fixed tick count.
- `pixelGrid()` takes an array of rows (one inner array per pixel) instead of a flat channel array — missing channels default to 0.
- Loading a scene never auto-runs it. Switching, creating, saving-as, and resetting all stop output and wait for `Ctrl+Enter`, so a scene change can't flash unread code onto the rig or quietly undo a blackout.
- An audio-reactivity module (mic and file input, band splitting, beat detection) exists in `packages/core/src/audio.ts` but is not wired into the eval sandbox or the UI in this release; the scheduler retains the external clock hook it used.

### Fixed

- Art-Net packets were silently dropped by nodes — the OpCode was written in the wrong byte order (`0x5000` is low-byte-first). Corrected, so hardware accepts ArtDmx frames.
- A universe going dark left the rig stuck on its last value: the send path skipped any all-zero buffer, so commenting out the last pattern cleared the sim but never told the receiver. A universe that was live and is now all-zero now gets one trailing zero-frame — Art-Net, sACN and OSC receivers latch off, and stop-with-blackout actually clears hardware. Truly idle universes are still skipped.
- OSC output now sends zero-value updates when channels turn off, instead of leaving receivers on the last non-zero value.
- BPM drifted under load and varied with display refresh rate, because the old `setInterval` scheduler advanced cycle position by a fixed amount per tick. Cycle position is now derived from elapsed time, so 60, 120 and 144 Hz displays all keep accurate tempo.
- `mini()` and `m()` threw "mini is not a function" — they live in `@strudel/mini`, not `@strudel/core`. The package is now a core dependency, imported on demand, with a whitespace-splitting shim as a fail-soft fallback.
- Pattern decorations forced a layout reflow on every tick to restart their keyframes, which jittered output enough to visibly flicker physical Art-Net fixtures. The tick handler no longer touches layout.
- The bridge WebSocket tried `ws://<pagehost>:3001` when the UI was served from a public host, which never resolved. It now uses the page host only for localhost and private LAN ranges and falls back to loopback otherwise, so the hosted demo can drive a locally running bridge.
- The sim panel was hard-coded to one scene's channel layout and showed ghost fixtures after a scene switch; it is now rebuilt from the fixtures registered during the last eval. Its "off" state also reads the theme background instead of a hardcoded colour, so blackout looks dark on every theme.
- The `ultratronics 11` template called `spot.dim()` on an RGBW fixture that has no dimmer channel, throwing on every run. The instrument palette was remapped onto discrete colour channels, and stale copies saved in a browser are auto-upgraded on load.

[0.2.0]: https://github.com/nicholaspjm/lumen-dmx-live-code/releases/tag/v0.2.0
