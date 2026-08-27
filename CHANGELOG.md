# Changelog

All notable changes to gobo are recorded here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

> **A blackout that did not black out.** `.off()` walked six hardcoded channel
> names, so a blinder whose bulbs are called warm/cold matched none of them: both
> stayed lit and the call reported success. Which channels emit light is now
> derived from the fixture rather than from a list.
>
> **A channel write that could not work used to look like one that did.**
> `wash.red()` stored nothing, read as 0, and left the status bar green, so the
> light was off and the tool said the scene was running. Naming a channel and no
> level now means full, and a value that is not a number or a pattern stops the
> evaluation with the channel named.

### Added

- **`.color()` on a strip.** The same call as `.fill()`, under the word every
  other light here answers to: a par takes `.color(red)`, a group takes
  `.color(red)`, and a strip took only `.fill()`, so a scene had to remember
  which kind of light it was addressing. Both spellings stay and both are the
  same function. A mono strip gains neither, having no colour to set.
- **The colour types admit what the code always accepted.** `.fill()` and
  `.chase()` took a palette long before their declarations did, and
  `group.color()` did not admit even a single colour though it spread whole
  palettes, so a scene that ran correctly failed to typecheck. One shared
  `ColorRunArgs` now describes every spelling, in one place.
- **An omitted value means full.** `wash.red()`, `spot.dim()`, `ch(5)`,
  `bar.pixels.fill()`: the shortest way to bring something up is to name it.
  Works on every setter, on `.color()` and `.fill()` (full white), and on the
  low-level `ch()` / `uni()` / `dim()` / `rgb()`.
- **`group(...)`.** Fixtures, strips and a fixture's `.pixels` addressed as one,
  answering the same verbs a single fixture does. `group(washA, washB,
  bar.pixels).each(p => sine().early(p).slow(4))` runs one phase ramp across a
  mixed rig in written order, which could not be written at any length before: a
  strip had `each()`, a bar's pixels had `each()`, and pars had neither. A
  fixture counts as one element however many channels it has, and a strip counts
  one per pixel, so pass the fixture to move it as a unit and its `.pixels` to
  move the pixels. Nested groups flatten. A role only some members have is
  applied to those; a role no member has throws, since it would otherwise be a
  silent no-op.
- **A single-value `.each()` means brightness, expressed however the element
  can.** A fixture with a dimmer moves the dimmer and keeps its colour, one
  without drives r/g/b together, and a pixel does the same. A fade across a mixed
  rig therefore does not repaint the look.
- **About thirty operators documented that already worked and were invisible.**
  `struct`, `mask`, `segment`, `every`, `iter`, `chunk`, `rev`, `palindrome`,
  `ply`, `linger`, `late` / `early`, `rangex`, a backwards `range`, `add` / `mul`
  taking patterns, `superimpose`, `off`, `echoWith`, `euclid`, `euclidRot`,
  `degradeBy`, `sometimesBy`, `swingBy`, `@` weight, `!` replicate, and `{}`
  polymeter. Every example in the reference panel was run against the engine
  before being written down.
- **How to write something longer than a bar**, which was the gap behind most of
  the above. A mini string is one cycle however it is typed, so a backtick string
  laid out eight tokens to a line and chained `.slow(8)` gives one bar per line.
  That is byte-identical to `cat()` of the same bars and far easier to read.
- **Strips can be grids.** A pixel wash is usually a rectangle, and addressing
  one meant hand-writing `i % 12` and `Math.floor(i / 12)` in every scene. Pass
  `columns` to `rgbStrip` / `rgbwStrip`, or declare it on a fixture's strip
  channel so the shape travels with the fixture, and the strip gains `width`,
  `height`, `pixelXY`, `row`, `column` and `eachXY`. A plain strip is the same
  model with a single row, so nothing needed a special case. A width that does
  not divide the pixel count is refused at patch time, since the ragged row
  would put every position after it on the wrong pixel.
- **`serpentine`**, for a matrix folded out of one strip so its odd rows run
  backwards. Nothing in the channel count reveals this, so the fixture declares
  it; without it every other row is mirrored and it only shows on the hardware.
