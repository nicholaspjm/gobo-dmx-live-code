# Security policy

gobo is an operator tool, not a service. This file describes what it does and does not
defend against, so you can decide where it belongs on your network, and so a report you
send me is about a real bug rather than a documented design choice.

## Supported versions

| version | supported |
|---------|-----------|
| 0.5.x   | yes; fixes land on the latest release only |
| < 0.5   | no. Connectors before 0.5.0 accept connections from any website and any machine on the network; replace yours |

There are no long-term or maintenance branches. If you're running something older than the
current tag, the fix is to update. A connector that is behind announces its version when the
app connects, and the outputs page says so, including when it is old enough to be open to
other websites.

## Threat model

gobo assumes one operator, on a machine they trust, on a network they trust: a laptop
running the editor and the connector, wired to a lighting rig or a dedicated Art-Net VLAN.
It is not multi-tenant, has no accounts, no roles and no server-side state, and nothing it
stores is secret. Everything lives in the browser (`localStorage`, under the `gobo-*-v1`
keys: the working scene buffer, saved fixtures, settings; the settings blob and the fixture
library adopt their pre-rename `lumen-*-v1` values on first load, and the old multi-scene
store `gobo-scenes-v1` is read but never written) and in a local Node process that speaks
unencrypted UDP to lighting hardware.

The hosted build on GitHub Pages is static. Your code never leaves your browser: the scene
travels in the URL fragment, which browsers do not send to the server. DMX only leaves the
machine through a process you started yourself, which is one of three things:

- **the connector**, a single program that sits beside the hosted page;
- **`npm start`**, which serves the app and sends the output from one process;
- **the desktop app**, which is `npm start` in a window.

All three are the same bridge (`packages/bridge`), listening on `localhost:3001`. Treat any
of them as a lighting console with a network port.

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

The desktop app does not widen this. Its window runs with `contextIsolation`, `sandbox` and
no `nodeIntegration`, and the preload exposes one frozen object, `window.gobo`, holding a
flag and a version string (`packages/desktop/src/preload.cts`). Scene code there has what it
has in a browser tab and nothing from Node.

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
- your output, through `artnet()` / `sacn()` / `osc()`, meaning it can repoint DMX at any
  host and port it likes, or drive the rig itself;
- the network, `fetch` included, from a page you trust.

On the hosted build every user shares one origin, so "this origin's storage" is your storage.
None of this needs a bug: it is what running the code means. Only reading the code
distinguishes a malicious scene from a harmless one.

**What is implemented against it.** In `handleSharedScene()` / `replaceBuffer()` in
`packages/ui/src/main.ts`, and in `share.ts`:

- **A scene from a link never runs on arrival.** It is loaded into the editor and the
  scheduler is stopped; nothing on the load path calls `evalCode()`. Running is a deliberate
  `Ctrl+Enter` or a press of the run button. The same holds for a link pasted into a tab
  that already has gobo open, which is handled on `hashchange`.
- **Your own work is not silently replaced.** If you have typed anything since the buffer
  was last replaced, you are asked to confirm before the shared scene takes its place.
  Saying no leaves both your buffer and the link where they were, so you can copy your work
  out first and then open the link.
- **The decoder never executes the payload and never throws.** It refuses anything that does
  not match one of its own payload formats, rejects a hash containing characters outside
  base64url, drains decompression incrementally and abandons it past 512 kB so a deflate
  bomb cannot exhaust the tab's memory, decodes UTF-8 in fatal mode, and requires the
  result to be an object whose `code` is a string. Every failure is "there is no share link
  here", and your own buffer is left alone. A link written before 0.5.0 also carries a scene
  `name`; it is read past, never rendered, so there is no attacker-controlled text to put on
  screen at all.
- **The payload leaves the address bar once it has been taken**, with
  `history.replaceState`, so a reload does not offer to replace the scene with itself.

**Residual risk.**

- **Reading the scene before running it is your job, and there is no help for it.** gobo
  does not analyse, lint, diff or restrict what a shared scene may call, because the eval
  boundary that would make such a check meaningful does not exist by design. Obfuscated or
  merely long code is code you have not read.
- **The stopped state is a delay, not a barrier.** One habitual `Ctrl+Enter` runs it. There
  is no banner saying where the code came from; the confirm prompt is the only moment it is
  named as a shared scene.
- **A shared scene persists once loaded.** It is written into the working buffer
  immediately, so it survives a reload. Code you left unread yesterday looks like your own
  scene today.
