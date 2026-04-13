# DMX Live-Code Project - Overnight Build Progress

## Project Goal
A browser-based live-coding environment for DMX lighting (ArtNet/sACN/USB).
Inspired by Strudel's pattern engine + UI, but focused purely on lighting with
an earth-tone minimal aesthetic inspired by aself.online.

## Aesthetic Reference
- aself.online: minimal, personal, warm earth tones
- Think: dark warm charcoal bg (#1a1714), warm cream text (#e8dfd0), muted terracotta/amber accents (#c4724a, #b8956a), soft sage (#7a8c6e)
- Typography: monospace for code, minimal sans for UI
- No harsh black/white — everything has warmth
- Strudel-inspired layout: full editor, visualizer underneath/beside

## Architecture Plan
- **Frontend:** Vite + vanilla JS/TS (no framework overhead)
- **Editor:** CodeMirror 6
- **Pattern engine:** @strudel/core (cycle/pattern math only)
- **Visualizer:** Canvas 2D (channel strip + mini timeline)
- **Bridge:** Node.js WebSocket server → ArtNet UDP / sACN / serial DMX
- **Config:** JSON fixture definitions, hot-reloadable

## DMX Interface Support
- ArtNet (UDP, most common)
- sACN (E1.31, pro venues)
- Mock/test output (no hardware needed for dev)

## Build Phases

### Phase 1: Research + Scaffold ✅ DONE
- [x] Research @strudel/core API (Pattern, mini, cycle evaluation)
- [x] Research ArtNet protocol specifics (UDP port 6454, packet format)
- [x] Research sACN (E1.31) basics
- [x] Scaffold Vite project with CodeMirror 6
- [x] Set up monorepo structure (packages/core, packages/bridge, packages/ui)
- [x] Apply earth-tone CSS theme
- [x] Git init + initial commit

### Phase 2: Pattern Engine + Eval ✅ DONE
- [x] Integrate @strudel/core
- [x] Build DMX output functions: ch(), uni(), dim(), rgb()
- [x] Safe eval sandbox (new Function() with controlled context)
- [x] Clock/scheduler at 44hz
- [x] Map pattern values → DMX channel values (0-255)

### Phase 3: Visualizer ✅ DONE
- [x] Channel strip (512 bars, live updating)
- [x] Active channel highlighting
- [x] Smooth animation (exponential interpolation)
- [x] Channel number labels every 64 channels

### Phase 4: ArtNet Bridge ✅ DONE
- [x] Node.js WS server (ws://localhost:3001)
- [x] ArtNet UDP packet sender (raw dgram, no dependencies)
- [x] sACN E1.31 sender (raw UDP, full packet implementation)
- [x] Mock output (logs to console)

### Phase 5: Fixture System ✅ DONE
- [x] JSON fixture definition format (FixtureDef / ChannelDef interfaces)
- [x] Built-in library: generic-dimmer, generic-rgb, generic-rgbw, generic-rgba, generic-dim-rgb, moving-head-basic, moving-head-spot, strobe-basic
- [x] User-defined fixtures via defineFixture()
- [x] Named channel access: fixture(1, 'generic-rgb') → par.red(v) / par.green(v) / par.blue(v)
- [x] fixture() / defineFixture() / listFixtures() exposed in eval sandbox

### Phase 6: Polish + Docs ✅ DONE
- [x] Full README with setup guide
- [x] Example patterns
- [x] Interface config guide (how to set up each DMX interface)
- [x] Keyboard shortcuts
- [x] Error display in UI

## Current Status
🚀 v0.2 complete — fixture system added

```bash
npm install
npm run dev
```

## Notes / Decisions
- Using @strudel/core not forking — it's stable and the pattern math is solid
- Mini-notation syntax from Strudel kept as-is (why reinvent?)
- Adding DMX-specific functions on top
- Project name: **lumen**
- Eval sandbox uses new Function() with DMX + strudel fns in scope
- Scheduler runs in the browser (setInterval at 44hz), bridge is dumb output router
- ArtNet + sACN implemented from raw UDP (no extra npm deps)
- Graceful fallback waveforms if @strudel/core doesn't load

## Files Created
```
package.json
README.md
PROGRESS.md
packages/
  core/
    package.json
    tsconfig.json
    src/index.ts
    src/scheduler.ts
    src/dmx.ts
    src/eval.ts
    src/websocket.ts
    src/fixtures.ts
  bridge/
    package.json
    tsconfig.json
    bridge.config.json
    src/index.ts
  ui/
    package.json
    tsconfig.json
    vite.config.ts
    index.html
    src/main.ts
    src/editor.ts
    src/visualizer.ts
    src/theme.ts
```