- **Named slots on selector channels.** A moving head picks colour, gobo and
  prism by driving one channel into a documented range, so scenes read
  `set('color', 37)` with the manual open beside them. A channel can now declare
  `slots`, and the setter takes a name: `head.color('red')`, `head.gobo('dots')`.
  A range aims at its middle, because hardware often treats a boundary as
  belonging to the neighbouring slot. Patterns of names work too, so a wheel can
  step per bar. `head.slots('color')` lists them.

### Changed

- **`.color()` reads a channel name the way `.off()` and `.full()` always did.**
  It compared names to the literals `red`, `green`, `blue` and `white`, while
  the emitter calls read a name through the same normaliser that lowercases it,
  drops separators and drops a trailing number. So one definition answered one
  call and refused the other: a fixture wired `Red_1` / `Green_1` / `Blue_1` lit
  under `.full()` and threw under `.color()`, reporting that it had no red,
  green or blue channels while naming those three in the message. The initials
  `r`, `g`, `b` and `w` are accepted too, but only on a channel declared
  `type: 'color'`, because `g` is as likely to be a gobo wheel as it is green.
  `.off()` and `.full()` read that same rule, so whatever `.color()` can paint a
  blackout can darken. Widening one reader and not the other is how this
  asymmetry arrived; doing it again in the other direction would have left an
  `r`/`g`/`b` fixture lit straight through a blackout.
- **A run of colours spreads across a fixture that has pixels to spread it
  over.** `wash.color(warm)` and `wash.color(red, blue)` used to be refused on
  the reasoning that one light is one position, whether that light is a par or
  48 pixels behaving as one. The pixels won the argument: `.fill()` on the strip
  underneath had spread a run across them all along, so the fixture answered one
  word and not the other. A par is still one position and still refuses, naming
  `warm[0]` and `cat(...warm).slow(4)` as before.

- **Layered patterns merge highest-takes-precedence**, the same as a lighting
  desk. `tick()` read the first value on a channel and dropped the rest, so
  `stack()`, a comma inside `mini()`, `superimpose()` and `off()` silently
  discarded every layer after the first: `stack(0.25, 0.75)` put 64 on the wire.
  Adding a layer can now raise a channel but never darken one. The reference
  panel claimed the *last* value won, which was wrong in the other direction.
- **A value that is not a number or a pattern is rejected with the channel
  named.** A quoted number, a signal that was never called (`sine` rather than
  `sine()`), `null`, `NaN`, `±Infinity`: all stored fine and read as 0 on every
  tick. The message says what arrived and what to write instead. The evaluation
  is transactional, so the rig keeps running the scene it already had.
- **A colour is written whole or not at all.** `rgb(1, 0.5)` used to set green
  and blue to 0; it now says it needs all three, or none for full white. Same for
  `.color()` and `.fill()`.
- **What counts as a light-emitting channel** comes from the fixture's own
  declaration: `type: 'intensity'`, or a name matching a colour role, with that
  role list widened well past red/green/blue/white/amber/dim to cover warm, cold,
  uv, lime, cyan, magenta and the rest, numbered variants included. A warm/cold
  blinder now answers `.off()` and `.full()`.
- **A channel carrying slots never counts as emitting**, so `.off()` and
  `.full()` leave a colour wheel exactly where it is, the way they already leave
  pan and tilt. A blackout no longer spins the wheel to whatever sits at 255.
- **`.off()`, `.full()` and `.color()` throw when they would apply to nothing**
  rather than returning quietly. That silence is what let the blinder bug live.

## [0.3.0] - 2026-08-17

> **Licence: MIT → AGPL-3.0-or-later.** The app bundles `@strudel/core`, which is
> AGPL, so MIT was never a valid description of the distributed app. The connector
> (`packages/bridge`) stays MIT.
>
> **Upgrade from 0.2.0 for the blackout alone.** A closed tab used to leave the rig
> lit on its last look. The bridge now sends one zero frame per live universe when
> the last client disconnects.
>
> **Two of the six outputs work in a plain browser.** `usb()` drives an Enttec style
> box over WebSerial (Chrome or Edge, one universe), and `td()` hands frames to
> TouchDesigner, which sends the Art-Net itself. `artnet()`, `sacn()`, `osc()` and
> `mock()` leave as UDP packets, which a page cannot send, so they need the
> connector or the desktop build. OSC is not the install-free option it looks like:
> it is the same kind of packet as Art-Net.

