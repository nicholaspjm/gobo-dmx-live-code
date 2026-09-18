# Contributing

gobo is open to contributions. Fixtures are the easiest and most useful place to
start. For anything else, open an issue first.

The app is **AGPL-3.0-or-later**, and a contribution to it is too. The connector
under `packages/bridge` is **MIT**, so it stays reusable by other lighting
projects. [GOVERNANCE.md](GOVERNANCE.md#why-agpl) says why it is split that way.

---

## What gobo is, and what that rules out

**gobo is a live-coding instrument that happens to drive DMX.** Not a lighting desk
with a scripting tab. Every feature, name and affordance is judged against
live-coding practice first, and a change that reads as desk-thinking needs a much
better argument than one that reads as code-thinking.

The distinction is not decoration. In live coding **the code is the interface** — the
performance is writing and evaluating it. A bar of pre-written looks you select
between is pre-composed playback with a selector, which is the thing live coding
defines itself against. Reach for the pattern before reaching for the button.

Seven invariants. A change that breaks one is wrong, however useful it looks:

1. **A failed evaluation is a no-op on the wire.** Compile before touching live
   state. A mistyped paren is a status-bar message, never a blackout.
2. **The panic verbs are absolute.** `Ctrl+.`, `Ctrl+Space` and `hush()` clear
   everything. No ownership scheme, layer or merge may spare a channel from them.
   This alone rules out every additive or union commit.
3. **The rig equals text you can point at.** Nothing may light a channel that no
   line on screen explains, and nothing may be turnable on that cannot be turned
   off by deleting a line.
4. **An evaluation is atomic and phase-preserving.** The swap happens at a tick
   boundary and the clock is never reset by a run, so re-running unchanged code is
   invisible on the rig. Much of the design rests on this — check it still holds
   before changing the eval path.
5. **What the performer set by hand survives a re-run; what the document declares
   does not.** Slider and picker positions, the cue selection, MIDI values and
   tempo persist. Channel definitions are rebuilt from scratch every time.
6. **Prefer a value read at query time over a reason to re-evaluate.** `slider()`,
   `midi()` and `pick()` are the model: the rig follows the hand without the
   document being run again.
7. **A guard that fires on the common case is a guard that gets ignored.** No
   feature may make the overwrite note, or any other warning, routine.

Keep strudel's vocabulary. gobo builds on `@strudel/core` and `@strudel/mini`, and a
pattern copied out of the strudel docs should run here. Renaming one of their verbs
makes this a dialect; the passthrough list in `packages/core/src/eval.ts` says so and
means it.

Desk affordances are not banned — the person using this is often a lighting operator
at a gig who cannot stop the song — but they belong **beside** the code-first path,
never as the only way to do something, and they should be honest about what they are.

---

## Fixture contributions

The public library is one JSON file per fixture in `fixtures/`, bundled into the app
at build time. Once yours is merged, every gobo user can write `fixture(1, 'your-id')`
without defining anything.

**Read [`fixtures/README.md`](fixtures/README.md) first.** It is the authoritative
format doc: schema, channel types, and the limits the validator enforces.

The flow:

1. Define it in the editor with `defineFixture('your-id', {…})` and hit `Ctrl+Enter`.
2. Open the **library** panel. Your fixture is listed under *Defined this session*.
3. Click **share**. That opens a GitHub new-file page with `fixtures/your-id.json`
   pre-filled; *Propose change* forks the repo and opens the PR for you. By hand
   instead: **export** downloads `your-id.gobo-fixture.json`, which you rename to
   `your-id.json` before dropping it in `fixtures/`. The validator rejects any file
   whose name isn't `<id>.json`.
4. CI runs `scripts/validate-fixtures.mjs` on every PR touching `fixtures/`, the same
   validator the app uses at runtime. Run it yourself first with
   `npx tsx scripts/validate-fixtures.mjs`.
5. A human reviews after that, mostly checking the channel map against the real
   fixture's DMX mode. Link the manual or mode chart in the PR description.

Merging to `main` also triggers the Pages deploy, so an accepted fixture is live on
the hosted app a few minutes later.

---

## Dev setup

Clone, `npm install`, `npm run dev`. The [README quick start](README.md#two-ways-to-run)
has the commands. `npm run dev` starts **both** workspaces: the UI on
http://localhost:3000 (Vite) and the bridge on ws://localhost:3001 (`tsx watch`,
restarts on save). CI builds on Node 20.

The rest of the scripts:

| Command | Does |
|---|---|
| `npm run dev:ui` / `npm run dev:bridge` | either half on its own |
| `npm run build` | UI production bundle → `dist/` (what Pages deploys) |
| `npm run preview` | serve that bundle locally |
| `npm run bridge:build` / `npm run bridge:start` | compile the bridge with `tsc`, then run it from `dist` |
| `npm run bridge:selftest` | send a known ramp straight to the wire, bypassing browser and bridge; `--help` for options |
| `npm test` / `npm run test:watch` | vitest |

Tests live next to the source they cover. The root `vitest.config.ts` scopes the
run to `packages/*/src/**/*.test.{ts,mts,js,mjs}`, so a test file anywhere else
won't be picked up. Coverage is thin: `dmx.ts` and `fixture-validator.ts` only.
More is welcome, especially anything pinning the timing path.

---

## Project layout

```
packages/core/     clock worker, scheduler, pattern eval, DMX state, WS client, fixtures. No DOM.
packages/bridge/   Node WebSocket server → Art-Net / sACN / OSC / mock UDP. Stateless: one frame in, one packet out.
packages/ui/       Vite frontend: CodeMirror editor, visualizer, sim panel, docs + library panels.
```

---

## Code contributions

**Open an issue before anything non-trivial.** gobo has opinions about the timing
path especially, and it's cheaper to disagree in an issue than in a 600-line diff.

- One change per PR.
- No formatter or lint churn mixed with logic changes. The repo has no lint step and
  no shared config, so match the style of the file you're editing: 2-space indent,
  single quotes, semicolons, explicit return types on exported functions.
- TypeScript throughout. `npm run build` bundles with Vite and does **not**
  type-check the UI; run `npx tsc --noEmit -p packages/ui` for that.
  `npm run bridge:build` is plain `tsc`, so it does. Both clean, plus `npm test`,
  before you open the PR.
- If you change user-facing API surface (fixture methods, pattern chain methods,
  globals in the eval context), update `packages/ui/src/help-data.ts` in the same PR,
  since autocomplete and hover help both read from it, plus `docs.ts` and the
  `METHOD_NAMES` list in `code-highlight.ts` where relevant.

---

## Testing hardware changes

Anything under `packages/bridge/src/`, `packages/core/src/websocket.ts`, or the send
throttle in the UI is the *wire path*: it can look correct in the visualizer and
still be wrong on the wire. The maintainer can't verify every interface and every
fixture, so say in the PR description what you tested against:

- **Real hardware.** Name the node and protocol, e.g. "Enttec ODE Mk3, Art-Net
  unicast, 2 universes".
- **No hardware.** Set `"mode": "mock"` in `packages/bridge/bridge.config.json` (or
  call `mock()` in the editor) and the bridge prints the non-zero channels of every
  seventh frame, which confirms frames are produced and channels land where you
  expect. `npm run bridge:selftest` covers the other half: it emits a known ramp
  directly, so you can point a capture or a node at it without the browser in the
  picture.
- **Packet layout changes.** A Wireshark capture or the receiving node's own
  diagnostics. Nothing else proves the bytes.

---

## Commits

Imperative subject line, blank line, then a body explaining *why*; the diff already
says what. Area prefix when it helps scope the change:

```
Bridge: send one zero-frame when a universe goes dark

The send path skipped any universe whose entire buffer was zero, which
meant commenting out the last pattern on a fixture left the physical
rig stuck on its last value. …
```

Wrap the body around 72 columns. `git log` is the reference; match what's there.