- **An untouched buffer is replaced without asking.** The two-line example a new browser
  opens on, or an example you loaded and have not edited, is ours rather than yours, so a
  link replaces it directly. Nothing of yours is lost, but the editor's contents do change.
- **A link is not signed.** Nothing about it says who wrote the code, and wording in its
  comments is chosen by whoever built it.
- **A link you create contains everything in your buffer**: node IP addresses, venue
  details, comments you would not have published. Nothing leaves your browser when the link
  is made, but the link itself is the scene, and it is as shareable as any other text.
- **So does your address bar.** After every successful run the page writes the running scene
  into its own URL fragment, so a bookmark or a restored tab brings it back. That means the
  scene is also in your browser history, in whatever syncs your history between devices,
  and on screen for anyone who sees the address bar. Scenes larger than about 60 kB of link
  are not written there.

## The connector answers this computer, and gobo's own pages

Until 0.5.0 the connector listened on every network interface and took a WebSocket from
anything that asked. Browsers do not apply same-origin rules to WebSockets, so any page open
in the operator's browser could stream DMX at the rig and repoint the output, and so could
anything on the same network. It now makes three checks, all in
`packages/bridge/src/access.ts`, applied in `packages/bridge/src/listen.ts` before a request
or upgrade reaches anything else:

- **Where it listens.** `127.0.0.1` and `::1`, and nothing else. Other machines cannot open
  a connection at all.
- **The `Origin` of a WebSocket**, which a web page cannot forge. Accepted: pages served
  from this computer's loopback on any port (`npm start`, the desktop app, `npm run dev`,
  `vite preview`), the hosted app at `https://nicholaspjm.github.io`, and any origin named
  with `--allow-origin`. Refused: every other site, `null` (what a sandboxed iframe or a
  `file://` page sends, and what a hostile page can arrange for itself), browser extensions,
  and anything that is not an http(s) origin.
- **The `Host` header, on every HTTP request and upgrade.** This is the DNS-rebinding
  defence. A page on a name the attacker controls can make that name resolve to `127.0.0.1`
  and then talk to "its own" origin, which passes any check that only compares `Origin` with
  `Host`. Here the host must be an IP literal, which cannot be rebound, or `localhost`.

A refused handshake gets a `403` and is logged once, with the reason.

**Opening it up.** `--lan`, or `GOBO_LAN=1` in the environment, makes it listen on every
interface so a phone or tablet can open the app from the machine's LAN address. Web pages
are still checked the same way, with one addition: a page served by this machine at its LAN
address or its own host name is accepted. Any other site, and any DNS name that is not this
machine's, is still refused. Programs are not checked:
**in LAN mode anything on the network that is not a browser can connect and drive the rig**,
because there is no token and no TLS. Use it on a network you trust. `GOBO_LAN=1` opens the
Vite dev server to the network as well; without it that is loopback-only too.

**Residual risk.**

- **No authentication.** A program running on this computer can connect without an
  `Origin` header and is let through. Refusing it would protect nothing: a program already
  running here can send UDP to your rig itself.
- **The hosted origin is the whole of `nicholaspjm.github.io`.** An `Origin` carries no path,
  so any page published under that account's GitHub Pages is accepted, not only this one.
  They are all under the maintainer's control; a fork that hosts its own build changes
  `HOSTED_APP` in `packages/bridge/src/index.ts`, or its users start the connector with
  `--allow-origin`.
- **A scene you run can still repoint the output.** That is the scene-privilege model above,
  reached through the page, not a way around the connector's checks.
- **An accepted page learns this computer's network addresses.** From 0.5.3 the connector's
  first message lists its IPv4 addresses, netmasks and broadcast addresses
  (`packages/bridge/src/networks.ts`), so the outputs panel can offer the `artnet()` line that
  reaches the rig and say when a scene sends somewhere this computer cannot reach. It goes
  only to a page that passed the checks above, and gobo keeps it in the page: it is not
  stored, and not included in a problem report.
- **Browsers add their own gate for the hosted page.** Chrome asks before a public website
  may reach programs on your computer. Allowing gobo that is a decision about gobo's origin,
  and it applies to every page there.

## The connector updates itself

From 0.5.2, the downloaded connector replaces itself when a new release comes
out (`packages/bridge/src/updater.ts`). It asks the GitHub API for this
repository's latest release when it starts and once a day, downloads the file
for its own system over HTTPS, and refuses it unless its size and SHA-256 match
what GitHub published for that file. It then runs the new file once with
`--version` and refuses it unless it starts and names the expected version, and
only then renames it over itself. It swaps and restarts only once nothing has
been connected for 90 seconds, so it never restarts under a show.