### Added

- **Desktop build** (`packages/desktop`) running the bridge inside the app and
  serving the UI from it, so `artnet()`, `sacn()`, `osc()` and `mock()` work with
  nothing else installed and the page's WebSocket is same origin. `contextIsolation`
  on, `nodeIntegration` off, sandbox on, navigation confined to the app's own
  origin, and a frozen `{ desktop, version }` as the only thing crossing into the
  page. Build and run it from a checkout with `npm run desktop`, or take an
  installer from the release page: `.exe` on Windows, `.dmg` on macOS,
  `.AppImage` on Linux, built on a tag by the release workflow. None of them is
  signed, so Windows SmartScreen and macOS Gatekeeper warn on first run.
- **A run whose output nothing is listening for now says so on that run.**
  `artnet()`, `sacn()`, `osc()` and `mock()` with no connector on the machine
  used to run clean and light nothing, and the only sign was a status line some
  seconds later saying the target was never reached, which reads as a fault in
  the rig. `evalCode` now returns a `warning` beside the successful result,
  naming the cause and the fix, and logs it to the console. The scene still runs:
  the patterns are live and only the wire is silent.
- **Four fixtures in the public library.** `fixtures/` shipped with nothing in it
  in 0.2.0. It now holds `par-rgbw-7ch`, `moving-head-wash-14ch` (16-bit
  pan/tilt), `strobe-4ch` and `pixel-bar-rgbw-8` (eight RGBW pixels across 34
  channels). They are bundled at build time and registered on startup, so
  `fixture(1, 'par-rgbw-7ch')` resolves without opening the library panel.
- **Outputs panel.** The connection light in the top bar is now a button that opens
  a list of all six outputs, each with what it is and whether it can carry light
  right now. A lock badge appears beside it while the scene's chosen output needs a
  program that is not running.
- **One table for output capability**, `packages/ui/src/outputs.ts`. The top bar,
  the panel and the connector prompt all read their answers from it, so no second
  place can disagree about what works where.
- **Two install routes for the connector** that skip the SmartScreen warning the
  downloaded exe raises: `npx gobo-connector` for anyone with Node (14.7 kB of
  JavaScript rather than 87 MB of bundled runtime), and `winget install
  nicholaspjm.gobo` on Windows 11. `npm run winget` writes the three manifests,
  hashing the bytes of the published release. Both routes work once the package is
  published to npm and the manifests are accepted into `microsoft/winget-pkgs`.
- **Art-Net node discovery in `npm run doctor`.** It sends an ArtPoll and reports
  every node that answers, with its name and the universes it listens on, since
  "the addresses are right but nothing arrives" is usually a universe mismatch.

### Changed

- **Licence is now AGPL-3.0-or-later**, replacing MIT, because the app bundles
  `@strudel/core` and a work containing it cannot be distributed under MIT terms.
  Section 13 also covers running a modified version as a network service, which is
  the relevant case for a browser tool. `packages/bridge` stays MIT: it imports no
  Strudel and depends only on `ws`, so other lighting projects can reuse it. Added
  GOVERNANCE.md recording that there is no contributor licence agreement and will
  not be one.
- **Default send rate is 40 Hz**, was 60. DMX512 carries at most about 44 frames a
  second, so 60 asked the wire for more than it can pass. The options are now
  25 / 30 / 40 / 44, and a stored 60 migrates to 40, a stored 120 to 44.
- **The connector banner no longer offers the download to people who have one.**
  Once a bridge has connected in this browser, the banner says the connector is not
  running and that it normally starts itself at login, rather than selling a file
  they already installed.

### Fixed

- **The rig blacks out when the app disconnects.** A closed tab, a crashed browser
  or a shut laptop lid ends the WebSocket without a final frame, and DMX receivers
  hold their last value indefinitely. The bridge now tracks which universes have
  carried data and sends one zero frame each when the last client goes.
- The connector prompt fired before the WebSocket had a chance, so pressing
  `Ctrl+Enter` as the page loaded told a working setup that nothing was listening.
  There is now a 2.5s grace period, cancelled if the bridge turns up during it.
