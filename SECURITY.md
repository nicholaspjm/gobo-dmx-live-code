# Security policy

gobo is an operator tool, not a service. This file describes what it does and does not
defend against, so you can decide where it belongs on your network, and so a report you
send me is about a real bug rather than a documented design choice.

## Supported versions

| version | supported |
|---------|-----------|
| 0.2.x   | yes; fixes land on the latest release only |
| < 0.2   | n/a, 0.2.0 is the first public release |

There are no long-term or maintenance branches. If you're running something older than the
current tag, the fix is to update.

## Threat model

gobo assumes one operator, on a machine they trust, on a network they trust: a laptop
running the editor and the bridge, wired to a lighting rig or a dedicated art-net VLAN.
It is not multi-tenant, has no accounts, no roles and no server-side state, and nothing it
stores is secret. Everything lives in the browser (`localStorage`, under the `gobo-*-v1`
keys: the working scene buffer, saved fixtures, settings; the settings blob and the fixture
library adopt their pre-rename `lumen-*-v1` values on first load, and the old multi-scene
store `gobo-scenes-v1` is read but never written) and in a local Node process that speaks
unencrypted UDP to lighting hardware. The hosted build on GitHub Pages is static: your
code never leaves your browser, and DMX only leaves the machine through a bridge you started
yourself (`ws://localhost:3001` by default, or the LAN address the UI is served from; see
`pickBridgeHost()` in `packages/core/src/websocket.ts`). Treat the whole system as a
lighting console with an open ethernet port.

## Scene code runs with full page privileges, by design

`evalCode()` in `packages/core/src/eval.ts` compiles your editor buffer with `new Function()`
in strict mode and calls it with a curated set of arguments: the DMX and fixture API,
Strudel waveforms, `Math`, `console`. That list **shadows** names; it does not remove
anything. The compiled function runs in the page's own realm, so scene code can reach
`globalThis`, `window`, `document`, `fetch`, `localStorage`, and every other global, patch
`Pattern.prototype` (which `register()` does deliberately, and which persists across
evaluations), or hang the tab with an infinite loop. There is no isolation boundary, no
timeout, and no allow-list of operations.

This is intentional: hot-swapping code at tick boundaries is the point of the tool, and the
code is yours. The consequence is the ordinary one. **Only run scene code you trust**, and
treat a scene from a stranger as an executable.

"Escaping the eval sandbox" is therefore not a vulnerability, because there is no sandbox
to escape. Reports demonstrating that user code can call `fetch` or reach `window` will be
closed with a link to this section.

## Share links carry someone else's code into your browser

The section above assumes the code in the editor is yours. Share links break that
assumption. They are the one feature in gobo that lets a stranger choose what ends up in
your buffer, so they get their own threat model.

**The threat.** `share` encodes the whole scene into a URL fragment
(`packages/ui/src/share.ts`); opening that URL loads the scene into gobo. Since scene code
runs unsandboxed in the page's own realm, a scene you were sent and then ran is a program
you granted, at minimum:

- read and write access, via `localStorage`, to everything gobo has stored on that origin:
  your working scene, your fixture library, your settings;
- your bridge, through `artnet()` / `sacn()` / `osc()` or by opening its unauthenticated
  socket directly, meaning it can repoint DMX output at any host and port it likes, or drive
  the rig itself;
- the network, `fetch` included, from a page you trust.

On the hosted build every user shares one origin, so "this origin's storage" is your storage.
None of this needs a bug: it is what running the code means. Only reading the code
distinguishes a malicious scene from a harmless one.

**What is implemented against it.** All of it is in
`handleSharedSceneOnBoot()` / `replaceBuffer()` in `packages/ui/src/main.ts` and in
`share.ts`:

- **A scene from a link never runs on arrival.** It is loaded into the editor and the
  scheduler is stopped; nothing on the boot path calls `evalCode()`. Running is a deliberate
  `Ctrl+Enter`.
- **A banner states the provenance.** It says the scene came from a shared link, that
  running it grants full access to the page and to DMX output, and that nothing is running
  yet. It stays up until the scene is successfully run or the banner is dismissed.
- **Your own work is not silently replaced.** If the buffer differs from the last copy you
  saved to a file, you are asked to confirm before the shared scene takes its place.
- **The decoder never executes the payload and never throws.** It refuses anything that does
  not match one of its own payload formats, rejects a hash containing characters outside
  base64url, drains decompression incrementally and abandons it past 512 kB so a deflate
  bomb cannot exhaust the tab's memory, decodes UTF-8 in fatal mode, and requires the
  result to be an object whose `code` and `name` are both strings. Every failure is "there
  is no share link here", and your own buffer is left alone.
- **The scene name is treated as hostile text.** It is stripped of control characters,
  collapsed to one line, capped at 80 characters, and put into the DOM through `textContent`
  and text nodes, never as markup.
- **The payload is stripped from the address bar** with `history.replaceState` before
  anything is decided, so a reload cannot re-ask the question and the link does not sit in
  the URL bar afterwards.

**Residual risk.**

- **Reading the scene before running it is your job, and there is no help for it.** gobo
  does not analyse, lint, diff or restrict what a shared scene may call, because the eval
  boundary that would make such a check meaningful does not exist by design. Obfuscated or
  merely long code is code you have not read.
- **The stopped state is a delay, not a barrier.** One habitual `Ctrl+Enter` runs it. The
  banner is the only thing between an unread scene and your rig.
- **A shared scene persists once loaded.** It is written into the working buffer
  immediately, so it survives a reload, and after that reload the banner is gone, because
  the hash has been cleared. Code you left unread yesterday looks like your own scene today.
  Dismissing the banner likewise removes the warning, not the code.
