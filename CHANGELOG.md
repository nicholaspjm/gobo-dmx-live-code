# Changelog

All notable changes to gobo are recorded here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Fades per step.** `.fadeIn(beats)` brings each step of a pattern up,
  `.fadeOut(beats)` lets it keep glowing after the step ends, and
  `.settle(beats, level)` drops each hit to a held level, or to nothing, which
  makes every step a flash. A chase gets its tail: `rig.each((p) => mini('1 - -
  -').early(p).fadeOut(2))`. This is strudel's note envelope ported to light, so
  strudel's own `.attack()`, `.decay()`, `.sustain()`, `.release()` and
  `.adsr('a:d:s:r')` now do the same thing in seconds, where they used to
  attach a setting no light read.
- **`.across(position)` places a step across a group**: 0 is the first light
  in the group, 1 the last, and a position between two is shared between them.
  `rig.dim(mini('1*8').across(saw))` walks one light along the rig;
  `.across(rand)` scatters. It is strudel's stereo `.pan()` with the lights as
  the speakers, and a pasted `.pan()` does the same (on a moving head, `.pan()`
  is still the head's pan channel).
- **Patch a rig from the fixtures tab.** Every fixture has "add to rig": say how
  many, the address set on the first one, the universe and a name, and it
  writes one `const par1 = fixture(…)` line per light, stepped by the fixture's
  channel count, plus a group over them. The address starts at the first
  channel the scene is not already using, names never clash with the scene's
  own or with gobo's, and the lines are shown before they go in. It writes
  code and nothing else: ctrl+enter still runs it.
- **Autocomplete for the kind of light** inside `fixture(1, '…')`: every fixture
  gobo knows, with its size, so `par-rgbw-7ch` is picked rather than spelled.
- **A word in a pattern where a level belongs is reported.** `mini('1 x 1')`, or
  a colour name in a pattern handed to `.dim()`, left that step dark with
  nothing said; the status bar now names the word and the channel.
- **Strudel code runs as written in more places.** Signals work without
  brackets (`sine.slow(4)`, as strudel writes them, as well as `sine()`),
  Alt+Enter and Alt+. run and stop as they do in strudel, `.velocity()` folds
  into the level like `gain`, strudel's underscore spellings of the visuals
  gobo shares with it (`._scope()`, `._punchcard()`, `._spiral()`) draw gobo's,
  and `seq`, `arrange`, `xfade`, `mouseX`/`mouseY` and the bipolar signals are
  bound. Strudel's words for sound (`s`, `note`, `n`, `._pianoroll()`) are
  answered in lighting terms rather than aliased: a light has levels, not
  notes, so the error says what the lighting form is.
- **The desktop app says when a newer gobo is out.** It asks GitHub at most
  twice a day, and when there is a newer release it puts one link in the top
  bar, "0.5.4 is out", that opens the download page. It never downloads or
  installs anything itself, and once the link is followed it is not offered
  again for that version.

### Changed

- In the desktop app and a local `npm start`, the outputs panel no longer
  talks about a connector beside the page: the sender is the gobo that served
  it, and the panel says so.
- The log panel leaves out strudel's own load banner, which gobo repeats in
  its own words a line later.
- Borderless buttons get a focus ring when reached from the keyboard.
- The widgets beside the code (colour swatches, meters, strips, waves and the
  colour picker's swatch) lose their borders, as the buttons did: the tinted
  ground sets them apart.

### Fixed

- **Alt+1…9 picks a cue on a Mac.** It read the character the key types, and
  option+1 types ¡, so the shortcut did nothing on macOS.
- **`setcps()` and `setcpm()` no longer change the tempo of a scene that then
  fails.** They skipped the run's all-or-nothing change.
- The art-net check no longer calls `255.255.255.255`, the all-networks
  broadcast, a network this computer is not on.

## [0.5.3] - 2026-09-26

> **gobo has moved to [gobolive.cc](https://gobolive.cc/).** The old address
> redirects there. This connector accepts pages from both; older ones only
> know the old address, so a downloaded connector updates itself to this one,
> and a Homebrew copy wants `brew upgrade gobo-connector`. Share links from the
> old address still open. A scene only autosaved in the browser does not come
> across, because browsers keep that per address.

### Added

- **The outputs panel says where to send Art-Net.** The connector tells the page
  which networks this computer is on, and the `artnet()` card lists the line that
  reaches every node on each, with a button that writes it into the scene. The
  card, and the status line after a run, now say when a scene sends to this
  computer only, to this computer's own address, or to a network it is not on.
  Each of those used to run clean and light nothing.
- **"add to scene" on every output card**, which writes that output's call into
  the scene, replacing the scene's own output line if it has one. It does not
  run it: ctrl+enter still does.
- **Syntax errors say which line**, and the line a failed run names is tinted
  until it is edited or a run succeeds.
- **"Did you mean…?"** for a misspelt function or method: `sinee`, `wash.colr`,
  `sine().slwo`.
- **The sim labels each light with its name in the scene** (`wash`, `strb`)
  where the address is written as numbers, rather than its kind.
- **A "four pars and a strobe" example**: a small real rig with built-in fixture
  types only.
- **`usb()` and `td()` in autocomplete and hover help.**
- **`--help` for the connector.**

### Changed

- **Zen mode is now minimal view**, and what it hides is a hover away rather
  than gone: the top bar slides back in at the top edge of the window, and the
  sim and level strip rise from the status bar. alt+m and a click on the mark
  still toggle it, and the settings that choose what it hides are unchanged.
- **Buttons are their text or icon, with no border round them.** Colour still
  says hover, on and done.

### Fixed

- `rig.color('red')` on a group now says colours go without quotes, as a single
  fixture already did, instead of asking for r, g and b.
- `fixture('rgb', 1)` and `fixture(1)` say what is wrong with them instead of
  reporting an unknown fixture called "1" or "undefined".
- `setBPM('140')` sets 140 rather than being ignored.
- Declaring a colour's name, as in `const amber = slider('amber')`, no longer
  suggests calling `amber(…)`. The docs example that did exactly that is renamed.
- The "language tour" and "four-colour bar" examples say to swap their alternate
  lines in rather than uncomment them, since uncommenting left them overwritten,
  and three movement lines in the bar demo had half their code commented out.
- Autocomplete no longer offers `ctrl+shift+enter` as code to insert.
- README: the keyboard shortcuts table was split by a paragraph; latency and mock
  logging figures were stale. The TouchDesigner guide gave universe 1 for `ch()`
  and only mentioned `npm run dev`.

## [0.5.2] - 2026-09-26

> **Replace your connector one last time.** From this version it replaces
> itself when a release comes out, so this is the last download by hand. A
> Homebrew copy is still updated with `brew upgrade gobo-connector`.

### Added

- **The connector keeps itself up to date.** When a release comes out, the
  downloaded connector fetches the file for its system, refuses it unless its
  size and SHA-256 match what GitHub published, runs it once to check it starts
  and is the version it claims, and swaps it in. It only does that once nothing
  has been connected for 90 seconds, so it never restarts under a show; the
  outputs tab tells someone waiting on it to close gobo for a couple of
  minutes. `--no-update` turns it off. Homebrew, npm and the desktop app are
  left to update the way they already do.
- **`npx gobo-connector@latest`.** The connector is published to npm by the
  release workflow, with provenance, through npm's trusted publishing, so no npm
  token is kept in the repository. Started that way it waits for the app and
  points at it, like the download, without adding a login item.
- **`--version`** prints the connector's version and stops.

## [0.5.1] - 2026-09-26

### Fixed

- **gobo works on a phone.** The top bar overflowed and clipped, so share, zen
  and the menu, and with it the docs, the settings and the log, were off the end
  of the screen. On a narrow screen the tempo nudges, the cycle bar and the
  connection light's words now give way instead, and tap tempo too on the
  smallest phones. Run, stop and the tempo stay, which is what makes a phone
  usable at all with no ctrl+enter to press.
- **The desktop app's icon** was still the four-pointed spark that the new mark
  replaced in 0.5.0. It is the four-bar ramp now, the same as the tab icon.
- **The link preview** a chat app shows for the site was a screenshot from
  August, with save, open and the old mark in it. It is the current app.

## [0.5.0] - 2026-09-26

> **The public beta.** gobo works end to end, the website needs nothing
> installed, and a network rig needs one download or `npm start`. It will still
> have rough edges; the log tab has a **report a problem** button that fills in
> your versions, and [Discussions](https://github.com/nicholaspjm/gobo-dmx-live-code/discussions)
> is open.
>
> **Replace your connector.** Every connector before this one listened on every
> network interface and took a WebSocket from any web page, so any site open in
> your browser, and anything on the same network, could drive your rig through
> it and repoint its output. This one answers this computer only, and only
> gobo's own pages. When the app finds an older connector it says so, and why.

### Security

- **The connector answers this computer, and gobo's own pages.** It listens on
  `127.0.0.1` and `::1` rather than every interface. A WebSocket is accepted
  from pages served from this computer, from the hosted app, and from any site
  named with `--allow-origin`, and refused from everywhere else with a `403`
  and one line in its log saying why. Every request's `Host` must be an address
  or `localhost`, which is the defence against DNS rebinding, where a page on an
  attacker's name points that name at your machine and then talks to "its own"
  origin. `--lan`, or `GOBO_LAN=1`, opens it to other devices on the network
  when you want that; web pages are still checked.
- **The dev server is on localhost too.** Vite listened on `0.0.0.0`, which put
  it and the source it serves on every network the machine joined.
  `GOBO_LAN=1 npm run dev` opens it and the connector together.
- **The app stopped telling people to `npx gobo-connector`.** The package is not
  on npm, so the instruction handed the name, and everyone who followed it, to
  whoever published it first.
- **Security reports work.** SECURITY.md sent them to private vulnerability
  reporting, which was switched off on the repository. It is on, and the policy
  is rewritten: it described a provenance banner, scene names and scene files
  that no longer exist, and a connector open to everything that no longer is.

### Added

- **Run and stop are buttons.** Both keys still work and are still how anyone
  does this mid-set; the buttons are for the hand already on the mouse. Run is
  never disabled, because re-running is the whole gesture of live coding. Stop
  carries the state instead, lit while there is something to stop, so the pair
  doubles as the answer to "is anything going out right now".

- **Twelve editor settings, from strudel's list.** Line numbers, the
  active-line tint, bracket matching, auto-closing brackets, line wrapping,
  autocomplete, hover help, event highlighting, multiple cursors, block
  evaluation, a flash when a run lands, and a kill switch for every animation
  in the app. Each editor behaviour lives in its own CodeMirror compartment, so
  changing one does not rebuild the editor and take the undo history, the folds
  and the live decorations with it.

  Two from that list are deliberately absent. Tab indentation, because Tab
  already accepts a completion and, with the popup closed, is how a keyboard
  user leaves the editor. Syncing across browser tabs, because two tabs holding
  one scene is two schedulers writing the same DMX channels.

- **"ctrl+enter runs the block"** swaps the two evaluate chords, so the plain
  one takes the block around the cursor and the shifted one takes the whole
  document. Off by default: the document is the safer thing for the main chord
  to mean.

- **The app says when the browser is what blocks the connector.** Chrome now
  asks before a website may reach a program on your computer. Until you allow
  it, the hosted page's socket fails inside the browser before anything reaches
  the connector, which looks exactly like no connector at all, so the app used
  to offer a download to someone who had it running. It asks the browser
  instead, and the banner, the status bar and the outputs tab say which it is
  and what to do; allowing it reconnects straight away.

- **Report a problem.** A button in the log tab opens a bug report with the
  version, the route, the browser, the system and the output already filled
  in, and nothing that belongs to you: not the scene, not the log, not the
  output's address. The repository has issue forms for bugs and ideas, and
  Discussions for everything else.

- **`npm run record:demo`** re-records the README's GIF and screenshot from the
  current build, so the next one does not go stale for a release.

### Changed

- **Run it locally is the route for a network rig.** The README, the in-app
  docs and the outputs tab lead with it now: the desktop app, or `npm start`
  from a checkout, is one program that serves the app and sends the output,
  with nothing to connect and nothing for the browser to allow. The outputs tab
  offers the desktop download, which it had been claiming did not exist since
  the first one shipped, and Homebrew, whose formula has worked since 0.4.0.

- **The macOS app is signed ad hoc.** Without a certificate it was not signed
  at all, and on Apple Silicon a downloaded copy was reported as damaged, with
  Move to Trash as the only offer. Now it is from an unidentified developer,
  which System Settings will open; the README and the release notes say where.

- **Themes work out their own contrast.** The surface, border, line highlight
  and code background of each of the thirteen themes are derived from its
  background and text colours rather than picked by hand, and the gutter is set
  apart by that contrast instead of a border line.

- **The mark is a beam edge.** Four block characters stepping from solid to
  nearly nothing, in the editor's own font, with the same four steps as the tab
  icon. On a narrow window the word goes first and the ramp after it, and
  clicking it is one way into zen mode.

- **The reference and the outputs tab say less.** Both were cut down to what a
  reader needs at the moment they open them.

- **One panel with tabs, instead of five panels with five buttons.** The
  reference, the fixtures, the log, the outputs and the settings are one
  sliding panel behind one button now. Each used to carry its own close button,
  its own Escape handler and its own copy of "shut the other four first, or
  they stack"; mutual exclusion stopped being a rule every panel had to
  remember and became what a tab strip already is. The connection light still
  opens it straight to outputs, and a clickable error still opens it on the log.

- **The fixture library is the "fixtures" tab.** The old name said where the
  definitions were kept. The new one says what they are.

- **The performance view is zen mode**, which is what strudel calls it, so
  someone arriving from there does not have to discover gobo's own word for the
  same thing. Three ways in: `Alt+M`, the button, and clicking the mark at the
  top left. The five settings behind it were renamed with it and are adopted
  from their old spelling on read, so a changed one is not silently reset.

- **Copy and share are one button.** The difference between them is a
  distinction about storage, which is not something to make anyone read a top
  bar to work out. `share` builds the link, puts it on the clipboard and opens
  a dialog saying so; copying the scene as plain text is a second button
  inside, where there is room to say what it is for.

- **A scene has no name.** It had one, editable in the top bar and carried in
  share links, and it named nothing: there is one working buffer, it is the
  document on screen, and no second one exists for a name to tell it apart
  from. Links written by 0.4.x carry a name and still open; it is read past.

### Removed

- **Save and open.** 0.4.0 had both, as buttons and as `Ctrl+S`. A scene is text,
  and the place to keep text is wherever you already keep it: **share** puts a
  link carrying the whole scene on the clipboard, and **copy the code instead**,
  in the same dialog, puts the text there. The unsaved-work dot went with them,
  since with no file to compare against it would be lit on every buffer.

### Fixed

- **"x.y is not a function" now says what to write.** Three different mistakes
  arrive as that one message and the engine's version names the variable and
  the method and stops there, which is the half the scene already knows. A
  factory called as an object (`screen.flash()`) is told it needs its brackets;
  a gobo function used as a method is sent into a setter; `.dim()` and
  `.white()` on a colour strip name the call that does work. Neither is quietly
  aliased onto `.mono()`, because `.dim(0.5)` on a fixture with a dimmer leaves
  the colour alone and a strip has no colour to leave alone — the alias would
  turn a blue wash white and report success.

- **The editor's Ctrl+Enter binding was dead code.** A capture-phase listener
  on the document handles that chord so the key works when focus is outside the
  editor, and it called `stopPropagation` without first checking where focus
  was. Ctrl+Shift+Enter had that check; Ctrl+Enter did not, because until there
  was a setting both paths did the same thing and nothing could tell them
  apart.

- **The outputs tab offered a download of the program serving it.** A page from
  `npm start` or the desktop app no longer offers the connector it is already
  running.

- **The docs had drifted from the code.** Homebrew was described as not working
  when it did, and its own caveats promised a login item that the connector
  deliberately never makes under Homebrew. The send rate was given as 30 / 60 /
  120 Hz, default 60, when it is 25 / 30 / 40 / 44, default 40. Reconnection was
  "every 2 s" when it backs off to thirty. A too-long link was answered with
  "send a saved `.js` file". Each one now says what the app does.

## [0.4.0] - 2026-09-19

> **The first published release.** 0.2.0 and 0.3.0 were tagged or written up but
> never built: the releases page has been empty the whole time, while the README
> has told anyone without a checkout to download the connector from it. This tag
> is the one that actually produces those binaries, for macOS, Linux and Windows.
>
> **Two breaking changes**, both in the section below: `ch()`, `dim()` and `rgb()`
> now write universe 0 rather than universe 1, and an out-of-range channel address
> is refused rather than silently dropped.


> **A blackout that did not black out.** `.off()` walked six hardcoded channel
> names, so a blinder whose bulbs are called warm/cold matched none of them: both
> stayed lit and the call reported success. Which channels emit light is now
> derived from the fixture rather than from a list.
>
> **A channel write that could not work used to look like one that did.**
> `wash.red()` stored nothing, read as 0, and left the status bar green, so the
> light was off and the tool said the scene was running. Naming a channel and no
> level now means full, and a value that is not a number or a pattern stops the
> evaluation with the channel named.

### Added

- **`Ctrl+Shift+Enter` runs only the edits you pointed at.** `Ctrl+Enter` commits
  the whole buffer, which is usually right and occasionally the worst thing the
  tool can do: nudge a level in the look that is lit and the half-written look you
  were drafting for the next song goes live with it, silently, as long as it
  parses. The new gesture takes the document that is currently running and applies
  only the edits inside your selection — or, with nothing selected, inside the run
  of non-blank lines around the cursor, which in a performance file is one look.

  The useful half is that a broken line elsewhere stops blocking you. The document
  is compiled as one unit, so a half-typed line anywhere refuses the whole run and
  you cannot touch the look that is up until the one you are drafting parses.

  Explicitly **not** a seamlessness feature, whatever `d1..d9` suggests: a
  whole-document run is already invisible on the rig, because an evaluation never
  resets the clock and every control keeps its position. And the engine is never
  handed a fragment — what gets compiled is always a complete document, so the
  channel map is still replaced whole, patching still happens once, brightness is
  still inferred across the whole rig, and `hush()` still means blackout. Lines
  edited since the running version carry a quiet rule on their inside edge, because
  once the buffer and the rig can differ you have to be able to see where.

- **Strudel's `pick` family, which mostly worked and nobody could have known.**
  `.pick()`, `.pickmod()`, `.pickSqueeze()` and the rest choose between whole
  patterns using a pattern of indices — the live-coding way to move between looks,
  where the switch is written into the pattern rather than performed on a button.
  The methods were already on the prototype and simply undocumented; the standalone
  forms are now passed through too, under strudel's own names. `pick` itself could
  not come through: gobo took it for the colour wheel first, so the bare function is
  gobo's picker and the method is strudel's chooser.

- **`cue({ verse, chorus })`: change which look is live without typing.** One
  file is one performance and a look inside it is a function you wrote, and the
  only way to call a different one was to edit the call line — not something to
  be doing one-handed mid-show. `cue()` offers a set of looks and runs whichever
  is selected; each gets a numbered chip under the editor, `alt+1..9` picks one,
  and a MIDI **program change** picks one from hardware, that being the message
  desks and pad controllers already send for "recall". Notes are still not
  handled, because a note asks whether it latches and for how long and program
  change asks nothing.

  The mechanism is worth stating: which function runs is decided when the file
  is evaluated, so a fader can ride a level *inside* the live look but can never
  select the look. Picking a cue therefore **runs the file again** with that one
  selected — which is not a seam, because a run stages the whole scene and swaps
  it in at a tick boundary, so the rig holds the previous look until the new one
  is complete. A look that throws changes nothing: the rig stays as it was and
  the selection returns to what is actually lit, so the bar, the rig and the next
  run agree. The selection outlives a run the way a slider's position does.

- **The token that is lighting something is outlined while it fires.** With
  sound you hear which step is playing; with light your eyes are on the rig, so
  a string that looked wrong left you counting tokens to work out which one
  fired. Every mini-notation token that actually reached a channel above zero is
  now outlined in the editor, on every tick, with no call to opt in. A rest and a
  zero stay plain, so a string that lights nothing looks like one. Only plain
  quoted literals written straight into `mini(…)` are read — a string built from
  a variable or carrying an escape is left alone and simply gets no outline,
  because the scene is worth more than the decoration.

- **`midi(cc)`: a fader box driving the rig.** The one input gobo had none of.
  Everything a scene could react to came from the clock or from a control drawn
  in the editor, so riding a level during a show meant dragging a slider on the
  same screen the code is on. `midi(74)` is continuous controller 74 on channel
  1, read live at query time the way `slider()` is, so the fader moves the light
  on the next tick rather than on the next run. Values arrive 0..127 and are
  handed on as 0..1. Kept per channel as well as per number, because two boxes
  commonly send the same CC; and an untouched controller reads as its `start`
  rather than zero, so a scene does not come up black waiting for every fader to
  be wiggled. Turned on under inputs in the outputs panel, which then names each
  controller as you move it — how you find out what your box sends without its
  manual.

- **A log you can read without devtools, and a text size.** `console.log()` from
  a scene, and anything that went wrong while a pattern ran, went only to
  devtools — half the screen you are working in, at a gig, in the dark. The log
  panel keeps the last few hundred lines with timestamps, collapsing an identical
  repeat into a count rather than a thousand rows. It wraps the console rather
  than replacing it, so devtools is exactly as useful as it was. Editor text size
  is adjustable in settings, for a laptop on a road case.

- **The address bar carries the scene that ran.** A permalink is updated in place
  as you run, so the tab can be bookmarked or sent mid-session without stopping
  to press share.

- **`.mono(v)`, `.temp(k)` and `.solo()`, on every kind of light.** `.mono()` is
  brightness that works anywhere: `.dim()` is a channel setter and exists only
  where the definition has a dimmer, so a bare RGB par — whose brightness lives
  in its colour — answered `par.dim is not a function`. `.mono()` drives
  whatever the light uses to make light to one level, and takes a pattern, so
  `par.mono(pulse(4))` breathes. `.temp()` is white in Kelvin, the way lighting
  says it: 3200 tungsten, 5600 daylight. `.solo()` darkens every other light the
  run patched and leaves this one alone; running the scene again restores the
  look.

- **`.color()` on a strip.** The same call as `.fill()`, under the word every
  other light here answers to: a par takes `.color(red)`, a group takes
  `.color(red)`, and a strip took only `.fill()`, so a scene had to remember
  which kind of light it was addressing. Both spellings stay and both are the
  same function. A mono strip gains neither, having no colour to set.
- **The colour types admit what the code always accepted.** `.fill()` and
  `.chase()` took a palette long before their declarations did, and
  `group.color()` did not admit even a single colour though it spread whole
  palettes, so a scene that ran correctly failed to typecheck. One shared
  `ColorRunArgs` now describes every spelling, in one place.
- **An omitted value means full.** `wash.red()`, `spot.dim()`, `ch(5)`,
  `bar.pixels.fill()`: the shortest way to bring something up is to name it.
  Works on every setter, on `.color()` and `.fill()` (full white), and on the
  low-level `ch()` / `uni()` / `dim()` / `rgb()`.
- **`group(...)`.** Fixtures, strips and a fixture's `.pixels` addressed as one,
  answering the same verbs a single fixture does. `group(washA, washB,
  bar.pixels).each(p => sine().early(p).slow(4))` runs one phase ramp across a
  mixed rig in written order, which could not be written at any length before: a
  strip had `each()`, a bar's pixels had `each()`, and pars had neither. A
  fixture counts as one element however many channels it has, and a strip counts
  one per pixel, so pass the fixture to move it as a unit and its `.pixels` to
  move the pixels. Nested groups flatten. A role only some members have is
  applied to those; a role no member has throws, since it would otherwise be a
  silent no-op.
- **A single-value `.each()` means brightness, expressed however the element
  can.** A fixture with a dimmer moves the dimmer and keeps its colour, one
  without drives r/g/b together, and a pixel does the same. A fade across a mixed
  rig therefore does not repaint the look.
- **About thirty operators documented that already worked and were invisible.**
  `struct`, `mask`, `segment`, `every`, `iter`, `chunk`, `rev`, `palindrome`,
  `ply`, `linger`, `late` / `early`, `rangex`, a backwards `range`, `add` / `mul`
  taking patterns, `superimpose`, `off`, `echoWith`, `euclid`, `euclidRot`,
  `degradeBy`, `sometimesBy`, `swingBy`, `@` weight, `!` replicate, and `{}`
  polymeter. Every example in the reference panel was run against the engine
  before being written down.
- **How to write something longer than a bar**, which was the gap behind most of
  the above. A mini string is one cycle however it is typed, so a backtick string
  laid out eight tokens to a line and chained `.slow(8)` gives one bar per line.
  That is byte-identical to `cat()` of the same bars and far easier to read.
- **Strips can be grids.** A pixel wash is usually a rectangle, and addressing
  one meant hand-writing `i % 12` and `Math.floor(i / 12)` in every scene. Pass
  `columns` to `rgbStrip` / `rgbwStrip`, or declare it on a fixture's strip
  channel so the shape travels with the fixture, and the strip gains `width`,
  `height`, `pixelXY`, `row`, `column` and `eachXY`. A plain strip is the same
  model with a single row, so nothing needed a special case. A width that does
  not divide the pixel count is refused at patch time, since the ragged row
  would put every position after it on the wrong pixel.
- **`serpentine`**, for a matrix folded out of one strip so its odd rows run
  backwards. Nothing in the channel count reveals this, so the fixture declares
  it; without it every other row is mirrored and it only shows on the hardware.
- **Named slots on selector channels.** A moving head picks colour, gobo and
  prism by driving one channel into a documented range, so scenes read
  `set('color', 37)` with the manual open beside them. A channel can now declare
  `slots`, and the setter takes a name: `head.color('red')`, `head.gobo('dots')`.
  A range aims at its middle, because hardware often treats a boundary as
  belonging to the neighbouring slot. Patterns of names work too, so a wheel can
  step per bar. `head.slots('color')` lists them.

- **A run says which line it failed on, and stops losing half its message.** An
  error reported what went wrong and never where, which is the whole answer in a
  twenty-line scene and the start of a search in a file holding a show. Runtime
  errors now carry the line; a line that cannot be trusted is not reported at
  all. The status bar is one line and clips, so a failed run also writes the
  full text to the log, carries it on hover, and can be clicked to open the log.
  A successful run's warnings reach the bar too — they previously went to the
  console and nowhere anyone was looking.

- **A name gobo already uses explains itself.** `const strobe = () => {}` failed
  with a bare redeclaration error. It now says that `strobe(…)` is callable in
  any scene, suggests a rename for both things a scene wants that word for (a
  light and a look), and notes that `const` and `let` clash where a `function`
  declaration does not.

- **The editor can find, fold and complete a performance file.** There was no
  find at all — `Ctrl+F` fell through to the browser's, which only searches the
  lines currently rendered. There was no folding either, though the theme had
  styled the fold gutter since it was written. And the completion list knew
  every name gobo ships and every light declared, but nothing about the
  functions the scene itself declares, which in a performance file are the
  looks.

- **A channel set more than once says so.** Last write wins and still does —
  two calls to one channel are two assignments, and a silent max would be
  stranger in JavaScript than a silent overwrite. But calling `verse()` then
  `chorus()` meant every channel they shared came out as whatever the later one
  said, the earlier look silently gone, under a green status bar. A run now
  names those channels, by the light patched over them and its address.

- **`.flash()` and `.glow()` decorate the line they were written on.** They were
  placed by counting — the nth `.glow(` in the text got the nth registration —
  which holds only while every call site in the buffer ran. In a file where looks
  are functions and one of them is called it never does: a `.glow()` inside a look
  that did not run is a call site the scan sees and the run never made, so with
  `chorus` live its decoration was drawn on `verse`'s line. Each call now carries
  the offset it was written at, the same way the live-token outlines do, and both
  tags are applied in one pass so every offset still refers to the original
  document. A call that cannot be tagged falls back to counting, which is what a
  scene evaluated outside the editor wants.

- **A share link pasted into a tab that already has gobo open now opens.** It
  changed only the hash, which is a same-document navigation: nothing reloaded, so
  the handler that reads a shared scene never ran. The scene did not arrive, the
  address bar kept a payload nobody read, and nothing said why — and pasting a link
  into the tab you are already in is an ordinary way to open one.

- **Declining a shared scene no longer destroys the link.** The payload was stripped
  from the address bar *before* the question was asked, so saying no once threw away
  the only copy of someone else's scene the page had, and "keep my work, save it
  first, then open the link" was not something you could do. The link is now left
  where it is unless the scene is actually taken.

- **A channel address that cannot exist is refused instead of dropped.** `ch(5100, 1)`
  — a typo for 510 — reported a running scene and lit nothing: out-of-range writes
  were accepted and then discarded when the frame was built. Every fixture and strip
  constructor already refused an address it could not fit, so the bare calls were the
  anomaly. `ch()`, `dim()`, `uni()` and `rgb()` now check what they were given and
  name the call. `rgb()` checks its whole span, having previously written what fitted
  and swallowed the rest — so `rgb(511, …)` lit red and green and dropped blue, which
  is not the colour that was asked for. The tick-time guard that used to be the only
  protection stays as a backstop.

- **The panic key now always has a way to black out.** With the stop action set
  to `freeze last frame` — a real thing to want, since stopping the code at a gig
  should not black the stage — `Ctrl+.` left **no key at all** that could darken a
  rig: the clock is stopped so nothing rewrites the channels, and `hush()` needs a
  scene to run before it can be reached. Pressing the key again now clears
  everything whatever the setting says, and the status line offers it while there
  is still something lit.

- **Autosave off no longer means your work is never saved.** It skipped the
  debounced write, skipped the write on the way out, and pointed at a `Ctrl+S`
  that is compiled out with scene files — so the one moment work could be lost for
  good was the one moment it cost nothing to write it. The buffer is now written
  when the tab closes whatever the setting, and the setting's own description says
  what it actually does.

- **A USB run says which universes are not reaching the box.** A DMX line carries
  one universe, and it is easy to drive two by accident because `fixture()` patches
  universe 0 while `ch()`, `dim()` and `rgb()` write universe 1 — so a scene using
  both has two without ever naming one, and half of it silently never leaves the
  machine. The run now names what is being dropped and why. The README row about
  this was wrong in both halves and has been corrected.

- **`cue(looks, selector)`: the switch can be written, not only pressed.** `cue()`
  decided the look when the file was evaluated, so the only ways in were a chip, a
  key or a MIDI button — which made it, near enough, the bar of pre-written looks
  with a selector that live coding defines itself against. A second argument now
  takes a pattern of names or indices, or a live control, and is read **every
  frame**: `cue({ verse, chorus }, mini('<verse chorus chorus verse>'))` moves
  between looks as part of the pattern, without the document being evaluated again.

  Every look is captured into a map of its own, and each channel any of them drives
  gets one value that resolves whichever look the selector names. A channel a look
  does not touch reads zero while that look is up, so this is switching rather than
  layering — the same rule as running the file with a different look called. What
  reaches the engine is ordinary channel values, so the commit, the rollback and the
  panic verbs are untouched.

  A scene choosing its own look has no one look that is up, so the bar says **chosen
  by the scene** and the chips become a cast list rather than buttons. A number is
  an index and wraps; a fader between looks is declared with its range, as
  `slider('look', 0, 2, { step: 1 })`.

- **BREAKING: `ch()`, `dim()` and `rgb()` now write universe 0, not universe 1.**
  The fixture family has always defaulted to universe 0 and the channel family to
  universe 1, so a scene that patched a fixture *and* wrote a raw channel drove two
  universes without ever naming one. The visualizer follows the lowest and a USB
  interface carries a single universe, so half of such a scene could silently never
  leave the machine. One default now, for every call.

  **What changes on the wire.** A scene built only from `ch()` / `dim()` / `rgb()`
  moves from universe 1 to universe 0. On **sACN** nothing moves: E1.31 reserves 0,
  so the connector already remaps scene universe 0 onto the sACN base, and that
  remap was written for exactly this split. On **Art-Net** and **OSC** those scenes
  land one universe lower than before — Art-Net universe 0, OSC `/gobo/0/…`. Scenes
  that name a universe, and every scene built from fixtures, are unaffected. Saved
  share links carry their source verbatim, so an old link built from `ch()` will
  target the new universe when it is opened; `uni(1, …)` restores the old address
  explicitly.

### Changed

- **`.color()` reads a channel name the way `.off()` and `.full()` always did.**
  It compared names to the literals `red`, `green`, `blue` and `white`, while
  the emitter calls read a name through the same normaliser that lowercases it,
  drops separators and drops a trailing number. So one definition answered one
  call and refused the other: a fixture wired `Red_1` / `Green_1` / `Blue_1` lit
  under `.full()` and threw under `.color()`, reporting that it had no red,
  green or blue channels while naming those three in the message. The initials
  `r`, `g`, `b` and `w` are accepted too, but only on a channel declared
  `type: 'color'`, because `g` is as likely to be a gobo wheel as it is green.
  `.off()` and `.full()` read that same rule, so whatever `.color()` can paint a
  blackout can darken. Widening one reader and not the other is how this
  asymmetry arrived; doing it again in the other direction would have left an
  `r`/`g`/`b` fixture lit straight through a blackout.
- **A run of colours spreads across a fixture that has pixels to spread it
  over.** `wash.color(warm)` and `wash.color(red, blue)` used to be refused on
  the reasoning that one light is one position, whether that light is a par or
  48 pixels behaving as one. The pixels won the argument: `.fill()` on the strip
  underneath had spread a run across them all along, so the fixture answered one
  word and not the other. A par is still one position and still refuses, naming
  `warm[0]` and `cat(...warm).slow(4)` as before.

- **Layered patterns merge highest-takes-precedence**, the same as a lighting
  desk. `tick()` read the first value on a channel and dropped the rest, so
  `stack()`, a comma inside `mini()`, `superimpose()` and `off()` silently
  discarded every layer after the first: `stack(0.25, 0.75)` put 64 on the wire.
  Adding a layer can now raise a channel but never darken one. The reference
  panel claimed the *last* value won, which was wrong in the other direction.
- **A value that is not a number or a pattern is rejected with the channel
  named.** A quoted number, a signal that was never called (`sine` rather than
  `sine()`), `null`, `NaN`, `±Infinity`: all stored fine and read as 0 on every
  tick. The message says what arrived and what to write instead. The evaluation
  is transactional, so the rig keeps running the scene it already had.
- **A colour is written whole or not at all.** `rgb(1, 0.5)` used to set green
  and blue to 0; it now says it needs all three, or none for full white. Same for
  `.color()` and `.fill()`.
- **What counts as a light-emitting channel** comes from the fixture's own
  declaration: `type: 'intensity'`, or a name matching a colour role, with that
  role list widened well past red/green/blue/white/amber/dim to cover warm, cold,
  uv, lime, cyan, magenta and the rest, numbered variants included. A warm/cold
  blinder now answers `.off()` and `.full()`.
- **A channel carrying slots never counts as emitting**, so `.off()` and
  `.full()` leave a colour wheel exactly where it is, the way they already leave
  pan and tilt. A blackout no longer spins the wheel to whatever sits at 255.
- **`.off()`, `.full()` and `.color()` throw when they would apply to nothing**
  rather than returning quietly. That silence is what let the blinder bug live.

## [0.3.0] - 2026-08-17

> **Licence: MIT → AGPL-3.0-or-later.** The app bundles `@strudel/core`, which is
> AGPL, so MIT was never a valid description of the distributed app. The connector
> (`packages/bridge`) stays MIT.
>
> **Upgrade from 0.2.0 for the blackout alone.** A closed tab used to leave the rig
> lit on its last look. The bridge now sends one zero frame per live universe when
> the last client disconnects.
>
> **Two of the six outputs work in a plain browser.** `usb()` drives an Enttec style
> box over WebSerial (Chrome or Edge, one universe), and `td()` hands frames to
> TouchDesigner, which sends the Art-Net itself. `artnet()`, `sacn()`, `osc()` and
> `mock()` leave as UDP packets, which a page cannot send, so they need the
> connector or the desktop build. OSC is not the install-free option it looks like:
> it is the same kind of packet as Art-Net.

### Added

- **Desktop build** (`packages/desktop`) running the bridge inside the app and
  serving the UI from it, so `artnet()`, `sacn()`, `osc()` and `mock()` work with
  nothing else installed and the page's WebSocket is same origin. `contextIsolation`
  on, `nodeIntegration` off, sandbox on, navigation confined to the app's own
  origin, and a frozen `{ desktop, version }` as the only thing crossing into the
  page. Build and run it from a checkout with `npm run desktop`, or take an
  installer from the release page: `.exe` on Windows, `.dmg` on macOS,
  `.AppImage` on Linux, built on a tag by the release workflow. None of them is
  signed, so Windows SmartScreen and macOS Gatekeeper warn on first run.
- **A run whose output nothing is listening for now says so on that run.**
  `artnet()`, `sacn()`, `osc()` and `mock()` with no connector on the machine
  used to run clean and light nothing, and the only sign was a status line some
  seconds later saying the target was never reached, which reads as a fault in
  the rig. `evalCode` now returns a `warning` beside the successful result,
  naming the cause and the fix, and logs it to the console. The scene still runs:
  the patterns are live and only the wire is silent.
- **Four fixtures in the public library.** `fixtures/` shipped with nothing in it
  in 0.2.0. It now holds `par-rgbw-7ch`, `moving-head-wash-14ch` (16-bit
  pan/tilt), `strobe-4ch` and `pixel-bar-rgbw-8` (eight RGBW pixels across 34
  channels). They are bundled at build time and registered on startup, so
  `fixture(1, 'par-rgbw-7ch')` resolves without opening the library panel.
- **Outputs panel.** The connection light in the top bar is now a button that opens
  a list of all six outputs, each with what it is and whether it can carry light
  right now. A lock badge appears beside it while the scene's chosen output needs a
  program that is not running.
- **One table for output capability**, `packages/ui/src/outputs.ts`. The top bar,
  the panel and the connector prompt all read their answers from it, so no second
  place can disagree about what works where.
- **Two install routes for the connector** that skip the SmartScreen warning the
  downloaded exe raises: `npx gobo-connector` for anyone with Node (14.7 kB of
  JavaScript rather than 87 MB of bundled runtime), and `winget install
  nicholaspjm.gobo` on Windows 11. `npm run winget` writes the three manifests,
  hashing the bytes of the published release. Both routes work once the package is
  published to npm and the manifests are accepted into `microsoft/winget-pkgs`.
- **Art-Net node discovery in `npm run doctor`.** It sends an ArtPoll and reports
  every node that answers, with its name and the universes it listens on, since
  "the addresses are right but nothing arrives" is usually a universe mismatch.

### Changed

- **Licence is now AGPL-3.0-or-later**, replacing MIT, because the app bundles
  `@strudel/core` and a work containing it cannot be distributed under MIT terms.
  Section 13 also covers running a modified version as a network service, which is
  the relevant case for a browser tool. `packages/bridge` stays MIT: it imports no
  Strudel and depends only on `ws`, so other lighting projects can reuse it. Added
  GOVERNANCE.md recording that there is no contributor licence agreement and will
  not be one.
- **Default send rate is 40 Hz**, was 60. DMX512 carries at most about 44 frames a
  second, so 60 asked the wire for more than it can pass. The options are now
  25 / 30 / 40 / 44, and a stored 60 migrates to 40, a stored 120 to 44.
- **The connector banner no longer offers the download to people who have one.**
  Once a bridge has connected in this browser, the banner says the connector is not
  running and that it normally starts itself at login, rather than selling a file
  they already installed.

### Fixed

- **The rig blacks out when the app disconnects.** A closed tab, a crashed browser
  or a shut laptop lid ends the WebSocket without a final frame, and DMX receivers
  hold their last value indefinitely. The bridge now tracks which universes have
  carried data and sends one zero frame each when the last client goes.
- The connector prompt fired before the WebSocket had a chance, so pressing
  `Ctrl+Enter` as the page loaded told a working setup that nothing was listening.
  There is now a 2.5s grace period, cancelled if the bridge turns up during it.
- `onStatusChange` and `onUsbStatusChange` each held one callback rather than a
  list, so registering a second listener silently replaced the first and the top-bar
  connection dot stopped updating. Both are Sets now.
- `td()` pointed at anything other than localhost from an https page threw out of
  `evalCode` rather than returning a failed result. The mixed-content check ran
  at flush time, in the `finally` that runs after the scene has been committed,
  so the caller got no error to show and a half-configured scene was already
  live. The check now runs when the call is staged, which makes it an ordinary
  scene error that rolls back with the rest of the run.
- The README licence badge still read MIT after the relicence.

## [0.2.0] - 2026-08-12

> **Renamed: lumen → gobo.** The project, the workspace packages (`@gobo/core`,
> `@gobo/bridge`, `@gobo/ui`), the repository and the hosted app all changed name.
> The hosted build now lives at https://nicholaspjm.github.io/gobo-dmx-live-code/.
> Three consequences:
>
> - **OSC addresses are now `/gobo/<universe>/<channel>`**, not `/lumen/…`. Any OSC
>   receiver matching the old prefix, a TouchDesigner patch included, goes quiet until
>   it is repointed. See [docs/touchdesigner.md](docs/touchdesigner.md).
> - **The sACN source name is now `gobo`.** Receivers that identify or filter senders
>   by source name need updating. Nothing else about the wire format moved.
> - **Fixtures and settings saved in your browser migrate automatically.** On first
>   load the app adopts anything stored under the old `lumen-fixtures-v1` and
>   `lumen-settings-v1` localStorage keys and rewrites it under `gobo-*`. Fixture
>   files you exported earlier still import: the old `lumenFixture` schema field is
>   accepted as a deprecated alias alongside `goboFixture`. Saved *scenes* are not
>   adopted, because the scene model changed in this release; they are offered as
>   file downloads instead (see below).

First public release. There was never a published 0.1.0. Everything below landed during pre-0.2 development, and the commit-level detail for that period is in git.

### Added

- **Pattern engine.** `sine()`, `cosine()`, `square()`, `saw()`, `rand()` built on [@strudel/core](https://strudel.cc), with the usual chain methods (`.slow` / `.fast` / `.range` / `.add` / `.mul` / `.early` / `.late`). Patterns are sampled once per tick and written straight into DMX buffers. If strudel fails to load, evaluation is refused with a clear message rather than degrading to approximate waveforms.
- **Mini-notation sequencing.** `mini()` / `m()` from `@strudel/mini`, plus `sequence()`, `cat()`, `stack()`. Write a drum grid per channel (`spot.white(mini('1 - - 1'))`) instead of hand-rolling envelopes.
- **`register(name, fn)`.** Define custom chain methods from editor code. They attach to the Pattern prototype and survive `.slow()` / `.fast()` / `.add()` chains.
- **Fixture system.** `fixture(startChannel, id, universe)` returns one setter per named channel. Built-in profiles: `dim`, `rgb`, `rgbw`, `rgba`, `dim-rgb`, `dim-rgbw`, `moving-head-basic`, `moving-head-spot`, `strobe`. `defineFixture(id, def)` declares custom profiles inline.
- **Standard fixture API.** `.color(r, g, b[, w])`, `.off()` and `.full()` on every instance, built-in or custom. `.color()` skips channels the fixture lacks, so one line works across rgb / rgbw / dim-rgbw / moving heads; `.off()` zeroes light-emitting channels only, leaving pan / tilt / gobo aim intact. `.set(name, value)` and `.channels()` complete the generic surface.
- **Pixel strips.** `rgbStrip()` and `rgbwStrip()` primitives, or a `{ type: 'strip', pixelCount, pixelLayout }` channel embedded inside a `defineFixture()` profile. Per-pixel helpers: `.fill()`, `.pixel(i, …)` (monochrome or full colour), `.each((phase, i, count) => …)`, `.pixelGrid([[…], […]])` with `.repeat()` / `.hold()` / `.mirror()` fill modes, and a built-in `.rainbowChase()`.
- **Low-level DMX.** `ch()`, `uni()`, `dim()`, `rgb()` address raw channels. 512 channels per universe, any number of universes.
- **One working scene, autosaved.** The editor holds a single document, written to localStorage on a short debounce (switchable under **autosave** in settings), so a refresh or a crash costs nothing. Click the name in the top bar to rename it; a dot appears while the buffer holds changes that are not in a file. A brand-new browser is seeded from the first bundled example.
- **Scene files.** **save** writes the scene to a `.js` file (`Ctrl+S`); **open** reads one back. The file is the code and nothing else. A scene is JavaScript, so keeping it as JavaScript means it opens with syntax highlighting in any editor and diffs line by line, instead of being escaped into a JSON string. The name comes from the filename, the save time from the file's own timestamp. `.txt` files and the `.gobo` files earlier builds wrote open too: the choice is made on content rather than on the extension, so a renamed file still lands correctly.
- **Share links.** **share** copies a URL whose fragment carries the entire scene: JSON, deflated through the browser's native `CompressionStream`, base64url-encoded. There is no server and no registered id, so a link cannot expire or 404, and the fragment is never sent in an HTTP request. Long scenes make long links; the status bar reports the character count and warns past the point where chat clients and mail gateways start truncating. A link carries the code and the name only, not fixtures or settings.
- **Examples menu.** The three bundled demos (starter demo, `ultratronics 11`, four-colour bar demo) live in source as read-only content and load into the working buffer on request. `ultratronics 11` is a live-performance template built around real onset and section analysis of the track.
- **Guards on anything that replaces the buffer.** Opening a file, loading an example and following a share link all land stopped, waiting for `Ctrl+Enter`, and all prompt first when the buffer holds changes that were never saved to a file.
- **Provenance banner for shared scenes.** Scene code is not sandboxed, so a scene that arrived in a link never auto-runs. A banner states where it came from and what running it grants, until the user runs it or dismisses it. See [SECURITY.md](SECURITY.md#share-links-carry-someone-elses-code-into-your-browser).
- **Fixture library panel.** Four tiers in one list: built-in profiles, public fixtures bundled from `fixtures/*.json` at build time, fixtures saved to the browser, and session-only ones declared by `defineFixture()`. Import and export as JSON; a share button opens a pre-filled GitHub new-file URL, so proposing a fixture for the public library is one click.
- **Fixture validation.** Every fixture coming in from a file or the bundle runs through a strict validator, which rejects id collisions with built-ins, out-of-range sizes, unknown schema keys and unsafe characters. CI runs the same validator on any PR touching `fixtures/`.
- **Inline visualizations.** `.viz('color' | 'wave' | 'meter' | 'strip')` on a fixture or strip drops a live widget at the end of the source line, and `.flash()` / `.glow()` / `.wave()` decorate any pattern in place. Both are opt-in per call and driven from the scheduler tick, so they stay phase-locked with output.
- **Fixture simulator.** A panel rebuilt after every eval from the fixtures the scene declares, rendering RGB/RGBW globes, dimmer globes and pixel strips. Hover tooltips show name, type, universe, channel range and live values. Fixtures with `pan` / `tilt` / `direction` channels get a small XY indicator tracking their position.
- **Docs and hover help.** A tabbed reference panel (welcome / patterns / fixtures / viz / output / reference) with ranked search, plus hover tooltips giving signature, description and example for any gobo identifier. Autocomplete and hover help are generated from the same help source, and the editor highlights gobo commands and fixture-bound identifiers semantically.
- **Settings and themes.** Sliding settings panel with theme, stop action (blackout or freeze), autosave, format-on-run, inline viz, sim tooltips and send rate (30 / 60 / 120 Hz). Thirteen themes: `tungsten`, `moonbox`, `greenroom`, `blacklight`, `bastardAmber`, `blackout`, `glowtape`, `safelight`, `patchbay`, `cyclorama`, `surprisePink`, `worklight`, `followspot`. They swap instantly because the editor and canvas read CSS variables. The names come from stage lighting: a moonbox is the cold fixture hung to fake moonlight, bastard amber and surprise pink are real Rosco gels, glow tape is the photoluminescent strip on a stage edge. A theme chosen before the rename is migrated to its new id, so nobody's setting resets.
- **Semantic syntax highlighting.** The editor colours 24 categories of token rather than two. A fixture being declared reads differently from the same fixture being driven, colour setters carry a hint of their own channel's hue, and editor-only decorations (`.viz` / `.flash`) are italic and quiet because they change nothing on the rig. Output calls (`artnet()` / `sacn()` / `osc()`) are the loudest thing in the buffer, since they decide where light physically goes. Every colour is held at 4.5:1 contrast or better against its theme's background.
- **Output paths.** A Node bridge on `ws://localhost:3001` fans DMX out over Art-Net, sACN (E1.31), OSC, or a mock console logger. `artnet()`, `sacn()`, `osc()` and `mock()` reconfigure it at runtime from editor code. OSC sends `/gobo/<universe>/<channel>` with one float in 0-1, which an OSC In CHOP picks up directly for TouchDesigner work.
- **Editor keybindings.** `Ctrl+Enter` eval, `Ctrl+.` stop, `Ctrl+Space` as a second stop alias that preempts autocomplete, `Ctrl+S` save the scene to a file, `Ctrl+Shift+F` format via a lazily loaded Prettier. Tap tempo on the `T` key or the topbar button; the BPM readout is click-to-edit.
- **512-bar canvas visualizer** at ~30 fps with smoothing, themed from the same variables as the rest of the UI, and a GitHub Pages workflow that publishes the UI on every push to `main`.

### Changed

- Art-Net is the default output and universe `0` is the default universe, matching Art-Net and TouchDesigner convention. `fixture()`, `rgbStrip()` and `rgbwStrip()` all take an explicit universe argument, and the inline viz and sim panel read per-universe buffers.
- Fixture ids dropped the `generic-` prefix (`generic-rgbw` → `rgbw`). The old ids still resolve through an alias map, so existing scenes keep working. `moving-head-spot`'s `color` channel was renamed to `colorWheel`, freeing `.color()` for the generic helper.
- The scheduler runs off a Web Worker clock rather than a main-thread timer, and advances cycle position from elapsed wall-clock time. Output keeps flowing while the tab is backgrounded, and the send throttle is a time-based interval driven by the send-rate setting rather than a fixed tick count.
- `pixelGrid()` takes an array of rows (one inner array per pixel) instead of a flat channel array. Missing channels default to 0.
- **The multi-scene dropdown is gone, replaced by one working buffer plus files.** There is no scene list, no save-as, no rename-in-a-menu, no delete, no protected `default` and no reset-to-seed. The demo scenes are no longer seeded into storage as saved scenes; they are read from source through the **examples** menu. Scenes you saved under the old model are offered as `.js` downloads through a one-time notice, one button each plus a "download all" that spaces the files out so the browser does not block them. **The old storage is left completely intact.** `gobo-scenes-v1` (or its `lumen-scenes-v1` predecessor) is read to build that list and nothing more; `gobo-active-scene-v1` and `gobo-scene-meta-v1` are not touched at all. None of them is written, deleted or cleaned up, including after the notice is dismissed. The new buffer keeps its own keys (`gobo-buffer-*`). `Ctrl+Shift+S`, previously save-as, is no longer bound; with no other scenes to save as, it falls through to the browser.
- Loading a scene never auto-runs it. Opening a file, loading an example and following a share link all stop output and wait for `Ctrl+Enter`.
- An audio-reactivity module (mic and file input, band splitting, beat detection) exists in `packages/core/src/audio.ts` but is not wired into the eval sandbox or the UI in this release. The scheduler retains the external clock hook it used.

### Fixed

- **sACN output was non-conformant and dead by default.** `fixture()`, `rgbStrip()` and `rgbwStrip()` default to universe 0, which E1.31 reserves, so conformant receivers dropped every packet. Scene universe 0 is now remapped to a legal wire universe (the base set by `sacn(base)`, default 1); every other scene universe goes out unchanged, so `ch()`/`dim()`/`rgb()` and any explicit `uni()` still land where they always did. The base is validated against the legal 1-63999 range, and a base that collides with a directly-used scene universe warns rather than silently interleaving two scenes onto one wire universe.
- `sacn(universe, priority)`'s first argument was stored, printed in the log, then ignored by the sender, so the bridge confirmed a universe it was not using. It now sets the base universe described above, and the log states the actual mapping.
- sACN sequence numbers were counted process-wide instead of per universe, contrary to E1.31 §6.2.5. With more than one universe live, receivers discarded frames as out-of-order. Each universe now carries its own counter.
- A failed evaluation blacked out the rig. `evalCode` cleared all state before it knew the code even parsed, so a stray paren drove every channel to zero, and the going-dark logic pushed that blackout to real hardware. Evaluation is now transactional: the code is compiled first, channel writes are staged, and a failure leaves the previous scene running untouched. Output-switching calls (`artnet()` / `sacn()` / `osc()` / `mock()`) and `setBPM()` are held with it, so a scene that switches output and then throws no longer strands the bridge somewhere the running scene never asked for.
- A single throwing pattern froze the whole rig. `register()` bodies run lazily at query time, and one throw aborted the frame after the buffers had been zeroed: no frame sent, rig latched on its last look, status bar still showing a green check. Each channel is now resolved independently. A failing channel goes dark, every other channel keeps running, and the status bar reports which channel is failing and keeps reporting it.
- `setBPM(NaN)`, reachable from a typo like `setBPM(base * undefinedVar)`, permanently poisoned the clock, and correcting the BPM afterwards did not recover it. Non-finite values are now rejected, and the tick self-heals if the cycle position is ever left non-finite by any route.
- The bridge had no error handlers at all: a typo'd host in `osc()`, a port already in use, or a client vanishing mid-frame killed the process. Every socket and server now handles errors, send failures are explained in plain language and rate-limited, and a dropped frame no longer takes down the process.
- An unrecognised output mode (a typo like `artnett` in the config file or a runtime call) silently routed everything to console logging while printing a confirmation. Invalid modes are now rejected loudly, naming the bad value and the valid set, and a bad runtime message keeps the current working output rather than taking it away mid-show.
- `fixture()` accepted a patch that ran past channel 512 or started below 1, silently dropping the overflow. It now rejects the patch and says which fixture overran and by how much, matching the guard the strip helpers already had.
- Art-Net packets were silently dropped by nodes, because the OpCode was written in the wrong byte order (`0x5000` is low-byte-first). Corrected, so hardware accepts ArtDmx frames.
- A universe going dark left the rig stuck on its last value: the send path skipped any all-zero buffer, so commenting out the last pattern cleared the sim but never told the receiver. A universe that was live and is now all-zero gets one trailing zero-frame, which latches Art-Net, sACN and OSC receivers off and makes stop-with-blackout clear hardware. Idle universes are still skipped.
- OSC output now sends zero-value updates when channels turn off, instead of leaving receivers on the last non-zero value.
- BPM drifted under load and varied with display refresh rate, because the old `setInterval` scheduler advanced cycle position by a fixed amount per tick. Cycle position is now derived from elapsed time, so 60, 120 and 144 Hz displays all keep accurate tempo.
- `mini()` and `m()` threw "mini is not a function"; they live in `@strudel/mini`, not `@strudel/core`. The package is now a core dependency, imported on demand, with a whitespace-splitting shim as a fail-soft fallback.
- Pattern decorations forced a layout reflow on every tick to restart their keyframes, which jittered output enough to visibly flicker physical Art-Net fixtures. The tick handler no longer touches layout.
- The bridge WebSocket tried `ws://<pagehost>:3001` when the UI was served from a public host, which never resolved. It now uses the page host only for localhost and private LAN ranges and falls back to loopback otherwise, so the hosted demo can drive a locally running bridge.
- The sim panel was hard-coded to one scene's channel layout and showed ghost fixtures after a scene switch. It is now rebuilt from the fixtures registered during the last eval. Its "off" state also reads the theme background instead of a hardcoded colour, so blackout looks dark on every theme.
- The `ultratronics 11` template called `spot.dim()` on an RGBW fixture that has no dimmer channel, throwing on every run. The instrument palette was remapped onto discrete colour channels. The fixed version is the one in the **examples** menu; a copy you saved under the old scene model still holds the broken call, so re-load the example if you kept one.

[0.5.3]: https://github.com/nicholaspjm/gobo-dmx-live-code/releases/tag/v0.5.3
[0.5.2]: https://github.com/nicholaspjm/gobo-dmx-live-code/releases/tag/v0.5.2
[0.5.1]: https://github.com/nicholaspjm/gobo-dmx-live-code/releases/tag/v0.5.1
[0.5.0]: https://github.com/nicholaspjm/gobo-dmx-live-code/releases/tag/v0.5.0
[0.4.0]: https://github.com/nicholaspjm/gobo-dmx-live-code/releases/tag/v0.4.0
[0.3.0]: https://github.com/nicholaspjm/gobo-dmx-live-code/releases/tag/v0.3.0
[0.2.0]: https://github.com/nicholaspjm/gobo-dmx-live-code/releases/tag/v0.2.0