- `onStatusChange` and `onUsbStatusChange` each held one callback rather than a
  list, so registering a second listener silently replaced the first and the top-bar
  connection dot stopped updating. Both are Sets now.
- `td()` pointed at anything other than localhost from an https page threw out of
  `evalCode` rather than returning a failed result. The mixed-content check ran
  at flush time, in the `finally` that runs after the scene has been committed,
  so the caller got no error to show and a half-configured scene was already
  live. The check now runs when the call is staged, which makes it an ordinary
  scene error that rolls back with the rest of the run.
- The README licence badge still read MIT after the relicence.

## [0.2.0] - 2026-08-12

> **Renamed: lumen → gobo.** The project, the workspace packages (`@gobo/core`,
> `@gobo/bridge`, `@gobo/ui`), the repository and the hosted app all changed name.
> The hosted build now lives at https://nicholaspjm.github.io/gobo-dmx-live-code/.
> Three consequences:
>
> - **OSC addresses are now `/gobo/<universe>/<channel>`**, not `/lumen/…`. Any OSC
>   receiver matching the old prefix, a TouchDesigner patch included, goes quiet until
>   it is repointed. See [docs/touchdesigner.md](docs/touchdesigner.md).
> - **The sACN source name is now `gobo`.** Receivers that identify or filter senders
>   by source name need updating. Nothing else about the wire format moved.
> - **Fixtures and settings saved in your browser migrate automatically.** On first
>   load the app adopts anything stored under the old `lumen-fixtures-v1` and
>   `lumen-settings-v1` localStorage keys and rewrites it under `gobo-*`. Fixture
>   files you exported earlier still import: the old `lumenFixture` schema field is
>   accepted as a deprecated alias alongside `goboFixture`. Saved *scenes* are not
>   adopted, because the scene model changed in this release; they are offered as
>   file downloads instead (see below).

First public release. There was never a published 0.1.0. Everything below landed during pre-0.2 development, and the commit-level detail for that period is in git.

### Added

