/**
 * Reference panel. Renders the user-facing API docs.
 *
 * The content here mirrors what is available in the eval sandbox
 * (see packages/core/src/eval.ts). Keep this in sync when the API changes.
 *
 * The bundled examples live here too, under their own tab. They used to hang
 * off a separate top-bar menu, which put the working scenes and the reference
 * that explains them in two different places.
 */

import { EXAMPLES } from './examples.js';

interface DocEntry {
  name: string;
  signature: string;
  description: string;
  example?: string;
  /**
   * When present, the entry renders as a button that loads the bundled
   * example with this id into the editor. Kept as an id rather than a
   * callback so the docs stay declarative data; the click is announced as an
   * event and the buffer logic lives where the buffer does.
   */
  loadExample?: string;
  /**
   * When present, the entry renders as a compact clickable row that
   * switches the docs panel to the named tab. Used on the welcome page so
   * each step links to its own tab instead of duplicating content here.
   */
  tabLink?: DocCategory;
}

interface DocSection {
  title: string;
  blurb?: string;
  entries: DocEntry[];
  /** Tab this section lives under. Sections without a category fall into
   *  'reference'. */
  category?: DocCategory;
}

/**
 * Tab categories shown across the top of the docs panel. Order here is the
 * order they appear. DEFAULT_TAB is the walkthrough, so new users do not
 * land on the reference list.
 */
type DocCategory = 'welcome' | 'examples' | 'patterns' | 'fixtures' | 'viz' | 'output' | 'reference';

// Tab layout: welcome · patterns · fixtures · viz · output · reference.
// The viz tab covers the inline editor decorations.
const DOC_TABS: Array<{ id: DocCategory; label: string }> = [
  { id: 'welcome',   label: 'welcome' },
  { id: 'examples',  label: 'examples' },
  { id: 'patterns',  label: 'patterns' },
  { id: 'fixtures',  label: 'fixtures' },
  { id: 'viz',       label: 'viz' },
  { id: 'output',    label: 'output' },
  { id: 'reference', label: 'reference' },
];

const DEFAULT_TAB: DocCategory = 'welcome';

