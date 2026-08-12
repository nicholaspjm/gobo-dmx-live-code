# Security policy

gobo is an operator tool, not a service. This file describes what it does and does not
defend against, so you can decide where it belongs on your network — and so a report you
send me is about a real bug rather than a documented design choice.

## Supported versions

| version | supported |
|---------|-----------|
| 0.2.x   | yes — fixes land on the latest release only |
| < 0.2   | n/a, 0.2.0 is the first public release |

There are no long-term or maintenance branches. If you're running something older than the
current tag, the fix is to update.

## Threat model

gobo assumes one operator, on a machine they trust, on a network they trust — a laptop
running the editor and the bridge, wired to a lighting rig or a dedicated art-net VLAN.
It is not multi-tenant, has no accounts, no roles, no server-side state, and nothing it
stores is secret. Everything lives in the browser (`localStorage`, under the `gobo-*-v1`
keys — scenes, saved fixtures, settings; values written under the pre-rename `lumen-*-v1`
keys are migrated across on first load) and in a local Node process that speaks
unencrypted UDP to lighting hardware. The hosted build on GitHub Pages is static — your
code never leaves your browser; DMX only leaves the machine through a bridge you started
yourself (`ws://localhost:3001` by default, or the LAN address the UI is served from —
see `pickBridgeHost()` in `packages/core/src/websocket.ts`). Treat the whole system the way
you'd treat a lighting console with an open ethernet port, because that is what it is.

## Scene code runs with full page privileges — by design

`evalCode()` in `packages/core/src/eval.ts` compiles your editor buffer with `new Function()`
in strict mode and calls it with a curated set of arguments — the DMX and fixture API,
Strudel waveforms, `Math`, `console`. That list **shadows** names; it does not remove
anything. The compiled function runs in the page's own realm, so scene code can reach
`globalThis`, `window`, `document`, `fetch`, `localStorage`, and every other global, patch
`Pattern.prototype` (which `register()` does deliberately, and which persists across
evaluations), or hang the tab with an infinite loop. There is no isolation boundary, no
timeout, and no allow-list of operations.

This is intentional — hot-swapping code at tick boundaries is the entire point of the tool,
and the code is yours. The consequence is the ordinary one: **only run scene code you
trust**, the same way you'd only run a shell script you trust. Treat a scene from a
stranger like an executable, not like a document.

"Escaping the eval sandbox" is therefore not a vulnerability, because there is no sandbox
to escape. Reports demonstrating that user code can call `fetch` or reach `window` will be
closed with a link to this section.

## The bridge has no authentication

`packages/bridge/src/index.ts` creates a plain HTTP server and attaches a WebSocket server
to it, then calls `httpServer.listen(3001)` **with no host argument** — so it accepts
connections on every interface, not just loopback, despite the `ws://localhost:3001` line
it prints at startup. There is no token, no TLS, no `Origin` check on the upgrade, and no
per-client state. Any client that can reach tcp/3001 on that machine can:

- stream DMX frames (`{ "type": "dmx", "universes": { … } }`) and take over the rig, and
- send `{ "type": "config", … }` to switch output mode and set the destination — including
  an arbitrary Art-Net or OSC `host` and `port`, which repoints the bridge's UDP output
  anywhere it can route.

Browsers do not apply same-origin restrictions to outbound WebSocket connections, so this
includes any page open in a browser on the operator's machine, not just gobo itself.

Mitigation is network placement, not configuration: keep tcp/3001 on a trusted segment,
don't port-forward it, and prefer a dedicated lighting VLAN or a host firewall rule that
limits 3001 to loopback if the UI and bridge are on the same machine. If you need the
bridge reachable from elsewhere, put it behind something that does authentication — gobo
will not do it for you.

## Art-Net, sACN and OSC are unauthenticated by design

Art-Net (UDP/6454, unicast or broadcast depending on the host you configure), sACN E1.31
(UDP/5568, multicast `239.255.<hi>.<lo>`) and OSC (UDP unicast) are cleartext protocols
with no authentication, no integrity check, and no replay protection. Anything on the same
segment can watch your levels or inject its own; sACN's priority field is advisory and any
sender can claim any priority. gobo implements these protocols faithfully, which means it
inherits their properties. That is the protocols' threat model, not a defect in this tool —
the answer is network segmentation, as it is for every other lighting controller.

## What is worth reporting

Things that break an expectation gobo actually sets:

- **Anything a merely-visited web page can do to gobo itself** — writing to the scene or
  fixture store, getting code to persist into a scene, or otherwise acting inside the app's
  origin without the operator doing it. (Connecting to the unauthenticated bridge socket is
  already covered above and is not this.)
- **XSS in the UI** — the library panel builds rows with `innerHTML` and escapes every
  fixture-supplied string through `escapeText` / `escapeAttr` (`packages/ui/src/library.ts`).
  A fixture id, name, manufacturer, or channel name that escapes that and executes is a bug.
  Same for the docs, sim and settings panels.
- **Validator bypass** — `validateFixture` (`packages/core/src/fixture-validator.ts`) is the
  gate for imported `.gobo-fixture.json` files and for the bundled public library. A def
  that passes it and then breaks something downstream — resource exhaustion past
  `FIXTURE_LIMITS`, shadowing a built-in, a hostile id reaching a filename or a URL — is a bug.
- **Bridge crashes or hangs.** Its only inbound surface is the HTTP/WS listener on 3001;
  malformed JSON is caught per-message, but a message shape that gets past `JSON.parse` and
  kills the process, wedges it, or makes it emit traffic to a destination the operator never
  configured (without going through the documented `config` message) is a bug.
- **Dependency vulnerabilities with a plausible path here** — `ws`, Vite, Strudel and their
  transitives. An advisory in a code path gobo never executes is still useful to hear about,
  just lower priority than one that isn't.

Not vulnerabilities, and already true by construction: eval sandbox escapes, driving or
repointing an unauthenticated bridge you exposed, sniffing or spoofing DMX on the wire,
scene code touching browser storage or the network, and scanner output with no demonstrated
impact.

## Reporting

Open a private advisory:
**https://github.com/nicholaspjm/gobo-dmx-live-code/security/advisories/new**

Please include the version or commit, what you did, what happened, and what you expected —
a minimal scene, fixture file, or WebSocket message that reproduces it is worth more than a
description. If the issue is one of the accepted design properties above, a normal public
issue is fine and easier for everyone.

Expectations, set honestly: this is a solo hobby project. Handling is best-effort, there is
no SLA and no bounty, and I may be on a job with no laptop for a week. I'll aim to
acknowledge within about two weeks, and I'd rather you hold public details until there's a
fix or we've agreed the behaviour is intended. Credit in the release notes if you want it.