- **Pattern engine.** `sine()`, `cosine()`, `square()`, `saw()`, `rand()` built on [@strudel/core](https://strudel.cc), with the usual chain methods (`.slow` / `.fast` / `.range` / `.add` / `.mul` / `.early` / `.late`). Patterns are sampled once per tick and written straight into DMX buffers. If strudel fails to load, evaluation is refused with a clear message rather than degrading to approximate waveforms.
- **Mini-notation sequencing.** `mini()` / `m()` from `@strudel/mini`, plus `sequence()`, `cat()`, `stack()`. Write a drum grid per channel (`spot.white(mini('1 - - 1'))`) instead of hand-rolling envelopes.
- **`register(name, fn)`.** Define custom chain methods from editor code. They attach to the Pattern prototype and survive `.slow()` / `.fast()` / `.add()` chains.
- **Fixture system.** `fixture(startChannel, id, universe)` returns one setter per named channel. Built-in profiles: `dim`, `rgb`, `rgbw`, `rgba`, `dim-rgb`, `dim-rgbw`, `moving-head-basic`, `moving-head-spot`, `strobe`. `defineFixture(id, def)` declares custom profiles inline.
- **Standard fixture API.** `.color(r, g, b[, w])`, `.off()` and `.full()` on every instance, built-in or custom. `.color()` skips channels the fixture lacks, so one line works across rgb / rgbw / dim-rgbw / moving heads; `.off()` zeroes light-emitting channels only, leaving pan / tilt / gobo aim intact. `.set(name, value)` and `.channels()` complete the generic surface.
- **Pixel strips.** `rgbStrip()` and `rgbwStrip()` primitives, or a `{ type: 'strip', pixelCount, pixelLayout }` channel embedded inside a `defineFixture()` profile. Per-pixel helpers: `.fill()`, `.pixel(i, …)` (monochrome or full colour), `.each((phase, i, count) => …)`, `.pixelGrid([[…], […]])` with `.repeat()` / `.hold()` / `.mirror()` fill modes, and a built-in `.rainbowChase()`.
- **Low-level DMX.** `ch()`, `uni()`, `dim()`, `rgb()` address raw channels. 512 channels per universe, any number of universes.
- **One working scene, autosaved.** The editor holds a single document, written to localStorage on a short debounce (switchable under **autosave** in settings), so a refresh or a crash costs nothing. Click the name in the top bar to rename it; a dot appears while the buffer holds changes that are not in a file. A brand-new browser is seeded from the first bundled example.
- **Scene files.** **save** writes the scene to a `.js` file (`Ctrl+S`); **open** reads one back. The file is the code and nothing else. A scene is JavaScript, so keeping it as JavaScript means it opens with syntax highlighting in any editor and diffs line by line, instead of being escaped into a JSON string. The name comes from the filename, the save time from the file's own timestamp. `.txt` files and the `.gobo` files earlier builds wrote open too: the choice is made on content rather than on the extension, so a renamed file still lands correctly.
- **Share links.** **share** copies a URL whose fragment carries the entire scene: JSON, deflated through the browser's native `CompressionStream`, base64url-encoded. There is no server and no registered id, so a link cannot expire or 404, and the fragment is never sent in an HTTP request. Long scenes make long links; the status bar reports the character count and warns past the point where chat clients and mail gateways start truncating. A link carries the code and the name only, not fixtures or settings.
- **Examples menu.** The three bundled demos (starter demo, `ultratronics 11`, four-colour bar demo) live in source as read-only content and load into the working buffer on request. `ultratronics 11` is a live-performance template built around real onset and section analysis of the track.
- **Guards on anything that replaces the buffer.** Opening a file, loading an example and following a share link all land stopped, waiting for `Ctrl+Enter`, and all prompt first when the buffer holds changes that were never saved to a file.
- **Provenance banner for shared scenes.** Scene code is not sandboxed, so a scene that arrived in a link never auto-runs. A banner states where it came from and what running it grants, until the user runs it or dismisses it. See [SECURITY.md](SECURITY.md#share-links-carry-someone-elses-code-into-your-browser).
- **Fixture library panel.** Four tiers in one list: built-in profiles, public fixtures bundled from `fixtures/*.json` at build time, fixtures saved to the browser, and session-only ones declared by `defineFixture()`. Import and export as JSON; a share button opens a pre-filled GitHub new-file URL, so proposing a fixture for the public library is one click.
- **Fixture validation.** Every fixture coming in from a file or the bundle runs through a strict validator, which rejects id collisions with built-ins, out-of-range sizes, unknown schema keys and unsafe characters. CI runs the same validator on any PR touching `fixtures/`.
- **Inline visualizations.** `.viz('color' | 'wave' | 'meter' | 'strip')` on a fixture or strip drops a live widget at the end of the source line, and `.flash()` / `.glow()` / `.wave()` decorate any pattern in place. Both are opt-in per call and driven from the scheduler tick, so they stay phase-locked with output.
- **Fixture simulator.** A panel rebuilt after every eval from the fixtures the scene declares, rendering RGB/RGBW globes, dimmer globes and pixel strips. Hover tooltips show name, type, universe, channel range and live values. Fixtures with `pan` / `tilt` / `direction` channels get a small XY indicator tracking their position.
- **Docs and hover help.** A tabbed reference panel (welcome / patterns / fixtures / viz / output / reference) with ranked search, plus hover tooltips giving signature, description and example for any gobo identifier. Autocomplete and hover help are generated from the same help source, and the editor highlights gobo commands and fixture-bound identifiers semantically.
- **Settings and themes.** Sliding settings panel with theme, stop action (blackout or freeze), autosave, format-on-run, inline viz, sim tooltips and send rate (30 / 60 / 120 Hz). Thirteen themes: `tungsten`, `moonbox`, `greenroom`, `blacklight`, `bastardAmber`, `blackout`, `glowtape`, `safelight`, `patchbay`, `cyclorama`, `surprisePink`, `worklight`, `followspot`. They swap instantly because the editor and canvas read CSS variables. The names come from stage lighting: a moonbox is the cold fixture hung to fake moonlight, bastard amber and surprise pink are real Rosco gels, glow tape is the photoluminescent strip on a stage edge. A theme chosen before the rename is migrated to its new id, so nobody's setting resets.
- **Semantic syntax highlighting.** The editor colours 24 categories of token rather than two. A fixture being declared reads differently from the same fixture being driven, colour setters carry a hint of their own channel's hue, and editor-only decorations (`.viz` / `.flash`) are italic and quiet because they change nothing on the rig. Output calls (`artnet()` / `sacn()` / `osc()`) are the loudest thing in the buffer, since they decide where light physically goes. Every colour is held at 4.5:1 contrast or better against its theme's background.
- **Output paths.** A Node bridge on `ws://localhost:3001` fans DMX out over Art-Net, sACN (E1.31), OSC, or a mock console logger. `artnet()`, `sacn()`, `osc()` and `mock()` reconfigure it at runtime from editor code. OSC sends `/gobo/<universe>/<channel>` with one float in 0-1, which an OSC In CHOP picks up directly for TouchDesigner work.
- **Editor keybindings.** `Ctrl+Enter` eval, `Ctrl+.` stop, `Ctrl+Space` as a second stop alias that preempts autocomplete, `Ctrl+S` save the scene to a file, `Ctrl+Shift+F` format via a lazily loaded Prettier. Tap tempo on the `T` key or the topbar button; the BPM readout is click-to-edit.
- **512-bar canvas visualizer** at ~30 fps with smoothing, themed from the same variables as the rest of the UI, and a GitHub Pages workflow that publishes the UI on every push to `main`.

### Changed

- Art-Net is the default output and universe `0` is the default universe, matching Art-Net and TouchDesigner convention. `fixture()`, `rgbStrip()` and `rgbwStrip()` all take an explicit universe argument, and the inline viz and sim panel read per-universe buffers.
- Fixture ids dropped the `generic-` prefix (`generic-rgbw` → `rgbw`). The old ids still resolve through an alias map, so existing scenes keep working. `moving-head-spot`'s `color` channel was renamed to `colorWheel`, freeing `.color()` for the generic helper.
- The scheduler runs off a Web Worker clock rather than a main-thread timer, and advances cycle position from elapsed wall-clock time. Output keeps flowing while the tab is backgrounded, and the send throttle is a time-based interval driven by the send-rate setting rather than a fixed tick count.
- `pixelGrid()` takes an array of rows (one inner array per pixel) instead of a flat channel array. Missing channels default to 0.
- **The multi-scene dropdown is gone, replaced by one working buffer plus files.** There is no scene list, no save-as, no rename-in-a-menu, no delete, no protected `default` and no reset-to-seed. The demo scenes are no longer seeded into storage as saved scenes; they are read from source through the **examples** menu. Scenes you saved under the old model are offered as `.js` downloads through a one-time notice, one button each plus a "download all" that spaces the files out so the browser does not block them. **The old storage is left completely intact.** `gobo-scenes-v1` (or its `lumen-scenes-v1` predecessor) is read to build that list and nothing more; `gobo-active-scene-v1` and `gobo-scene-meta-v1` are not touched at all. None of them is written, deleted or cleaned up, including after the notice is dismissed. The new buffer keeps its own keys (`gobo-buffer-*`). `Ctrl+Shift+S`, previously save-as, is no longer bound; with no other scenes to save as, it falls through to the browser.
- Loading a scene never auto-runs it. Opening a file, loading an example and following a share link all stop output and wait for `Ctrl+Enter`.
- An audio-reactivity module (mic and file input, band splitting, beat detection) exists in `packages/core/src/audio.ts` but is not wired into the eval sandbox or the UI in this release. The scheduler retains the external clock hook it used.

### Fixed

- **sACN output was non-conformant and dead by default.** `fixture()`, `rgbStrip()` and `rgbwStrip()` default to universe 0, which E1.31 reserves, so conformant receivers dropped every packet. Scene universe 0 is now remapped to a legal wire universe (the base set by `sacn(base)`, default 1); every other scene universe goes out unchanged, so `ch()`/`dim()`/`rgb()` and any explicit `uni()` still land where they always did. The base is validated against the legal 1-63999 range, and a base that collides with a directly-used scene universe warns rather than silently interleaving two scenes onto one wire universe.
- `sacn(universe, priority)`'s first argument was stored, printed in the log, then ignored by the sender, so the bridge confirmed a universe it was not using. It now sets the base universe described above, and the log states the actual mapping.
- sACN sequence numbers were counted process-wide instead of per universe, contrary to E1.31 §6.2.5. With more than one universe live, receivers discarded frames as out-of-order. Each universe now carries its own counter.
- A failed evaluation blacked out the rig. `evalCode` cleared all state before it knew the code even parsed, so a stray paren drove every channel to zero, and the going-dark logic pushed that blackout to real hardware. Evaluation is now transactional: the code is compiled first, channel writes are staged, and a failure leaves the previous scene running untouched. Output-switching calls (`artnet()` / `sacn()` / `osc()` / `mock()`) and `setBPM()` are held with it, so a scene that switches output and then throws no longer strands the bridge somewhere the running scene never asked for.
- A single throwing pattern froze the whole rig. `register()` bodies run lazily at query time, and one throw aborted the frame after the buffers had been zeroed: no frame sent, rig latched on its last look, status bar still showing a green check. Each channel is now resolved independently. A failing channel goes dark, every other channel keeps running, and the status bar reports which channel is failing and keeps reporting it.
- `setBPM(NaN)`, reachable from a typo like `setBPM(base * undefinedVar)`, permanently poisoned the clock, and correcting the BPM afterwards did not recover it. Non-finite values are now rejected, and the tick self-heals if the cycle position is ever left non-finite by any route.
- The bridge had no error handlers at all: a typo'd host in `osc()`, a port already in use, or a client vanishing mid-frame killed the process. Every socket and server now handles errors, send failures are explained in plain language and rate-limited, and a dropped frame no longer takes down the process.
- An unrecognised output mode (a typo like `artnett` in the config file or a runtime call) silently routed everything to console logging while printing a confirmation. Invalid modes are now rejected loudly, naming the bad value and the valid set, and a bad runtime message keeps the current working output rather than taking it away mid-show.
- `fixture()` accepted a patch that ran past channel 512 or started below 1, silently dropping the overflow. It now rejects the patch and says which fixture overran and by how much, matching the guard the strip helpers already had.
- Art-Net packets were silently dropped by nodes, because the OpCode was written in the wrong byte order (`0x5000` is low-byte-first). Corrected, so hardware accepts ArtDmx frames.
- A universe going dark left the rig stuck on its last value: the send path skipped any all-zero buffer, so commenting out the last pattern cleared the sim but never told the receiver. A universe that was live and is now all-zero gets one trailing zero-frame, which latches Art-Net, sACN and OSC receivers off and makes stop-with-blackout clear hardware. Idle universes are still skipped.
- OSC output now sends zero-value updates when channels turn off, instead of leaving receivers on the last non-zero value.
- BPM drifted under load and varied with display refresh rate, because the old `setInterval` scheduler advanced cycle position by a fixed amount per tick. Cycle position is now derived from elapsed time, so 60, 120 and 144 Hz displays all keep accurate tempo.
- `mini()` and `m()` threw "mini is not a function"; they live in `@strudel/mini`, not `@strudel/core`. The package is now a core dependency, imported on demand, with a whitespace-splitting shim as a fail-soft fallback.
- Pattern decorations forced a layout reflow on every tick to restart their keyframes, which jittered output enough to visibly flicker physical Art-Net fixtures. The tick handler no longer touches layout.
- The bridge WebSocket tried `ws://<pagehost>:3001` when the UI was served from a public host, which never resolved. It now uses the page host only for localhost and private LAN ranges and falls back to loopback otherwise, so the hosted demo can drive a locally running bridge.
- The sim panel was hard-coded to one scene's channel layout and showed ghost fixtures after a scene switch. It is now rebuilt from the fixtures registered during the last eval. Its "off" state also reads the theme background instead of a hardcoded colour, so blackout looks dark on every theme.
- The `ultratronics 11` template called `spot.dim()` on an RGBW fixture that has no dimmer channel, throwing on every run. The instrument palette was remapped onto discrete colour channels. The fixed version is the one in the **examples** menu; a copy you saved under the old scene model still holds the broken call, so re-load the example if you kept one.

[0.3.0]: https://github.com/nicholaspjm/gobo-dmx-live-code/releases/tag/v0.3.0
[0.2.0]: https://github.com/nicholaspjm/gobo-dmx-live-code/releases/tag/v0.2.0
