# gobo-connector

Sends DMX from the [gobo](https://gobolive.cc/)
browser app to real fixtures over Art-Net, sACN (E1.31) or OSC.

A browser cannot open a UDP socket, so it cannot speak Art-Net itself. This is
the piece that can. Run it, open the app, and output works.

## Use it

```bash
npx gobo-connector@latest
```

Then open https://gobolive.cc/ and press
`ctrl+enter`. Chrome asks before a website may reach a program on your
computer; allow it for gobo. Nothing is installed and nothing starts at login.

For one that starts with your computer, download it from
[Releases](https://github.com/nicholaspjm/gobo-dmx-live-code/releases/latest),
or on an Apple Silicon Mac or x86_64 Linux:

```bash
brew tap nicholaspjm/gobo https://github.com/nicholaspjm/gobo-dmx-live-code
brew install gobo-connector
brew services start gobo-connector
```

Simpler still, if you have a copy of the repository: `npm start` there runs
this and serves the app from one process.

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
--ui <dir>            also serve a built copy of the app from the same port
--config <p>          read startup config from a specific file
--no-open             do not open a browser
--no-install          do not add the login item that starts it with the computer
--lan                 listen on every network interface, not just this computer
--allow-origin <url>  also accept pages from that site (repeatable)
--no-update           do not replace itself when a new release comes out
--version             print the version and stop
--help                print these options and stop
--uninstall           remove the login item the first run added
```

The downloaded connector keeps itself up to date. When a release comes out it
downloads the file for your system, checks its size and checksum against what
GitHub published, runs it once to see it starts, and swaps it in the next time
nothing has been connected for a minute and a half, so never under a show.
`--no-update` turns that off; copies from Homebrew or npm are updated by those
instead.

It listens on `localhost:3001` and answers only gobo's own pages: the hosted
app, and pages served from this computer. `--lan` (or `GOBO_LAN=1`) lets other
devices on the network open a copy served from here; web pages are still
checked, but any program on that network can connect, so use it only on a
network you trust.

Defaults to `mock` with no config file, which sends nothing, and waits for the
app to choose an output.

## No Node?

The downloads above are single executables with Node inside. Nothing else to
install.

Using a USB DMX interface? You need none of this. The browser drives it
directly over WebSerial: click `usb` in the app.

## Licence

MIT