const DOCS: DocSection[] = [
  // ─── examples ───────────────────────────────────────────────────────────
  // Built from the bundled scenes rather than written out, so a scene added
  // or removed in examples.ts appears or disappears here with no second edit.
  {
    category: 'examples',
    title: 'bundled scenes',
    blurb:
      'Working scenes to read or take apart. Loading one replaces what is in the editor, so save first if you want to keep it.',
    entries: EXAMPLES.map((ex) => ({
      name: ex.label,
      signature: `${ex.code.split('\n').length} lines`,
      description: ex.blurb,
      loadExample: ex.id,
    })),
  },

  // ─── welcome ────────────────────────────────────────────────────────────
  // Everything actionable lives in its own tab. This page is a short intro
  // plus a link list.
  {
    category: 'welcome',
    title: 'gobo',
    blurb:
      'Live DMX coding in the browser. JavaScript patterns drive real fixtures: a USB DMX box, TouchDesigner, Art-Net or sACN hardware, or nothing but the simulation. Ctrl+Enter runs your code, Ctrl+. stops. Hover a fixture in the sim panel for its live channel values.',
    entries: [],
  },
  {
    category: 'welcome',
    title: 'scenes and files',
    blurb:
      "You edit one scene at a time. It autosaves to the browser as you type, so a refresh costs nothing. Click its name in the top bar to rename it. save downloads the scene as a .js file, open reads one back, share copies a link that carries the whole scene, and examples loads a bundled demo. Anything that replaces the buffer arrives stopped, and asks first if you have changes not yet saved to a file. One example, ultratronics 11, is a live-performance template built around instrument functions you toggle while a track plays.",
    entries: [],
  },
  {
    category: 'welcome',
    title: 'steps',
    entries: [
      { name: 'pick an output',   signature: 'usb · td · artnet · sacn · osc · mock',  description: '', tabLink: 'output' },
      { name: 'define fixtures',  signature: 'fixture · rgbStrip · defineFixture',     description: '', tabLink: 'fixtures' },
      { name: 'write patterns',   signature: 'sine · cosine · square · saw · chains',  description: '', tabLink: 'patterns' },
      { name: 'inline viz',       signature: ".viz · .flash · .glow · .wave",          description: '', tabLink: 'viz' },
      { name: 'low-level DMX',    signature: 'ch · uni · dim · rgb',                   description: '', tabLink: 'reference' },
    ],
  },

  {
    category: 'output',
    title: 'output',
    blurb:
      'Pick where DMX data goes. Call exactly one of these at the top of your code. Switching while running reconfigures on the fly. Two of the six work in a plain browser with nothing installed, usb() and td(); artnet(), sacn(), osc() and mock() need the connector running on this machine.',
    entries: [
      {
        name: 'artnet',
        signature: "artnet(host='127.0.0.1', port=6454)",
        description:
          "Needs the connector: not a plain-browser output, because a web page cannot put network packets on the wire itself. Send Art-Net DMX packets via the bridge. host is the DESTINATION, never your own machine: either the IP printed on your node, or the broadcast address of the subnet your rig is on (192.168.0.255 reaches everything on 192.168.0.x). Your computer must already be on that same subnet, which is the usual reason nothing arrives. Port defaults to 6454. One ArtDmx packet per universe per tick, so multi-universe works by putting fixtures on different universes.",
        example: "artnet('2.0.0.100')",
      },
      {
        name: 'osc',
        signature: "osc(host='127.0.0.1', port=9000)",
        description:
          'Needs the connector: OSC travels as the same kind of network packet as Art-Net, so it is not an install-free option. Send every active channel as an OSC message via the bridge. host is the DESTINATION: the machine running the receiver, or 127.0.0.1 if that is this machine. Address format: /gobo/<universe>/<channel>, one float arg in [0,1]. Works with the TouchDesigner OSC In CHOP.',
        example: "osc('127.0.0.1', 9000)",
      },
      {
        name: 'sacn',
        signature: 'sacn(universe=1, priority=100)',
        description:
          'Needs the connector, for the same reason as Art-Net. Multicast sACN (E1.31) packets via the bridge. Priority 1-200, universe 1-63999.',
        example: 'sacn(1, 100)',
      },
      {
        name: 'td',
        signature: "td(host='localhost', port=9980)",
        description:
          "Works in a plain browser, as long as TouchDesigner is already open on this machine with a WebSocket DAT listening. Send straight to a TouchDesigner WebSocket DAT from the browser, with no gobo bridge running. TD receives the frames and puts Art-Net on the wire, so this works from the hosted site on any machine that already has TD open. A page served over https can only reach localhost this way, since browsers block insecure WebSockets to any other host, so TD has to be on the same machine. Setup recipe is in docs/touchdesigner.md.",
        example: "td('localhost', 9980)",
      },
      {
        name: 'usb',
        signature: 'usb()',
        description:
          "Works in a plain browser, with a USB DMX box plugged into this computer and Chrome or Edge. Drive a USB DMX interface straight from the browser, with nothing installed at all. Click usb in the top bar first to choose the device (browsers require a click for that, so a scene cannot do it), then call usb() to select it as the output. Speaks the Enttec DMX USB Pro protocol, which most interfaces use; raw FTDI dongles that expect the host to time the DMX break are not supported. One universe, the primary one.",
        example: 'usb()',
      },
      {
        name: 'mock',
        signature: 'mock()',
        description:
          "Needs the connector, because the printing happens inside it. Console-log mode: nothing goes out over UDP or WebSocket; the bridge prints active channels ~2x per second. Use it to verify patterns with the rig off.",
        example: 'mock()',
      },
    ],
  },

  // Why four of the six need a program on this machine. Kept as its own
  // section rather than repeated per entry: it is one rule, and it is the
  // question someone asks once, when the rig stays dark.
  {
    category: 'output',
    title: 'why a browser cannot send art-net',
    blurb:
      'Art-Net, sACN and OSC go out as network packets, and a web page is not allowed to put packets on the network by itself. That is a rule every browser enforces, not something gobo can switch off. The connector is a small program that runs on this machine and does the sending; while it is running, artnet(), sacn(), osc() and mock() all work. Without it, usb() and td() are the two outputs that reach real light from the page alone: a serial port is something a browser may open, and so is a WebSocket to TouchDesigner, which puts the Art-Net out for you.',
    entries: [],
  },

  {
    category: 'patterns',
    title: 'clock',
    entries: [
      {
        name: 'setBPM',
        signature: 'setBPM(bpm)',
        description:
          'Set the scheduler tempo. One pattern cycle is 4 beats (a bar), so .fast(4) gives one pulse per beat at any tempo. At 120 BPM a cycle lasts 2 seconds.',
        example: 'setBPM(128)',
      },
    ],
  },

  {
    category: 'fixtures',
    title: 'fixtures',
    blurb:
      'Load a fixture at a DMX start channel; you get back an object with named setters for every channel that fixture has.',
    entries: [
      {
        name: 'fixture',
        signature: "fixture(startChannel, id, universe=0)",
        description:
          "Create a fixture instance. Returns an object with one setter per named channel (e.g. .red(), .dim(), .pan()) plus generic helpers .color(r,g,b[,w]), .off(), .full(). Built-in ids: dim, rgb, rgbw, rgba, dim-rgb, dim-rgbw, moving-head-basic, moving-head-spot, strobe. (The old `generic-*` ids still resolve via alias.) Universe defaults to 0 (matches Art-Net / TouchDesigner's first-universe convention).",
        example:
          "const wash = fixture(1, 'rgbw')\nwash.color(1, 0, 0, 0.3)        // red + a touch of white\nwash.red(sine().slow(4))         // or pick channels directly\n\n// Second universe\nconst par2 = fixture(1, 'rgbw', 1)",
      },
      {
        name: 'defineFixture',
        signature: 'defineFixture(id, def)',
        description:
          "Register a custom fixture. def has { name, manufacturer, type, channelCount, channels:[{offset,name,type}] }. After this, fixture(addr, id) works with your own id.",
        example:
          "defineFixture('my-par', {\n  name: 'My PAR',\n  manufacturer: 'Acme',\n  type: 'rgbw',\n  channelCount: 5,\n  channels: [\n    {offset:0, name:'dim',   type:'intensity'},\n    {offset:1, name:'red',   type:'color'},\n    {offset:2, name:'green', type:'color'},\n    {offset:3, name:'blue',  type:'color'},\n    {offset:4, name:'white', type:'color'},\n  ]\n})",
      },
      {
        name: 'listFixtures',
        signature: 'listFixtures()',
        description: 'Returns an array of every registered fixture id (built-in + custom).',
        example: 'console.log(listFixtures())',
      },
      {
        name: 'rgbStrip',
        signature: 'rgbStrip(startChannel, pixelCount, universe=0)',
        description:
          'Variable-length RGB pixel strip. Each pixel = 3 channels (R,G,B) laid out contiguously, so 40 pixels = 120 channels. Returns an object with .fill(), .pixel(i, r, g, b), .red(), .green(), .blue(), plus .pixelCount / .channelCount / .startChannel.',
        example:
          "const strip = rgbStrip(1, 40)\nstrip.fill(sine().slow(4), 0, cosine().slow(4))\n\n// per-pixel chase\nfor (let i = 0; i < strip.pixelCount; i++) {\n  strip.pixel(i, sine().slow(4).add(i/strip.pixelCount), 0, 0)\n}",
      },
      {
        name: 'rgbwStrip',
        signature: 'rgbwStrip(startChannel, pixelCount, universe=0)',
        description:
          'RGBW pixel strip. Each pixel = 4 channels (R,G,B,W) laid out contiguously, so 8 pixels = 32 channels. Same shape as rgbStrip, but every setter takes an extra white arg and there is a .white(v) setter. The white channel is a separate LED emitter that adds to the colour mix, for warm highlights or true whites.',
        example:
          "const bar = rgbwStrip(1, 8, 1)    // 8 px, universe 1\nbar.fill(sine().slow(4), 0, cosine().slow(4), 0.2)\nbar.pixel(0, 1, 0, 0, 0)           // pixel 0 red\nbar.white(0.1)                      // low white on every pixel",
      },
      {
        name: 'strip channel (in defineFixture)',
        signature: "{ offset, name, type: 'strip', pixelCount: N, pixelLayout?: 'rgb' | 'rgbw' }",
        description:
          "Inside defineFixture(), a channel with type 'strip' claims pixelCount × channelsPerPixel DMX channels starting at its offset and exposes a nested StripInstance on the fixture. pixelLayout defaults to 'rgb' (3 chs/pixel); set it to 'rgbw' for a 4-ch-per-pixel RGBW strip, which gives you .fill(r,g,b,w), .pixel(i,r,g,b,w), and a .white(v) setter. Scalar channels before and after work normally, so a dimmer, a strobe, and a pixel segment can live in one fixture.",
        example:
          "defineFixture('my-bar', {\n  name: 'Custom Bar', manufacturer: 'Generic', type: 'generic',\n  channelCount: 12,\n  channels: [\n    { offset: 0,  name: 'dim',    type: 'intensity' },\n    { offset: 1,  name: 'strobe', type: 'strobe' },\n    { offset: 2,  name: 'pixels', type: 'strip', pixelCount: 3 }, // ch 3-11\n    { offset: 11, name: 'mode',   type: 'control' },\n  ],\n})\nconst bar = fixture(100, 'my-bar')\nbar.dim(0.8)\nbar.pixels.fill(sine(), 0, 0)\nbar.pixels.pixel(1, 1, 0, 0)",
      },
      {
        name: 'fixture library',
        signature: "open the 'library' panel in the top bar",
        description:
          "Three tiers of fixture definitions: (1) built-ins in the core (dim, rgb, rgbw, etc.), always available; (2) public library, community-contributed files in fixtures/ at the repo root, bundled into the app; (3) your library, anything you defined and pinned locally via localStorage. The library panel shows the public bundle and your pinned/session entries with save / export / delete / share actions. Share opens a pre-filled GitHub page to propose your fixture as a PR to the public library. Every incoming fixture (file import or public bundle) is schema-validated against size and type limits, and rejected if its id collides with a built-in.",
      },
    ],
  },

  {
    category: 'viz',
    title: 'pattern viz',
    blurb:
      "Opt-in per-pattern editor decorations. Chain .flash() / .glow() / .wave() onto any pattern (sine/square/cosine/saw/rand, mini-notation) and the editor line lights up with live feedback. Methods return the pattern unchanged so you can still pass it into a fixture setter. Never on by default.",
    entries: [
      {
        name: '.flash',
        signature: "sine().fast(2).flash()",
        description:
          "Pulses the editor line's background on each rising edge above mid-scale. Best for anything with a clear on/off shape: beats, strobes, square waves. Refractory period is ~140ms, so a sustained-high value doesn't strobe the UI.",
        example: 'spot.dim(square().fast(1).flash())',
      },
      {
        name: '.glow',
        signature: 'sine().slow(4).glow()',
        description:
          "Left-to-right background rail whose intensity tracks the pattern's current value 0..1. Best for slow, smooth patterns such as sines and envelopes.",
        example: 'washA.red(sine().slow(4).range(0, 0.9).glow())',
      },
      {
        name: '.wave',
        signature: 'sine().slow(6).wave()',
        description:
          "Tiny inline sparkline at the end of the line showing the last ~1 second of the pattern's sample values. Like .viz('wave') but attached to a specific pattern call rather than a whole fixture.",
        example: 'washA.white(sine().slow(6).range(0, 0.4).wave())',
      },
    ],
  },

  {
    category: 'viz',
    title: 'fixture viz',
    blurb:
      'Opt-in per-fixture editor visualizations. Chain .viz(kind) onto a fixture or strip and a live widget appears at the end of that line, driven from the current DMX buffer at ~60fps. Nothing happens until you add a .viz() call.',
    entries: [
      {
        name: '.viz',
        signature: ".viz(...kinds)",
        description:
          "Attach one or more inline widgets to this fixture. Kinds: 'color' (mixed-output swatch), 'wave' (scrolling intensity scope), 'meter' (vertical bar), 'strip' (row of mini pixels, for rgbStrip). Multiple kinds stack side-by-side. Returns the fixture so you can keep chaining.",
        example:
          "const washA = fixture(1, 'rgbw').viz('color')\nconst spot  = fixture(9, 'dim').viz('wave', 'meter')\nconst strip = rgbStrip(12, 10).viz('strip')",
      },
      {
        name: 'color',
        signature: ".viz('color')",
        description:
          "Mixed-output colour swatch. For RGB/RGBW fixtures, mixes the red/green/blue/white channels additively and glows at the resulting colour. Best for wash fixtures.",
      },
      {
        name: 'wave',
        signature: ".viz('wave')",
        description:
          "Mini scrolling oscilloscope. Plots the fixture's dominant intensity over the last ~1 second. Best for dimmer and strobe fixtures, where the shape of the modulation matters: square, sine, saw.",
      },
      {
        name: 'meter',
        signature: ".viz('meter')",
        description:
          'Vertical bar showing current intensity 0-100%. Compact enough to put many fixtures on adjacent lines without eating horizontal space.',
      },
      {
        name: 'strip',
        signature: ".viz('strip')",
        description:
          'Row of tiny pixel dots, one per rgbStrip pixel, each showing its current RGB colour. Only makes sense for rgbStrip; on a regular fixture it renders an empty row.',
      },
    ],
  },

  {
    category: 'fixtures',
    title: 'generic helpers',
    blurb:
      'Every fixture instance, built-in or user-defined, has these helpers in addition to per-channel setters. The same call works whether the fixture has a master dimmer, RGB, RGBW, or an embedded strip.',
    entries: [
      {
        name: '.color',
        signature: '.color(r, g, b [, w])',
        description:
          'Set red / green / blue (and optionally white) in one call. Channels absent on the fixture are silently skipped so the same line works on rgb, rgbw, dim-rgb, dim-rgbw, and moving heads. Each argument can be a constant 0..1 or a pattern.',
        example:
          "wash.color(1, 0, 0)              // red\nwash.color(1, 0, 0, 0.3)         // RGBW: red + a touch of white\nwash.color(sine(), 0, cosine())  // animated",
      },
      {
        name: '.off',
        signature: '.off()',
        description:
          "Zero every light-emitting channel and every pixel of any embedded strip. A channel counts as emitting if its type is 'intensity', or its name is a colour role (red, warm, uv, amber, cw …), so a warm/cold blinder goes dark like anything else. Channels that steer or shape (pan, tilt, focus, a slotted wheel) are left alone, so a blackout does not lose your aim. A fixture with nothing to darken throws rather than quietly doing nothing.",
        example: 'wash.off()',
      },
      {
        name: '.full',
        signature: '.full()',
        description:
          'Drive every light-emitting channel to 1, by the same rule as .off(). On dim-RGB(W) fixtures this brings the dimmer AND every colour channel up together.',
        example: 'wash.full()',
      },
      {
        name: '.set',
        signature: '.set(channelName, value)',
        description: 'Set any scalar channel by name. Useful when a channel name clashes with something else, or for less common channels that don\'t have a convenience method.',
        example: "head.set('zoom', 0.5)",
      },
      {
        name: '.channels',
        signature: '.channels()',
        description: 'List the channel names exposed by this fixture.',
        example: 'console.log(wash.channels())',
      },
    ],
  },

  {
    category: 'fixtures',
    title: 'grids',
    blurb:
      'A pixel wash is usually a rectangle, not a line. Tell a strip how wide it is and it can be addressed by position.',
    entries: [
      {
        name: 'columns',
        signature: 'rgbStrip(start, count, uni, { columns })',
        description:
          "Declare how many pixels make up a row and the strip becomes a grid: width, height, pixelXY, row, column and eachXY all start working. Without it a strip is a single row, and those same methods still work on it. Declare it on a fixture's strip channel instead and the shape travels with the fixture, so scenes never repeat it.",
        example:
          "const grid = rgbStrip(1, 48, 0, { columns: 12 })   // 12 across, 4 down\ngrid.width   // 12\ngrid.height  // 4\n\n// or on the fixture, so scenes never repeat the shape:\n// { name: 'pixels', type: 'strip', pixelCount: 48, pixelLayout: 'rgb', columns: 12 }\n// then reach it as wash.pixels",
      },
      {
        name: 'serpentine',
        signature: '{ columns, serpentine: true }',
        description:
          'A matrix folded out of one strip has its odd rows wired backwards, so grid x = 0 is physically the last pixel of that row. Nothing in the channel count reveals this, so the fixture has to say. Get it wrong and every other row is mirrored, which only shows up on the hardware.',
        example: 'const bar = rgbStrip(1, 32, 0, { columns: 8, serpentine: true })',
      },
      {
        name: 'origin',
        signature: "{ origin: 'bottom-right' }",
        description:
          "Which physical corner DMX pixel 0 sits in. Default is 'top-left', the way an image is read, but plenty of fixtures scan the other way: a cheap matrix strobe can start at the bottom right and run right to left then upward. Declare the corner and the whole API stays in picture terms, so (0, 0) is the top left on every fixture whatever its wiring does. A single row uses only the horizontal half, so 'top-right' is how you reverse one.",
        example:
          "// 48 pixels wired from the bottom right, right to left, then upward\n{ name: 'pixels', type: 'strip', pixelCount: 48, pixelLayout: 'rgb',\n  columns: 12, origin: 'bottom-right' }",
      },
      {
        name: 'picture order, always',
        signature: '.pixel(i) and .each() too',
        description:
          'Origin and serpentine apply to every way of addressing a strip, not just pixelXY. Counting with .pixel(i) or walking with .each() runs along the top row of the picture and continues onto the next, so a left-to-right chase reads left to right on the light even when the wire runs the other way. With the default origin and no serpentine this is the identity, so nothing written before grids existed changes.',
        example:
          "seg.each((p, i) => mini('1 - - -').early(p))   // sweeps left to right on the light",
      },
      {
        name: 'one channel per cell',
        signature: "pixelLayout: 'mono'  ·  monoStrip(start, count)",
        description:
          "A segmented white strobe strip, a bar of plain dimmers, a row of single-colour cells: one channel each, no colour to mix. It carries the same geometry as the colour strips, so a chase written for one works here, with a level in place of the colour.",
        example:
          "const seg = monoStrip(147, 8)         // eight white strobe segments\nseg.fill(0.5)\nseg.each((p, i) => mini('1 - - -').early(p))",
      },
      {
        name: '.pixelXY / .row / .column',
        signature: '.pixelXY(x, y, …)  ·  .row(y, …)  ·  .column(x, …)',
        description:
          'Address by position instead of index. x runs left to right, y top to bottom, both 0-indexed. Value shapes are the same as .pixel(): a level, or the full colour. A position outside the grid throws rather than wrapping onto the wrong pixel.',
        example:
          "grid.pixelXY(3, 1, 1, 0, 0)   // column 3, row 1, red\ngrid.row(0, 1, 1, 1)          // top row white\ngrid.column(11, 0, 0, 1)      // last column blue",
      },
      {
        name: '.eachXY(fn)',
        signature: '.eachXY((x, y, w, h) => value)',
        description:
          'each() for when the shape matters. The callback runs once per pixel with its position and the grid size, and returns a level or [r, g, b]. This is how you write a sweep across the columns, a wipe down the rows, or a diagonal, without computing i % width anywhere.',
        example:
          "grid.eachXY((x, y, w) => sine().early(x / w).slow(4))         // sweep across\ngrid.eachXY((x, y, w, h) => sine().early(y / h).slow(2))      // wipe down\ngrid.eachXY((x, y, w, h) => sine().early((x + y) / (w + h)))  // diagonal",
      },
    ],
  },

  {
    category: 'fixtures',
    title: 'wheels and slots',
    blurb:
      'A moving head picks its colour, gobo and prism by driving one channel into a documented range. Name those ranges once and scenes read in words.',
    entries: [
      {
        name: 'slots',
        signature: "{ name: 'color', type: 'color', slots: [ … ] }",
        description:
          "Declare the named positions on a selector channel. Each slot is a name plus either a single value or the from/to range the manual quotes. gobo aims at the middle of a range, because hardware often treats a boundary as belonging to the neighbouring slot.",
        example:
          "{ offset: 3, name: 'color', type: 'color', slots: [\n  { name: 'open',  value: 0 },\n  { name: 'red',   from: 10, to: 19 },\n  { name: 'blue',  from: 20, to: 29 },\n] }",
      },
      {
        name: 'picking a slot',
        signature: "head.color('red')",
        description:
          'The setter takes a slot name as well as a level, so the manual stays shut. Names match regardless of case, spaces, hyphens and underscores. A name the channel does not have throws and lists the ones it does. A raw DMX number still works if you want one.',
        example:
          "head.color('red')\nhead.gobo('dots')\nhead.prism('3-facet')\nconsole.log(head.slots('color'))   // list them",
      },
      {
        name: 'stepping through slots',
        signature: "head.color(mini('<red blue green>'))",
        description:
          'A pattern of slot names works too, so a wheel can change per bar or per step like anything else. Unknown names in a pattern read as 0 and are reported once to the console rather than every frame.',
        example:
          "head.color(mini('<red blue green>'))       // one per bar\nhead.gobo(mini('open dots open star'))     // four per bar",
      },
      {
        name: 'a slot is not a light',
        signature: 'off() and full() skip it',
        description:
          'A channel carrying slots selects rather than emits, so .off() and .full() leave it exactly where it is, the same way they already leave pan and tilt. A blackout kills the output without spinning your colour wheel to whatever sits at 255.',
        example: "head.color('red')\nhead.full()   // dimmer to full, wheel still on red",
      },
    ],
  },

  {
    category: 'fixtures',
    title: 'groups',
    blurb:
      'Several fixtures, strips and pixels addressed as one. A group answers the same verbs a fixture does, so a line written for one par works across a whole rig unchanged.',
    entries: [
      {
        name: 'group',
        signature: 'group(...members)',
        description:
          "Takes fixtures, strips, a fixture's .pixels, and other groups. Members keep the order you write them in, which is the order .each() walks. A role a member does not have is skipped, so one line covers a mixed rig; a role NO member has throws, because that would otherwise be a silent no-op.",
        example:
          "const rig = group(washA, washB, bar.pixels)\nrig.red(sine().slow(4))\nrig.color(1, 0, 0)\nrig.off()",
      },
      {
        name: 'how members count',
        signature: 'rig.size',
        description:
          'A fixture is one element however many channels it has. A strip is one element per pixel. So pass the fixture to move it as a unit, and pass its .pixels to move the pixels. Nested groups flatten.',
        example:
          "group(washA, washB, rgbStrip(7, 4)).size   // 6: two pars and four pixels",
      },
      {
        name: '.each',
        signature: '.each((phase, i, count) => value)',
        description:
          'Run one gesture across the whole group in order. phase is i / count, the same signature the strips use, so a chase written for one strip works across a rig of mixed fixtures. Return a number for brightness, or [r, g, b] / [r, g, b, w] for colour. Roles the array does not name are left alone.',
        example:
          "const rig = group(washA, washB, bar.pixels, strip)\nrig.each(p => sine().early(p).slow(4))          // one ramp, whole rig\nrig.each(p => [sine().early(p), 0, cosine().early(p)])",
      },
      {
        name: 'brightness on a mixed rig',
        signature: 'a single-value .each()',
        description:
          "A number from .each() means brightness, and each element expresses that its own way: a fixture with a dimmer moves the dimmer and keeps its colour, a fixture without one drives r/g/b together, and a pixel does the same. That is why a fade across a mixed rig does not repaint the look.",
        example:
          "washA.color(1, 0, 0)                 // dim-rgb par, red\ngroup(washA, bar.pixels).each(() => 0.5)   // par half-bright, still red",
      },
    ],
  },

  {
    category: 'fixtures',
    title: 'built-in fixture catalogue',
    blurb:
      'Short ids: write fixture(1, \'rgbw\'), not fixture(1, \'generic-rgbw\'). Old generic-* ids still resolve via alias, so legacy scenes keep working.',
    entries: [
      {
        name: 'dim',
        signature: '.dim(v)',
        description: 'Single-channel dimmer: tungsten par, smoke machine, UV flood.',
      },
      {
        name: 'rgb',
        signature: '.red(v)  .green(v)  .blue(v)',
        description: '3-channel RGB PAR, no dedicated dimmer. Use .color(r,g,b) for the common path.',
      },
      {
        name: 'rgbw',
        signature: '.red(v)  .green(v)  .blue(v)  .white(v)',
        description: '4-channel RGBW. Dim by modulating the colour channels directly, or call .full() / .off().',
      },
      {
        name: 'rgba',
        signature: '.red(v)  .green(v)  .blue(v)  .amber(v)',
        description: '4-channel RGBA. Amber takes the role of W on some fixtures, giving better warm tones.',
      },
      {
        name: 'dim-rgb',
        signature: '.dim(v)  .red(v)  .green(v)  .blue(v)',
        description: '4-channel with a master dimmer on top of RGB.',
      },
      {
        name: 'dim-rgbw',
        signature: '.dim(v)  .red(v)  .green(v)  .blue(v)  .white(v)',
        description: '5-channel with master dimmer plus RGBW.',
      },
      {
        name: 'moving-head-basic',
        signature: '.pan  .tilt  .dim  .strobe  .red  .green  .blue  .white',
        description: '8-channel moving head. Pan/tilt are 0..1 over full travel.',
      },
      {
        name: 'moving-head-spot',
        signature: '.pan  .panFine  .tilt  .tiltFine  .speed  .dim  .strobe  .zoom  .gobo  .colorWheel  .prism  .focus',
        description: '12-channel moving head spot. (colorWheel was renamed from `color` to free .color() for the generic RGB helper.)',
      },
      {
        name: 'strobe',
        signature: '.dim(v)  .strobe(v)',
        description: '2-channel strobe. .dim is overall brightness, .strobe is flash rate.',
      },
    ],
  },

  {
    category: 'reference',
    title: 'low-level dmx',
    blurb:
      "Direct channel addressing. Use these when a fixture abstraction isn't worth it.",
    entries: [
      {
        name: 'ch',
        signature: 'ch(channel, value)',
        description: 'Set a channel on universe 1. 1-indexed (1-512).',
        example: 'ch(1, sine().slow(2))',
      },
      {
        name: 'uni',
        signature: 'uni(universe, channel, value)',
        description: 'Set a channel on a specific universe.',
        example: 'uni(2, 10, 0.8)',
      },
      {
        name: 'dim',
        signature: 'dim(channel, value)',
        description: 'Alias for ch(). Reads nicely when the channel is a dimmer.',
        example: 'dim(9, square().fast(1))',
      },
      {
        name: 'rgb',
        signature: 'rgb(startChannel, r, g, b)',
        description: 'Shortcut for 3 consecutive channels.',
        example: 'rgb(1, sine(), 0, cosine().slow(3))',
      },
    ],
  },

  {
    category: 'patterns',
    title: 'effects',
    blurb:
      "Higher-level scene recipes exposed as methods on strip / pixel instances. Call them the same way you'd call any other strip method (.fill, .pixel, etc.).",
    entries: [
      {
        name: '.rainbowChase',
        signature: 'strip.rainbowChase({ speed?, narrow?, rainbowSpeed?, packets? })',
        description:
          "A single bright pixel sweeps across the strip while its colour walks the hue wheel. Each pixel gets a cosine brightness envelope offset by its position (.early(i/N) shifts pixel i's peak later in the cycle), thresholded via .range(-narrow, 1) so most of the cycle sits below zero. The DMX pipeline clamps negatives to 0, leaving the tip above zero as the lit window. Bigger `narrow` gives a narrower window and fewer pixels lit at once. The hue comes from three sines 120° apart on R/G/B, so only one primary peaks at a time. Defaults: speed 2 beats/pass, narrow 8, rainbowSpeed 12 beats/cycle, packets 1. Works on RGB (rgbStrip) and RGBW (rgbwStrip, bar.pixels) instances; RGBW gets W zeroed so colours stay pure.",
        example:
          "strip.rainbowChase()\nstrip.rainbowChase({ speed: 0.5, narrow: 16 })\nbar.pixels.rainbowChase({ packets: 2, rainbowSpeed: 4 })",
      },
      {
        name: 'manual chase',
        signature: 'for (let i = 0; i < strip.pixelCount; i++) strip.pixel(i, …)',
        description:
          "Any chase can be written inline with a for-loop, which gives finer control than the built-in helper. Walk each pixel index i, compute its phase offset (i/pixelCount), and call strip.pixel(i, r, g, b [, w]) with patterns whose time is shifted by that phase. The starter example uses this form on the universe-0 strip.",
        example:
          "for (let i = 0; i < strip.pixelCount; i++) {\n  const phase = i / strip.pixelCount\n  const bright = cosine().early(phase).slow(2).range(-8, 1)\n  strip.pixel(i, bright.mul(hueR), bright.mul(hueG), bright.mul(hueB))\n}",
      },
      {
        name: '.pixelGrid',
        signature: 'strip.pixelGrid(rows).{repeat,hold,mirror}()',
        description:
          "Set pixels from an array-of-rows. Each inner array is one pixel: [r, g, b] for RGB strips, [r, g, b, w] for RGBW. Missing channels default to 0 so [1] is a valid 'red only' row. Pixels past the end of the input default to 0; chain a fill method for something else: .repeat() tiles the input across the whole strip, .hold() copies the last input pixel forward, .mirror() reflects the input back so the strip reads symmetrically.",
        example:
          "// 8-pixel RGBW strip, pattern of 2, tiled\nbar.pixels.pixelGrid([\n  [1, 0, 0, 0],   // red\n  [0, 0, 1, 0],   // blue\n]).repeat()\n\n// 3-pixel input, mirrored: r,g,b,b,g,r,r,b\nbar.pixels.pixelGrid([\n  [1, 0, 0, 0],\n  [0, 1, 0, 0],\n  [0, 0, 1, 0],\n]).mirror()",
      },
    ],
  },

  {
    category: 'patterns',
    title: 'patterns',
    blurb:
      'Waveform and pattern builders. Output is normalised to 0-1 unless stated.',
    entries: [
      {
        name: 'sine',
        signature: 'sine()',
        description: 'Sine wave, one full cycle per beat, output 0-1. Smooth breathing motion.',
        example: 'washA.red(sine())',
      },
      {
        name: 'cosine',
        signature: 'cosine()',
        description: 'Same as sine but 90° ahead. Useful for phase-offset pairs.',
        example: 'washA.red(sine())\nwashA.blue(cosine())',
      },
      {
        name: 'square',
        signature: 'square()',
        description: 'Square wave 0/1. Instant on/off.',
        example: 'spot.dim(square().fast(2))',
      },
      {
        name: 'saw',
        signature: 'saw()',
        description: 'Linear ramp 0→1, jumps back to 0 each cycle.',
        example: 'myPar.amber(saw().slow(8))',
      },
      {
        name: 'rand',
        signature: 'rand()',
        description: 'Uniform random 0-1, resampled per query.',
        example: 'ch(1, rand())',
      },
    ],
  },

  {
    category: 'patterns',
    title: 'sequencing',
    blurb:
      "Step sequencing via mini-notation. Each string plays through one scheduler cycle (= 4 beats at default BPM); tokens split the time equally. '-' and '~' are silence. Use one anywhere a channel setter expects a pattern; one mini call per channel gives the classic drum-grid. Supports subdivisions [a b], repeats *N, speed /N, and alternation <a b c>.",
    entries: [
      {
        name: 'mini',
        signature: "mini('1 - 0.5 -')",
        description:
          "Parse mini-notation into a Pattern<number>. Each space-separated token is one step; tokens split one scheduler cycle equally. Numeric tokens ('1', '0.5', '0') pass through as values, which gives per-step brightness. Non-numeric tokens ('bd', 'sd') become string events; the DMX pipeline treats unknown ones as 0. Aliased as m(). Returns a regular Pattern, so .slow / .fast / .range / .glow / .flash all chain afterward.",
        example:
          "spot.dim(mini('1 - 1 -'))\nwash.red(mini('1 0.5 0 0.5'))\nstrb.strobe(m('1 - 1 -').flash())",
      },
      {
        name: 'rests',
        signature: "'-' or '~'",
        description:
          "Silence. Nothing is emitted for that step. The two are interchangeable; most gobo examples use '-' for grid alignment.",
        example: "mini('1 - 1 -')          // hits on beats 1 and 3",
      },
      {
        name: 'subdivisions',
        signature: "[a b c]",
        description:
          "Wrap tokens in brackets to compress them into the time of ONE outer slot. [a b] plays at 2× the outer step rate, [a b c d] at 4×. Nest freely. Same idea as the drum-grid notation in live-coding sequencers, adapted for light values.",
        example:
          "wash.red(mini('1 [1 1] 1 -'))          // 5 hits per cycle\nstrb.strobe(mini('- [1 1 1 1] - [1 1 1 1]'))  // bursts on 2 and 4",
      },
      {
        name: 'repetition',
        signature: "a*N",
        description:
          "Repeat one token N times inside its slot. 'a*4' plays a four times in the space of one step. Difference from brackets: brackets compress multiple DIFFERENT tokens, *N repeats the SAME token.",
        example:
          "strb.strobe(mini('1*16'))             // 16 evenly-spaced hits per cycle\nwash.red(mini('0 0.5*3 1'))            // mixes speeds inside one pattern",
      },
      {
        name: 'weight',
        signature: 'a@N',
        description:
          "Give a token N slots' worth of the cycle instead of one. '1@3 0.2' is three quarters held then a quarter dim. The way to write an uneven bar without padding it out with repeats.",
        example: "spot.dim(mini('1@3 0.2'))            // long hold, short dip",
      },
      {
        name: 'replicate',
        signature: 'a!N',
        description:
          "Type a token N times without typing it N times: '1!3 0.2' is '1 1 1 0.2'. A light cannot tell three back-to-back hits at one level from a single held hit, so a!N and a@N put the same thing on the wire; pick whichever reads better in the string.",
        example: "wash.red(mini('1!3 0.2'))",
      },
      {
        name: 'polymeter',
        signature: '{a b, c d e}',
        description:
          'Curly braces run sequences of different lengths against each other, all stepping at the same rate, so they drift in and out of phase instead of being squeezed to fit. Add %N to set the step rate explicitly. Long phrases out of short strings.',
        example:
          "wash.red(mini('{1 0, 0.5 0.5 0.5}'))\nwash.red(mini('{1 0 0.5}%4'))",
      },
      {
        name: 'speed',
        signature: "a/N  ·  pattern.slow(N) / .fast(N)",
        description:
          "'/N' inside the mini string holds a token for N slots (slows just that token). .slow(N) and .fast(N) chained on the Pattern scale the whole string. .slow(2) turns a 4-step pattern into an 8-beat pattern, so every token lasts twice as long.",
        example:
          "wash.red(mini('1 - 1 -').slow(2))      // half-time\nwash.red(mini('1 1/2 1 1'))            // second token held for two slots",
      },
      {
        name: 'alternation',
        signature: "<a b c>",
        description:
          "Angle brackets pick ONE token per cycle, advancing each cycle. '<0 0.5 1 0.5>' gives brightness 0 on cycle 1, 0.5 on cycle 2, 1 on cycle 3, 0.5 on cycle 4, then loops. Useful for slowly-evolving motifs without writing a long string.",
        example:
          "wash.red(mini('<0 0.5 1 0.5>'))        // brightness cycles each 4 beats",
      },
      {
        name: 'sequence',
        signature: 'sequence(a, b, c, …)',
        description:
          'Same as mini but takes positional args instead of a string. Each arg is one step, and args can be patterns themselves, so step sequencing mixes with continuous waveforms.',
        example:
          "spot.dim(sequence(0, sine().slow(2), 1, 0.5))",
      },
      {
        name: 'cat',
        signature: 'cat(pat1, pat2, …)',
        description:
          'Concatenate patterns so each pat takes one full cycle before the next starts. Great for building long arrangements out of short motifs.',
        example:
          "wash.red(cat(mini('1 - 1 -'), mini('1 1 1 1')))",
      },
      {
        name: 'stack',
        signature: 'stack(pat1, pat2, …)',
        description:
          "Run patterns in parallel on one channel. Every pat is queried each tick and the BRIGHTEST value wins, the same highest-takes-precedence merge a lighting desk uses. That makes layers additive in the useful sense: adding one can only raise the channel, never darken it. A slow swell under a fast strobe is the usual reason to reach for it.",
        example:
          "spot.dim(stack(sine().slow(8).range(0.2, 0.5), mini('1 - - - 1 - - -')))",
      },
      {
        name: 'layering (comma)',
        signature: "mini('a b, c d')",
        description:
          "A comma inside a mini string is stack() in notation: each side is its own sequence over the same cycle, and they merge brightest-wins. Handy when the two rhythms have different step counts, since each side divides the cycle independently.",
        example:
          "wash.red(mini('1 - - -, 0.3 0.3 0.3 0.3 0.3 0.3'))   // accent over a bed",
      },
      {
        name: 'drum grid',
        signature: "one mini() per channel, same length",
        description:
          "Split the same 16-step rhythm across R/G/B/W, or across several fixtures. Match the bar count between strings and group tokens in fours so the columns line up, the way a drum-machine grid does. The starter example has a live version on the wash fixture.",
        example:
          "wash.red(  mini('1 - - -  - - 1 -  - - 1 -  - - - -'))\nwash.green(mini('- - 1 -  1 - - -  - - - -  - 1 - -'))\nwash.blue( mini('- 1 - -  - - - 1  - 1 - -  1 - - 1'))\nwash.white(mini('- - - 1  - - - -  - - - 1  - - - -'))",
      },
    ],
  },

  {
    category: 'patterns',
    title: 'chain methods',
    blurb:
      'Every pattern has these. Chain them left-to-right; each returns a new pattern.',
    entries: [
      {
        name: '.slow(n)',
        signature: 'pat.slow(n)',
        description:
          "Stretch the pattern to take n cycles instead of one. slow(4) = 4x slower, one full wave every 4 beats.",
        example: 'sine().slow(4)',
      },
      {
        name: '.fast(n)',
        signature: 'pat.fast(n)',
        description: 'Squeeze pattern into 1/n of a cycle. fast(2) = twice as fast.',
        example: 'square().fast(8)',
      },
      {
        name: '.range(lo, hi)',
        signature: 'pat.range(lo, hi)',
        description:
          'Rescale the 0-1 output into [lo, hi]. Essential for dimming a colour without killing its motion: sine().range(0, 0.8).',
        example: 'washA.red(sine().slow(4).range(0, 0.9))',
      },
      {
        name: '.add(n)',
        signature: 'pat.add(n)',
        description: 'Offset output by n. Often used to phase-shift: sine().add(0.5).',
        example: 'sine().add(0.5).range(0, 0.8)',
      },
      {
        name: '.mul(n)',
        signature: 'pat.mul(n)',
        description: 'Multiply output by n.',
        example: 'sine().mul(0.5)',
      },
      {
        name: '.range backwards',
        signature: 'pat.range(hi, lo)',
        description:
          'A high-to-low range inverts the pattern. range(1, 0) is the cheapest way to make one fixture the negative of another without writing a second pattern.',
        example:
          "washA.red(sine().slow(4).range(0, 1))\nwashB.red(sine().slow(4).range(1, 0))   // opposite swell",
      },
      {
        name: '.rangex(lo, hi)',
        signature: 'pat.rangex(lo, hi)',
        description:
          'Range on an exponential curve. Perceived brightness is not linear in DMX value, so a linear fade spends most of its time looking bright. rangex spreads the motion across the bottom of the scale, where the eye can see it. Keep lo above 0.',
        example: 'spot.dim(sine().slow(8).rangex(0.01, 1))',
      },
      {
        name: '.add / .mul with a pattern',
        signature: 'pat.add(otherPat)',
        description:
          'Both take a pattern as well as a number, which is how one pattern modulates another. add() shifts a waveform around by a stepped amount; mul() gates or scales it. The pattern being passed in keeps its own timing, so a slow sine can be chopped by a fast mini string.',
        example:
          "wash.red(sine().mul(mini('1 0.25 1 0.25')))    // sine, chopped\nwash.red(sine().add(mini('<0 0.5>')))          // shifts every other bar",
      },
    ],
  },

  {
    category: 'patterns',
    title: 'structure',
    blurb:
      'Operators that rearrange a pattern in time rather than change its values. All of these chain onto anything, mini strings included.',
    entries: [
      {
        name: '.struct(pat)',
        signature: 'pat.struct(mini(…))',
        description:
          'Take the values from this pattern and the rhythm from another. The usual way to drive a colour or a waveform with a rhythm you wrote separately, instead of building one pattern that carries both.',
        example: "wash.red(sine().slow(4).struct(mini('1 - 1 - 1 - - -')))",
      },
      {
        name: '.mask(pat)',
        signature: 'pat.mask(mini(…))',
        description:
          'Gate a pattern: it plays where the mask is on and is silent where the mask is off. Unlike struct, the underlying pattern keeps running underneath, so it comes back mid-motion rather than restarting. Good for cutting a running effect in and out.',
        example: "wash.red(sine().slow(2).mask(mini('1 1 - -')))",
      },
      {
        name: '.segment(n)',
        signature: 'pat.segment(n)',
        description:
          'Sample a continuous waveform n times per cycle, turning a smooth fade into n discrete steps. This is how you get a stepped look out of sine() without giving up the shape of the curve.',
        example: 'spot.dim(sine().segment(8))         // 8 stepped levels per bar',
      },
      {
        name: '.every(n, fn)',
        signature: 'pat.every(n, p => …)',
        description:
          'Apply a transform on every nth cycle and leave the others alone. The standard way to make a repeating cue that varies without writing the variation out. firstOf and lastOf are the same idea with explicit ends.',
        example:
          "wash.red(mini('1 - 1 -').every(4, p => p.fast(2)))\nwash.red(mini('1 1 1 1').lastOf(8, p => p.mul(0.2)))   // dip on bar 8",
      },
      {
        name: '.iter(n)',
        signature: 'pat.iter(n)',
        description:
          'Rotate the pattern one step to the left each cycle, back to the start after n. A four-step cue becomes four bars of the same material entering at a different point. Cheap way to turn one bar into a phrase.',
        example: "bar.pixels.red(mini('1 0.6 0.3 0').iter(4))",
      },
      {
        name: '.chunk(n, fn)',
        signature: 'pat.chunk(n, p => …)',
        description:
          'Split the cycle into n parts and apply the transform to a different part each cycle, walking across. Reads as an effect travelling through a static pattern.',
        example: "wash.red(mini('1 1 1 1').chunk(4, p => p.mul(0.2)))",
      },
      {
        name: '.rev / .palindrome',
        signature: 'pat.rev()  ·  pat.palindrome()',
        description:
          'rev() plays the cycle backwards. palindrome() alternates forwards and backwards each cycle, which turns any chase into a bounce without writing the return leg.',
        example: "bar.pixels.red(mini('1 0.6 0.3 0').palindrome())",
      },
      {
        name: '.ply(n)',
        signature: 'pat.ply(n)',
        description:
          'Repeat each step n times inside its own slot, so the pattern keeps its length but gains subdivision. Takes a pattern too, so the subdivision itself can change bar to bar.',
        example: "strb.strobe(mini('1 0.5').ply(mini('<1 2 4 8>')))",
      },
      {
        name: '.linger(n)',
        signature: 'pat.linger(n)',
        description:
          'Play only the first n of the cycle and repeat it for the rest. linger(0.25) turns a bar into its first beat, four times. A stutter or a hold, depending on how small n is.',
        example: "wash.red(mini('1 0.6 0.3 0').linger(0.25))",
      },
      {
        name: '.late / .early',
        signature: 'pat.late(n)  ·  pat.early(n)',
        description:
          'Shift the whole pattern later or earlier by n cycles. Give the same pattern a different offset per fixture and a room lights in sequence off one line.',
        example: "washB.red(mini('1 - - -').late(0.25))",
      },
    ],
  },

  {
    category: 'patterns',
    title: 'layering',
    blurb:
      'Several values on one channel at the same instant. gobo merges them highest-takes-precedence, the same as a lighting desk, so a layer can raise a channel but never darken one.',
    entries: [
      {
        name: '.superimpose(fn)',
        signature: 'pat.superimpose(p => …)',
        description:
          'Play the pattern and a transformed copy of it together. The copy is layered on top, not substituted, so this is how you thicken a cue: the original stays exactly as it was.',
        example:
          "wash.red(mini('1 - - -').superimpose(p => p.late(0.125).mul(0.4)))",
      },
      {
        name: '.off(n, fn)',
        signature: 'pat.off(n, p => …)',
        description:
          'superimpose with the copy shifted n cycles later. The standard echo: one line gives you the hit and its dimmer repeat.',
        example:
          "wash.red(mini('1 - - -').off(0.25, p => p.mul(0.4)))",
      },
      {
        name: '.echoWith(n, t, fn)',
        signature: 'pat.echoWith(times, time, (p, i) => …)',
        description:
          'n copies, each shifted a further t cycles, each passed through the callback with its index. A decaying tail in one line. (The plain echo() is an audio effect and produces nothing on a DMX channel; this is the one to use.)',
        example:
          "wash.red(mini('1 - - -').echoWith(4, 0.125, (p, i) => p.mul(1 / (i + 1))))",
      },
      {
        name: 'per-channel, not per-fixture',
        signature: 'two calls to one setter',
        description:
          "Layering merges values on ONE channel. Two calls to the same setter do not merge: the second replaces the first, because the last call is the one that registers. To combine them, put both inside one stack() or one comma'd mini string.",
        example:
          "wash.red(mini('1 - - -'))\nwash.red(sine())                                  // replaces the line above\nwash.red(stack(mini('1 - - -'), sine().mul(0.3)))  // combines them",
      },
    ],
  },

  {
    category: 'patterns',
    title: 'long cues',
    blurb:
      'Writing something longer than a bar. A mini string is always one cycle no matter how it is typed, so length comes from slowing it down or from joining bars together.',
    entries: [
      {
        name: 'one string, many lines',
        signature: 'mini(`…`) with backticks',
        description:
          'Backticks let a mini string run across lines, and a newline counts as ordinary whitespace. Nothing about the timing changes, so an eight-bar cue can be laid out eight tokens to a line and read like a grid. Line up your columns and the shape of the cue is visible in the source.',
        example:
          "wash.red(mini(`\n  1 - - -  - - 1 -\n  - - 1 -  1 - - -\n  0.5 - 0.5 -  - - - -\n  1 1 - -  - - 1 1\n`).slow(4))",
      },
      {
        name: 'lines into bars',
        signature: 'mini(`…`).slow(n)',
        description:
          'Since the whole string is one cycle, .slow(n) spreads it over n bars. Write n lines of 4 and slow by n and each line is a bar. This is exactly equivalent to cat() of the same bars, and much easier to read at eight bars than eight separate mini() calls.',
        example:
          "// these two produce identical output\nwash.red(mini(`1 - - -\\n- - 1 -`).slow(2))\nwash.red(cat(mini('1 - - -'), mini('- - 1 -')))",
      },
      {
        name: 'bar-to-bar variation',
        signature: "mini('… <a b c> …')",
        description:
          'Angle brackets inside a longer string advance one token per cycle, so a single bar can evolve across a phrase without being written out four times. Nest them anywhere a token goes.',
        example:
          "wash.red(mini('1 - <0.3 0.6 1 0.6> -'))   // third beat climbs over 4 bars",
      },
      {
        name: 'a section at a time',
        signature: 'cat(verse, verse, chorus, …)',
        description:
          'cat() takes one cycle from each argument in turn, so naming your bars and listing them is a workable arrangement for a whole song. Repeat a name to repeat the bar.',
        example:
          "const hold = mini('0.3 0.3 0.3 0.3')\nconst hit  = mini('1 - - -')\nwash.red(cat(hold, hold, hit, hit))",
      },
    ],
  },

  {
    category: 'patterns',
    title: 'euclidean and chance',
    blurb:
      'Two families that generate rhythm rather than spell it out. Both are worth reaching for when a pattern should feel less written.',
    entries: [
      {
        name: '.euclid(k, n)',
        signature: "pat.euclid(k, n)  ·  mini('1(k,n)')",
        description:
          'Spread k hits as evenly as possible across n steps. euclid(3, 8) is the standard three-against-eight; most rhythms that feel natural but do not divide evenly are in this family. The mini-notation form is the same thing inside a string.',
        example:
          "strb.strobe(mini('1').euclid(3, 8))\nwash.red(mini('1(5,16)'))",
      },
      {
        name: '.euclidRot(k, n, r)',
        signature: "pat.euclidRot(k, n, r)  ·  mini('1(k,n,r)')",
        description:
          'The same spread, rotated r steps. Give two fixtures the same euclid with different rotations and they interlock instead of firing together.',
        example:
          "washA.red(mini('1').euclidRot(3, 8, 0))\nwashB.red(mini('1').euclidRot(3, 8, 2))",
      },
      {
        name: '? and .degradeBy(n)',
        signature: "mini('1? 1? 1?')  ·  pat.degradeBy(0.3)",
        description:
          'Drop events at random. A ? after a token gives it a 50% chance of being silent; degradeBy(n) drops a fraction n of everything. Useful for taking the machine edge off a dense strobe or pixel pattern.',
        example: "strb.strobe(mini('1*16').degradeBy(0.3))",
      },
      {
        name: '.sometimesBy(n, fn)',
        signature: 'pat.sometimesBy(n, p => …)',
        description:
          'Apply a transform to a fraction n of events rather than dropping them. someCyclesBy does the same at whole-cycle scale, so an occasional bar plays differently.',
        example:
          "wash.red(mini('1 1 1 1').sometimesBy(0.3, p => p.mul(0.2)))",
      },
      {
        name: '.swingBy(n, sub)',
        signature: 'pat.swingBy(amount, subdivision)',
        description:
          'Push every other subdivision late. Straight sixteenths stop sounding like a grid; the same trick reads on lights as a limp rather than a march.',
        example: "strb.strobe(mini('1*8').swingBy(1/3, 2))",
      },
    ],
  },

  {
    category: 'patterns',
    title: 'values',
    blurb: 'Anywhere a channel value is expected you can pass:',
    entries: [
      {
        name: 'float 0-1',
        signature: '0.5',
        description: 'Treated as a fractional level, scaled to 0-255.',
      },
      {
        name: 'int 1-255',
        signature: '128',
        description: 'Raw DMX value, passed straight through.',
      },
      {
        name: 'pattern',
        signature: 'sine().slow(2)',
        description: "Queried every tick. Expected to emit values in [0,1].",
      },
      {
        name: 'nothing',
        signature: 'wash.red()',
        description:
          'An omitted value means full. Naming a channel and no level reads as "on", so the shortest way to get a light on is to say so. Works on every setter, on .color() and .fill() (full white), and on ch() / dim() / uni().',
        example: 'wash.red()\nspot.dim()\nbar.pixels.fill()',
      },
      {
        name: 'anything else',
        signature: "wash.red('1')",
        description:
          "Rejected, with the channel named. A quoted number, a signal that was never called (sine rather than sine()), NaN, null: these used to be stored and read as 0, so the scene ran green with the light off. They now stop the evaluation, and the rig keeps running whatever it had.",
      },
    ],
  },

  {
    category: 'welcome',
    title: 'keybindings',
    entries: [
      {
        name: 'Ctrl+Enter',
        signature: 'Ctrl+Enter',
        description: 'Evaluate the whole editor. Clears previous patterns first.',
      },
      {
        name: 'Ctrl+.',
        signature: 'Ctrl+.',
        description: 'Zero all channels and pause the scheduler.',
      },
    ],
  },
];

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function renderSection(sec: DocSection): string {
  const blurb = sec.blurb ? `<p class="doc-blurb">${escapeHtml(sec.blurb)}</p>` : '';
  const entries = sec.entries
    .map((e) => {
      // An example entry is a clickable row that loads the scene. Same shape
      // as a tab link, and it carries its blurb because that is the only
      // description of what the scene does.
      if (e.loadExample) {
        const bag = [e.name, e.signature, e.description].join(' ').toLowerCase();
        return `
          <button type="button" class="doc-link" data-load-example="${escapeHtml(e.loadExample)}" data-search="${escapeHtml(bag)}">
            <span class="doc-link-label">
              <span class="doc-name">${escapeHtml(e.name)}</span>
              <span class="doc-signature">${escapeHtml(e.description)}</span>
            </span>
            <span class="doc-link-arrow">load</span>
          </button>`;
      }
      // A tab-link entry is a compact clickable row: name, signature-style
      // subtitle, arrow. Full descriptions live in the target tab's own
      // sections.
      if (e.tabLink) {
        const bag = [e.name, e.signature, e.tabLink].join(' ').toLowerCase();
        return `
          <button type="button" class="doc-link" data-tab-link="${escapeHtml(e.tabLink)}" data-search="${escapeHtml(bag)}">
            <span class="doc-link-label">
              <span class="doc-name">${escapeHtml(e.name)}</span>
              <span class="doc-signature">${escapeHtml(e.signature)}</span>
            </span>
            <span class="doc-link-arrow" aria-hidden="true">→</span>
          </button>`;
      }
      const example = e.example
        ? `<pre class="doc-example">${escapeHtml(e.example)}</pre>`
        : '';
      // data-search holds a lowercased bag of all searchable text for this entry
      const searchBag = [e.name, e.signature, e.description, e.example ?? '']
        .join(' ')
        .toLowerCase();
      const desc = e.description
        ? `<div class="doc-desc">${escapeHtml(e.description)}</div>`
        : '';
      return `
        <div class="doc-entry" data-search="${escapeHtml(searchBag)}">
          <div class="doc-sig"><span class="doc-name">${escapeHtml(e.name)}</span> <span class="doc-signature">${escapeHtml(e.signature)}</span></div>
          ${desc}
          ${example}
        </div>`;
    })
    .join('');

  // data-search on the section includes title + blurb so typing a section
  // name ("patterns") keeps the whole group visible even if individual
  // entries don't match that exact word.
  const sectionSearch = [sec.title, sec.blurb ?? ''].join(' ').toLowerCase();
  const category: DocCategory = sec.category ?? 'reference';

  return `
    <section class="doc-section" data-search="${escapeHtml(sectionSearch)}" data-category="${category}">
      <h3 class="doc-section-title">${escapeHtml(sec.title)}</h3>
      ${blurb}
      ${entries}
    </section>`;
}

