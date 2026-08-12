# Contributing

gobo is MIT-licensed and open to contributions. Fixtures are the easiest and most
useful place to start — everything else, open an issue first.

---

## Fixture contributions

The public library is one JSON file per fixture in `fixtures/`, bundled into the app
at build time. Getting yours merged means every gobo user can write
`fixture(1, 'your-id')` without defining anything.

**Read [`fixtures/README.md`](fixtures/README.md) first** — it's the authoritative
format doc: schema, channel types, and the exact limits the validator enforces.

The flow:

1. Define it in the editor — `defineFixture('your-id', {…})` — and hit `Ctrl+Enter`.
2. Open the **library** panel. Your fixture is listed under *Defined this session*.
3. Click **share**. That opens a GitHub new-file page with `fixtures/your-id.json`
   pre-filled; *Propose change* forks the repo and opens the PR for you.
   Doing it by hand instead? **export** downloads `your-id.gobo-fixture.json` —
   rename it to `your-id.json` before dropping it in `fixtures/`. The validator
   rejects any file whose name isn't `<id>.json`.
4. CI runs `scripts/validate-fixtures.mjs` on every PR touching `fixtures/` — the
   same validator the app uses at runtime. Run it yourself first with
   `npx tsx scripts/validate-fixtures.mjs`.
5. A human reviews after that, mostly checking the channel map against the real
   fixture's DMX mode. Link the manual or mode chart in the PR description.

Merging to `main` also triggers the Pages deploy, so an accepted fixture is live on
the hosted app a few minutes later.

---

## Dev setup

Clone, `npm install`, `npm run dev` — the [README quick start](README.md#with-hardware-local-dev)
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
| `npm run bridge:selftest` | send a known ramp straight to the wire, bypassing browser and bridge — `--help` for options |
| `npm test` / `npm run test:watch` | vitest |

Tests live next to the source they cover. The root `vitest.config.ts` scopes the
run to `packages/*/src/**/*.test.{ts,mts,js,mjs}`, so a test file anywhere else
won't be picked up. Coverage is thin — `dmx.ts` and `fixture-validator.ts` only.
More is very welcome, especially anything pinning the timing path.

---

## Project layout

```
packages/core/     clock worker, scheduler, pattern eval, DMX state, WS client, fixtures — no DOM
packages/bridge/   Node WebSocket server → Art-Net / sACN / OSC / mock UDP — stateless, one frame in, one packet out
packages/ui/       Vite frontend — CodeMirror editor, visualizer, sim panel, docs + library panels
```

---

## Code contributions

**Open an issue before anything non-trivial.** gobo has opinions about the timing
path especially, and it's cheaper to disagree in an issue than in a 600-line diff.

- One change per PR. A focused diff gets reviewed; a grab-bag doesn't.
- No formatter or lint churn mixed with logic changes. The repo has no lint step and
  no shared config, so match the style of the file you're editing — 2-space indent,
  single quotes, semicolons, explicit return types on exported functions.
- TypeScript throughout. `npm run build` bundles with Vite and does **not**
  type-check the UI — run `npx tsc --noEmit -p packages/ui` for that.
  `npm run bridge:build` is plain `tsc`, so it does. Both clean, plus `npm test`,
  before you open the PR.
- If you change user-facing API surface — fixture methods, pattern chain methods,
  globals in the eval context — update `packages/ui/src/help-data.ts` in the same PR
  (autocomplete and hover help both read from it), plus `docs.ts` and the
  `METHOD_NAMES` list in `code-highlight.ts` where relevant.

---

## Testing hardware changes

Anything under `packages/bridge/src/`, `packages/core/src/websocket.ts`, or the send
throttle in the UI is the *wire path* — it can look perfectly correct in the
visualizer and still be wrong on the wire. The maintainer can't verify every
interface and every fixture, so say in the PR description what you tested against:

- **Real hardware** — name the node and protocol, e.g. "Enttec ODE Mk3, Art-Net
  unicast, 2 universes".
- **No hardware** — set `"mode": "mock"` in `packages/bridge/bridge.config.json` (or
  call `mock()` in the editor) and the bridge prints the non-zero channels of every
  seventh frame. Enough to confirm frames are produced and channels land where you
  expect. `npm run bridge:selftest` covers the other half: it emits a known ramp
  directly, so you can point a capture or a node at it without the browser in the
  picture.
- **Packet layout changes** — a Wireshark capture or the receiving node's own
  diagnostics. Nothing else proves the bytes.

---

## Commits

Imperative subject line, blank line, then a body explaining *why* — the diff already
says what. Area prefix when it helps scope the change:

```
Bridge: send one zero-frame when a universe goes dark

The send path skipped any universe whose entire buffer was zero, which
meant commenting out the last pattern on a fixture left the physical
rig stuck on its last value. …
```

Wrap the body around 72 columns. `git log` is the reference — match what's there.