It does not update a copy Homebrew installed (`brew upgrade` does that), a copy
run through npm, the connector inside the desktop app, or a run with
`--no-update`.

**Residual risk.** The checksum proves the file is the one GitHub is serving for
that release, not who put it there. Anyone who can publish a release on this
repository can put code on every connector that updates itself, which is the
same trust the first download asked for, now extended to every later one. There
is no signature independent of GitHub. If that is not a trade you want, start
the connector with `--no-update`, or run `npm start` from a checkout you have
read.

## Art-Net, sACN and OSC are unauthenticated by design

Art-Net (UDP/6454, unicast or broadcast depending on the host you configure), sACN E1.31
(UDP/5568, multicast `239.255.<hi>.<lo>`) and OSC (UDP unicast) are cleartext protocols
with no authentication, no integrity check and no replay protection. Anything on the same
segment can watch your levels or inject its own; sACN's priority field is advisory and any
sender can claim any priority. gobo implements these protocols faithfully, so it inherits
their properties. That is the protocols' threat model, not a defect in this tool. The
answer is network segmentation, as it is for every other lighting controller.

## Installers are not signed

The connector binaries, the desktop app and the installers on the releases page are built by
the release workflow and are not signed by an Apple or Microsoft certificate. macOS and
Windows will say they cannot verify the developer the first time you open one, and the
README says how to proceed. Homebrew installs the connector without that step. If you would
rather not run an unsigned binary, `npm start` from a checkout is the same program built from
source you can read.

## What is worth reporting

Things that break an expectation gobo sets:

- **Anything a merely-visited web page can do to gobo**: opening a WebSocket to the
  connector from another origin, getting a DNS name past the `Host` check, writing to the
  scene or fixture store, getting code to persist into a scene, or otherwise acting inside
  the app's origin without the operator doing it.
- **Anything that reaches the connector from another machine** while it is not in LAN mode.
- **A shared scene reaching evaluation without a deliberate keystroke**, whether on load, on
  a reload, on a hash change, or as a side effect of any other action. Not auto-running is
  the only hard promise the share feature makes, so a way around it is the most serious bug
  this app can have.
- **A share payload getting past the decoder**: a hash that makes `decodeShareFromLocation`
  return something other than a string of code, or that hangs or exhausts the tab despite
  the size caps.
- **Anything that writes to or clears `gobo-scenes-v1`**, `gobo-active-scene-v1` or
  `gobo-scene-meta-v1`. Those keys hold scenes from the old multi-scene version and are
  deliberately read-only forever; for many users the browser is the only copy, so a write
  there destroys work that cannot be recovered.
- **XSS in the UI.** The fixtures page builds rows with `innerHTML` and escapes every
  fixture-supplied string through `escapeText` / `escapeAttr` (`packages/ui/src/library.ts`).
  A fixture id, name, manufacturer, or channel name that escapes that and executes is a bug.
  Same for the docs, the sim and the settings.
- **Validator bypass.** `validateFixture` (`packages/core/src/fixture-validator.ts`) is the
  gate for imported `.gobo-fixture.json` files and for the bundled public library. A def
  that passes it and then breaks something downstream is a bug: resource exhaustion past
  `FIXTURE_LIMITS`, shadowing a built-in, a hostile id reaching a filename or a URL.
- **Anything that gets the connector to install a file** that is not the published
  release asset for its system, that skips the size or checksum check, or that
  restarts it while a page is connected.
- **Connector crashes or hangs.** Its only inbound surface is the HTTP/WS listener on 3001.
  Malformed JSON is caught per-message, but a request or message that kills the process,
  wedges it, or makes it emit traffic to a destination the operator never configured
  (without going through the documented `config` message) is a bug. A crash matters more
  here than usual: receivers hold their last frame, so the rig stays lit on it.
- **Dependency vulnerabilities with a plausible path here**: `ws`, Vite, Strudel, Electron
  and their transitives. An advisory in a code path gobo never executes is still useful to
  hear about, just lower priority.

Not vulnerabilities, and already true by construction: eval sandbox escapes; driving a
connector you started with `--lan` from another program on that network; driving it from a
program on your own computer; sniffing or spoofing DMX on the wire; scene code touching
browser storage or the network; a scene from a share link doing any of that *after you chose
to run it*; the length of a share link; unsigned installers; and scanner output with no
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
