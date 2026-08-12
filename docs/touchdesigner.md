# gobo → TouchDesigner

Drive TouchDesigner from gobo patterns — every DMX channel arrives as an OSC float in `[0, 1]`, one message per channel per frame.

[← back to README](../README.md)

---

## Route

```
browser (gobo)   ──ws://localhost:3001──▶  bridge  ──UDP OSC──▶  TouchDesigner
```

The bridge is the only piece that speaks UDP, so it has to be running — TouchDesigner never talks to the browser directly.

## Setup

**1. Start the bridge.**

```bash
npm run dev        # UI + bridge together
# or
npm run dev:bridge # bridge only, if the UI is already open elsewhere
```

The status dot in gobo's top bar reads `bridge` once the WebSocket is up, `disconnected` otherwise.

**2. Switch gobo to OSC.** Put this at the top of your scene and hit `Ctrl+Enter`:

```js
osc('127.0.0.1', 9000)   // host = the machine running TouchDesigner
```

Host defaults to `127.0.0.1` and port to `9000`. If TD runs on another machine, pass its IP — the bridge, not the browser, sends the UDP, so the address is relative to whatever machine the bridge is on.

**3. Add an OSC In CHOP.** Create an `OSC In CHOP` and set its *Network Port* to the same port (`9000`). One channel appears per address that gobo has sent.

**4. Run a pattern.** Anything that writes a channel will show up:

```js
const wash = fixture(1, 'rgbw')
wash.red(sine().slow(4))
```

## Wire format

| | |
|---|---|
| Address | `/gobo/<universe>/<channel>` — universe as written in your scene, channel 1-based (1–512) |
| Argument | one float, `value / 255`, so `0.0`–`1.0` |
| Transport | UDP unicast to the configured host/port |

Multiply by 255 in TD if you want the raw DMX byte back.

> **Renamed in 0.2.0.** The address prefix used to be `/lumen/`. A patch built against
> the old prefix will see its channels disappear from the `OSC In CHOP` — repoint any
> address-matching to `/gobo/…`.

## Things worth knowing

- **Only active channels are sent.** A channel is transmitted when it is non-zero, or when it was non-zero on the previous frame — that trailing frame is what pushes a channel back to `0.0`. Channels your scene never touches never appear in the CHOP at all, so an empty OSC In CHOP usually means nothing is being driven yet, not that the link is broken.
- **The universe number comes from your scene, not from the output call.** `fixture()`, `rgbStrip()` and `rgbwStrip()` default to universe `0`; `ch()` and `dim()` write universe `1`; `uni(n, ch, v)` writes whatever you ask for. That number lands in the OSC address.
- **The bridge logs its first OSC packet and every hundredth after that** — `[bridge] OSC → 127.0.0.1:9000 uni0 (12 active ch, packet #100)`. If that line never appears, the browser is not reaching the bridge; if it appears and TD stays empty, the problem is between the bridge and TD (wrong host, wrong port, firewall).
- **Firewall.** Sending to another machine means an inbound UDP allow on that port on the TD host. Loopback (`127.0.0.1`) needs nothing.
- **Send rate** is capped by the `send rate` setting in gobo's settings panel — 30 / 60 / 120 Hz, default 60. Drop it to 30 if you are pushing many channels over wireless.

## Art-Net instead of OSC

TouchDesigner's `DMX In CHOP` can take Art-Net directly, which keeps values as 0–255 integers and stays closer to a real lighting network:

```js
artnet('127.0.0.1')   // or the IP of the machine running TD
```

The bridge sends one 530-byte ArtDmx packet per universe per frame on port 6454. Match the universe number in the DMX In CHOP to the universe your fixtures are on.