- **The replace prompt is keyed to file saves, not to edits.** If the buffer matches the last
  file you saved (or is untouched example text), a shared scene replaces it without asking.
  Nothing is lost, since that copy is on disk, but the editor's contents do change under you.
- **A link is not signed, and its name is chosen by whoever built it.** "official starter
  scene" in the top bar means nothing about who wrote the code.
- **Opening a `.gobo` file someone sent you is the same grant** with less ceremony: files
  also arrive stopped and never auto-run, but there is no provenance banner, because opening
  a file is a deliberate act.
- **A link you create contains everything in your buffer**: node IP addresses, venue
  details, comments you would not have published. Nothing leaves your browser when the link
  is made, but the link itself is the scene, and it is as shareable as any other text.

## The bridge has no authentication

`packages/bridge/src/index.ts` creates a plain HTTP server and attaches a WebSocket server
to it, then calls `httpServer.listen(3001)` **with no host argument**, so it accepts
connections on every interface, not just loopback, despite the `ws://localhost:3001` line
it prints at startup. There is no token, no TLS, no `Origin` check on the upgrade, and no
per-client state. Any client that can reach tcp/3001 on that machine can:

- stream DMX frames (`{ "type": "dmx", "universes": { … } }`) and take over the rig, and
- send `{ "type": "config", … }` to switch output mode and set the destination, including
  an arbitrary Art-Net or OSC `host` and `port`, which repoints the bridge's UDP output
  anywhere it can route.

Browsers do not apply same-origin restrictions to outbound WebSocket connections, so this
includes any page open in a browser on the operator's machine, not just gobo itself.

Mitigation is network placement, not configuration: keep tcp/3001 on a trusted segment,
don't port-forward it, and prefer a dedicated lighting VLAN or a host firewall rule that
limits 3001 to loopback if the UI and bridge are on the same machine. If you need the
bridge reachable from elsewhere, put it behind something that does authentication. gobo
will not do it for you.

## Art-Net, sACN and OSC are unauthenticated by design

Art-Net (UDP/6454, unicast or broadcast depending on the host you configure), sACN E1.31
(UDP/5568, multicast `239.255.<hi>.<lo>`) and OSC (UDP unicast) are cleartext protocols
with no authentication, no integrity check and no replay protection. Anything on the same
segment can watch your levels or inject its own; sACN's priority field is advisory and any
sender can claim any priority. gobo implements these protocols faithfully, so it inherits
their properties. That is the protocols' threat model, not a defect in this tool. The
answer is network segmentation, as it is for every other lighting controller.

## What is worth reporting

Things that break an expectation gobo sets:

- **Anything a merely-visited web page can do to gobo itself**: writing to the scene or
  fixture store, getting code to persist into a scene, or otherwise acting inside the app's
  origin without the operator doing it. (Connecting to the unauthenticated bridge socket is
  already covered above and is not this.)
- **A shared scene reaching evaluation without a deliberate keystroke**, whether on load, on
  a reload, or as a side effect of any other action. Not auto-running is the only hard
  promise the share feature makes, so a way around it is the most serious bug this app can
  have.
- **A share payload getting past the decoder**: a hash that makes `decodeShareFromLocation`
  return something other than two strings, that hangs or exhausts the tab despite the size
  caps, or a scene name that reaches the DOM as markup instead of text.
- **Anything that writes to or clears `gobo-scenes-v1`**, `gobo-active-scene-v1` or
  `gobo-scene-meta-v1`. Those keys hold scenes from the old multi-scene version and are
  deliberately read-only forever; for many users the browser is the only copy, so a write
  there destroys work that cannot be recovered.
- **XSS in the UI.** The library panel builds rows with `innerHTML` and escapes every
  fixture-supplied string through `escapeText` / `escapeAttr` (`packages/ui/src/library.ts`).
  A fixture id, name, manufacturer, or channel name that escapes that and executes is a bug.
  Same for the docs, sim and settings panels.
- **Validator bypass.** `validateFixture` (`packages/core/src/fixture-validator.ts`) is the
  gate for imported `.gobo-fixture.json` files and for the bundled public library. A def
  that passes it and then breaks something downstream is a bug: resource exhaustion past
  `FIXTURE_LIMITS`, shadowing a built-in, a hostile id reaching a filename or a URL.
- **Bridge crashes or hangs.** Its only inbound surface is the HTTP/WS listener on 3001.
  Malformed JSON is caught per-message, but a message shape that gets past `JSON.parse` and
  kills the process, wedges it, or makes it emit traffic to a destination the operator never
  configured (without going through the documented `config` message) is a bug.
- **Dependency vulnerabilities with a plausible path here**: `ws`, Vite, Strudel and their
  transitives. An advisory in a code path gobo never executes is still useful to hear about,
  just lower priority.

Not vulnerabilities, and already true by construction: eval sandbox escapes, driving or
repointing an unauthenticated bridge you exposed, sniffing or spoofing DMX on the wire,
scene code touching browser storage or the network, a scene from a share link doing any of
that *after you chose to run it*, the length of a share link, and scanner output with no
demonstrated impact.

## Reporting

Open a private advisory:
**https://github.com/nicholaspjm/gobo-dmx-live-code/security/advisories/new**

Include the version or commit, what you did, what happened, and what you expected. A
minimal scene, fixture file, or WebSocket message that reproduces it is worth more than a
description. If the issue is one of the accepted design properties above, a normal public
issue is fine and easier for everyone.

Expectations: this is a solo hobby project. Handling is best-effort, there is no SLA and no
bounty, and I may be on a job with no laptop for a week. I'll aim to acknowledge within
about two weeks, and I'd rather you hold public details until there's a fix or we've agreed
the behaviour is intended. Credit in the release notes if you want it.
