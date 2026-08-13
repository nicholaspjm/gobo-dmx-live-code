# gobo → TouchDesigner

Drive TouchDesigner from gobo patterns. Every DMX channel arrives as an OSC float in `[0, 1]`, one message per channel per frame.

[← back to README](../README.md)

---

## Route

```
browser (gobo)   ──ws://localhost:3001──▶  bridge  ──UDP OSC──▶  TouchDesigner
```

The bridge is the only piece that speaks UDP, so it has to be running. TouchDesigner never talks to the browser directly.

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

Host defaults to `127.0.0.1` and port to `9000`. If TD runs on another machine, pass its IP. The bridge sends the UDP, not the browser, so the address is relative to whatever machine the bridge is on.

**3. Add an OSC In CHOP.** Create an `OSC In CHOP` and set its *Network Port* to the same port (`9000`). One channel appears per address that gobo has sent.

**4. Run a pattern.** Anything that writes a channel will show up:

```js
const wash = fixture(1, 'rgbw')
wash.red(sine().slow(4))
```

## Wire format

| | |
|---|---|
| Address | `/gobo/<universe>/<channel>`. Universe as written in your scene; channel 1-based (1-512) |
| Argument | one float, `value / 255`, so `0.0` to `1.0` |
| Transport | UDP unicast to the configured host/port |

Multiply by 255 in TD if you want the raw DMX byte back.

> **Renamed in 0.2.0.** The address prefix used to be `/lumen/`. A patch built against
> the old prefix will see its channels disappear from the `OSC In CHOP`; repoint any
> address-matching to `/gobo/…`.

## Notes

- **Only active channels are sent.** A channel is transmitted when it is non-zero, or when it was non-zero on the previous frame; that trailing frame is what pushes a channel back to `0.0`. Channels your scene never touches never appear in the CHOP at all, so an empty OSC In CHOP usually means nothing is being driven yet rather than a broken link.
- **The universe number comes from your scene, not from the output call.** `fixture()`, `rgbStrip()` and `rgbwStrip()` default to universe `0`; `ch()` and `dim()` write universe `1`; `uni(n, ch, v)` writes whatever you ask for. That number lands in the OSC address.
- **The bridge logs its first OSC packet and every hundredth after that**: `[bridge] OSC → 127.0.0.1:9000 uni0 (12 active ch, packet #100)`. If that line never appears, the browser is not reaching the bridge. If it appears and TD stays empty, the problem is between the bridge and TD (wrong host, wrong port, firewall).
- **Firewall.** Sending to another machine needs an inbound UDP allow on that port on the TD host. Loopback (`127.0.0.1`) needs nothing.
- **Send rate** is capped by the `send rate` setting in gobo's settings panel: 30 / 60 / 120 Hz, default 60. Drop it to 30 if you are pushing many channels over wireless.

## Art-Net instead of OSC

TouchDesigner's `DMX In CHOP` can take Art-Net directly, which keeps values as 0-255 integers and stays closer to a real lighting network:

```js
artnet('127.0.0.1')   // or the IP of the machine running TD
```

The bridge sends one 530-byte ArtDmx packet per universe per frame on port 6454. Match the universe number in the DMX In CHOP to the universe your fixtures are on.

---

## Direct mode: no bridge, works from the hosted site

`td()` opens a WebSocket from the browser straight to a TouchDesigner WebSocket
DAT. gobo's bridge is not involved, so this works from
https://nicholaspjm.github.io/gobo-dmx-live-code/ on any machine that already
has TouchDesigner open. TD receives the frames and puts Art-Net on the wire.

```js
td('localhost', 9980)
```

The browser still cannot speak Art-Net; it never can. TouchDesigner is doing
that part. What direct mode removes is having to run anything of gobo's.

> **One constraint.** A page served over https may only open an insecure
> WebSocket to `localhost` or `127.0.0.1`. Browsers block every other host as
> mixed content. So TouchDesigner has to be on the same machine as the browser,
> or gobo has to be served over http. gobo reports this rather than letting the
> socket fail silently.

### TouchDesigner setup

**1. WebSocket DAT (server).** Create `websocket1` (DAT, WebSocket):

| Parameter | Value |
|-----------|-------|
| Active | `On` |
| Mode | `Server` |
| Network Port | `9980` |
| Format | `Text` |

**2. Table DAT.** Create `table1` (DAT, Table). Leave it empty.

**3. Code Text DAT.** Create `code_text` (DAT, Text). Leave it empty; gobo
pushes your live editor contents into it so you can put the running code on
screen.

**4. Callback script.** Create `callbacks1` (DAT, Text) and set `websocket1`'s
*Callbacks DAT* to it:

```python
import json

def onReceiveText(dat, rowIndex, message, peer):
    try:
        data = json.loads(message)
    except Exception:
        return

    msg_type = data.get('type')

    if msg_type == 'dmx':
        table = op('table1')
        for uni_str, values in data.get('universes', {}).items():
            for i, v in enumerate(values):
                name = f'{uni_str}/{i + 1}'
                norm = v / 255.0
                row = table.row(name)
                if row is None:
                    table.appendRow([name, norm])
                else:
                    table[name, 1] = norm

    elif msg_type == 'code':
        code_dat = op('code_text')
        if code_dat is not None:
            code_dat.text = data.get('text', '')

    return

def onConnect(dat, peer): return
def onDisconnect(dat, peer): return
```

**5. DAT to CHOP.** Create `datto1` (CHOP, DAT to). Set *DAT* to `table1` and
*First Column is Names* to `On`. Each channel appears as a named CHOP channel
(`0/1`, `0/2`, and so on) with values 0 to 1.

**6. Art-Net out.** Feed `datto1` into a DMX Out CHOP set to Art-Net, pointed at
your node. That is the step that puts light on the rig.

### Which mode to use

| | `td()` direct | `osc()` or `artnet()` via the bridge |
|---|---|---|
| gobo process needed | none | the bridge |
| Works from the hosted site | yes, with TD on the same machine | yes, with a local bridge |
| Receiver | TouchDesigner only | TD, any OSC app, or Art-Net hardware |
| Values arrive as | 0 to 1 floats in a Table DAT | OSC floats, or DMX on the wire |