/**
 * Score an entry against a search query. Higher = better match.
 *
 * Match location dominates: an exact name match beats a prefix match,
 * which beats a substring in the signature, which beats a hit in the
 * prose. Plain substring containment over a bag-of-words would rank a
 * description mentioning "multiply" as high as the `.mul(n)` entry.
 *
 * Returns 0 when nothing hits (caller drops those entries).
 */
function scoreEntry(entry: DocEntry, section: DocSection, q: string): number {
  if (!q) return 1; // no query = everyone "matches" (but we won't use scores then)

  const name = entry.name.toLowerCase();
  const sig = entry.signature.toLowerCase();
  const desc = entry.description.toLowerCase();
  const sectionTitle = section.title.toLowerCase();

  // Pull the "short id" out of the name: strip a leading "." and any
  // trailing parens / args. ".mul(n)" → "mul"; "fixture channels" stays.
  const shortName = name.replace(/^\.+/, '').replace(/\s*\(.*$/, '').trim();

  // Identifier-like matches on the name are the usual target. Shorter
  // names that begin with or equal the query score higher.
  if (shortName === q) return 10_000;
  if (name === q) return 9_500;
  if (shortName.startsWith(q)) return 8_000 - shortName.length;
  if (name.startsWith(q)) return 7_500 - name.length;
  if (shortName.includes(q)) return 6_000 - shortName.indexOf(q) * 10 - shortName.length;
  if (name.includes(q)) return 5_000 - name.indexOf(q) * 10 - name.length;

  // Signature hits: `mul` matches `sine().mul(n)` as a word after a dot
  // or opening paren, meaning the method itself, not a random substring.
  if (sig.startsWith(q)) return 3_000;
  if (
    sig.includes(`.${q}`) || sig.includes(` ${q}`) ||
    sig.includes(`(${q}`) || sig.includes(`,${q}`)
  ) return 2_500 - sig.length / 20;
  if (sig.includes(q)) return 1_500 - sig.length / 20;

  // Section title: "patterns" shows every pattern entry.
  if (sectionTitle === q) return 1_200;
  if (sectionTitle.includes(q)) return 900;

  // Description last-resort. Earlier mentions rank above buried ones.
  const descIdx = desc.indexOf(q);
  if (descIdx >= 0) return 300 - descIdx;

  return 0;
}

/** Render a single entry as a flat search-result card, including the
 *  section it came from as a tiny tag on the right of the header. */
function renderResultEntry(entry: DocEntry, section: DocSection): string {
  if (entry.tabLink) {
    // Same markup as a welcome-page link, with an added section tag.
    return `
      <button type="button" class="doc-link doc-result" data-tab-link="${escapeHtml(entry.tabLink)}">
        <span class="doc-link-label">
          <span class="doc-name">${escapeHtml(entry.name)}</span>
          <span class="doc-signature">${escapeHtml(entry.signature)}</span>
        </span>
        <span class="doc-section-tag">${escapeHtml(section.title)}</span>
      </button>`;
  }
  const example = entry.example
    ? `<pre class="doc-example">${escapeHtml(entry.example)}</pre>`
    : '';
  const desc = entry.description
    ? `<div class="doc-desc">${escapeHtml(entry.description)}</div>`
    : '';
  return `
    <div class="doc-entry doc-result">
      <div class="doc-sig">
        <span class="doc-name">${escapeHtml(entry.name)}</span>
        <span class="doc-signature">${escapeHtml(entry.signature)}</span>
        <span class="doc-section-tag">${escapeHtml(section.title)}</span>
      </div>
      ${desc}
      ${example}
    </div>`;
}

/**
 * Populate the flat results container with entries sorted by score.
 * Returns the number of matches.
 */
function renderSearchResults(resultsEl: HTMLElement, query: string): number {
  const q = query.trim().toLowerCase();
  const scored: Array<{ entry: DocEntry; section: DocSection; score: number }> = [];
  for (const section of DOCS) {
    for (const entry of section.entries) {
      const score = scoreEntry(entry, section, q);
      if (score > 0) scored.push({ entry, section, score });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  resultsEl.innerHTML = scored.map((s) => renderResultEntry(s.entry, s.section)).join('');
  return scored.length;
}

/**
 * Apply the tab filter to the section view (used when no query is active).
 * Shows sections whose category matches the active tab; hides the rest.
 */
function applyTabFilter(sectionsEl: HTMLElement, activeCategory: DocCategory): void {
  const sections = sectionsEl.querySelectorAll<HTMLElement>('.doc-section');
  sections.forEach((section) => {
    const sectionCategory = (section.getAttribute('data-category') ?? 'reference') as DocCategory;
    section.classList.toggle('hidden', sectionCategory !== activeCategory);
    // Reveal every entry; the tab view doesn't filter within sections.
    section
      .querySelectorAll<HTMLElement>('.doc-entry, .doc-link')
      .forEach((e) => e.classList.remove('hidden'));
  });
}

/** Render the docs content into the panel body. */
export function renderDocs(body: HTMLElement): void {
  // Two content views: a browse view (sections grouped by tab) and a
  // search view (flat list sorted by relevance score). Which one shows
  // depends on whether the search field has content.
  const searchBar = `
    <div class="doc-search">
      <input type="text" id="doc-search-input" placeholder="search functions…" autocomplete="off" spellcheck="false" />
      <button type="button" id="doc-search-clear" class="doc-search-clear" title="clear" aria-label="clear search">×</button>
    </div>
    <div class="doc-tabs" id="doc-tabs" role="tablist">
      ${DOC_TABS.map(
        (t) =>
          `<button type="button" class="doc-tab${t.id === DEFAULT_TAB ? ' active' : ''}" data-tab="${t.id}" role="tab">${escapeHtml(t.label)}</button>`,
      ).join('')}
    </div>
    <div class="doc-empty hidden" id="doc-empty">no matches, try a different word</div>
    <div class="doc-results hidden" id="doc-results"></div>
    <div class="doc-sections" id="doc-sections">${DOCS.map(renderSection).join('')}</div>`;

  body.innerHTML = searchBar;

  const input = body.querySelector<HTMLInputElement>('#doc-search-input')!;
  const clearBtn = body.querySelector<HTMLButtonElement>('#doc-search-clear')!;
  const emptyMsg = body.querySelector<HTMLElement>('#doc-empty')!;
  const tabsBar = body.querySelector<HTMLElement>('#doc-tabs')!;
  const resultsEl = body.querySelector<HTMLElement>('#doc-results')!;
  const sectionsEl = body.querySelector<HTMLElement>('#doc-sections')!;

  let activeTab: DocCategory = DEFAULT_TAB;

  const update = (): void => {
    const query = input.value.trim();
    const searching = query.length > 0;

    clearBtn.classList.toggle('visible', searching);
    tabsBar.classList.toggle('hidden', searching);

    if (searching) {
      // Ranked flat-list search across all tabs.
      const hits = renderSearchResults(resultsEl, query);
      resultsEl.classList.remove('hidden');
      sectionsEl.classList.add('hidden');
      emptyMsg.classList.toggle('hidden', hits > 0);
    } else {
      // Browse view: show sections in the current tab.
      applyTabFilter(sectionsEl, activeTab);
      resultsEl.classList.add('hidden');
      sectionsEl.classList.remove('hidden');
      emptyMsg.classList.add('hidden');
    }
  };

  input.addEventListener('input', update);
  clearBtn.addEventListener('click', () => {
    input.value = '';
    update();
    input.focus();
  });

  /** Programmatically switch to a different tab. Used both by the tab bar
   *  and by the in-body `.doc-link` buttons on the welcome page. */
  const switchTab = (next: DocCategory): void => {
    if (next === activeTab) return;
    activeTab = next;
    tabsBar.querySelectorAll<HTMLElement>('.doc-tab').forEach((b) => {
      b.classList.toggle('active', b.dataset.tab === next);
    });
    body.scrollTop = 0;
    update();
  };

  tabsBar.addEventListener('click', (ev) => {
    const btn = (ev.target as HTMLElement).closest<HTMLElement>('.doc-tab');
    if (!btn) return;
    const next = btn.dataset.tab as DocCategory | undefined;
    if (next) switchTab(next);
  });

  // Loading an example replaces the editor buffer, which is not this module's
  // business. Announce the intent and let whoever owns the buffer decide,
  // including whether to warn about unsaved work.
  body.addEventListener('click', (ev) => {
    const btn = (ev.target as HTMLElement).closest<HTMLElement>('[data-load-example]');
    if (!btn) return;
    const id = btn.dataset.loadExample;
    if (!id) return;
    body.dispatchEvent(new CustomEvent('gobo:load-example', { detail: id, bubbles: true }));
  });

  // Welcome-page link rows. Delegate on the body since they're rebuilt
  // whenever tabs/search change visibility.
  body.addEventListener('click', (ev) => {
    const link = (ev.target as HTMLElement).closest<HTMLElement>('.doc-link[data-tab-link]');
    if (!link) return;
    const next = link.dataset.tabLink as DocCategory | undefined;
    if (next) switchTab(next);
  });

  // Focus search automatically when the panel opens
  // (the opener sets .open on the panel; we watch for that via an observer)
  const panel = body.closest<HTMLElement>('.docs-panel');
  if (panel) {
    const obs = new MutationObserver(() => {
      if (panel.classList.contains('open')) {
        // Defer so the slide-in transition doesn't fight the focus
        setTimeout(() => input.focus(), 50);
      }
    });
    obs.observe(panel, { attributes: true, attributeFilter: ['class'] });
  }

  // Initial render
  update();
}
