# gobo-connector

Sends DMX from the [gobo](https://nicholaspjm.github.io/gobo-dmx-live-code/)
browser app to real fixtures over Art-Net, sACN (E1.31) or OSC.

A browser cannot open a UDP socket, so it cannot speak Art-Net itself. This is
the piece that can. Run it, open the app, and output works.

## Use it

```bash
npx gobo-connector
```

Then open https://nicholaspjm.github.io/gobo-dmx-live-code/ and press
`ctrl+enter`. Nothing is installed and nothing is left behind.

Pick the output from your scene, not from here:

```js
artnet('2.255.255.255')   // broadcast to every node on that subnet
artnet('2.0.0.100')       // or one node's IP
sacn(1, 100)              // sACN, base universe and priority
osc('127.0.0.1', 9000)    // OSC, for TouchDesigner and friends
```

The host is the destination, never your own machine. That is the usual reason
nothing arrives, along with your computer being on a different subnet from the
rig.

## Options

```
--ui <dir>     also serve a built copy of the app from the same port
--config <p>   read startup config from a specific file
--no-open      do not open a browser
```

Defaults to `mock` with no config file, which sends nothing, and waits for the
app to choose an output.

## No Node?

Download a single executable instead, from
[Releases](https://github.com/nicholaspjm/gobo-dmx-live-code/releases/latest).
It installs itself to start at login on first run.

Using a USB DMX interface? You need none of this. The browser drives it
directly over WebSerial: click `usb` in the app.

## Licence

MIT
