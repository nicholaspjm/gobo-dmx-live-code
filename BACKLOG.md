# Backlog

Notes marked **checked** were verified against the running engine.

Anything touching patterns has to be verified in a browser. `@strudel/core`
cannot load under the test runner: its entry imports `SalatRepl` from
`@kabelsalat/web`, which is a browser-only bundle, so the import fails before
any gobo code runs. Hand-rolled `{ queryArc }` fakes are faithful stand-ins in
unit tests, because that is exactly the shape `pick()` produces.

## Open

### The performance view is not remembered
Alt+M is off again after a reload. Persisting it needs a `minimalView` key on
the `Settings` interface and in `DEFAULTS`, which is a closed type.

### A colour name inside a string is painted as a colour
The editor now paints bare colour names, and the scanner has always been blind
to strings, so the `'red'` in `head.color('red')` is painted as the colour value
when it is a wheel slot name. `stripNonCode()` in `packages/ui/src/source-scan.ts`
already blanks strings and comments properly for the widget scan. Pointing the
highlighter at the same helper would fix this and the same class of mistake in
comments.

### Two copies of the fixture tier labels
`TIER_LABEL` is declared in both `packages/ui/src/library.ts` and
`packages/ui/src/docs.ts`, with the same four keys and the same four words. They
agree today. This is the shape of problem `colors.ts` already has an opinion
about, several lists that did not agree, and the fix is to export one and import
it. Left alone because the two panels are otherwise independent and coupling
them needs a shared module that does not exist yet.

### Sliders stop following the stored value after a re-run
`_sliderWidgets` in `inline-viz.ts` is filled during `refreshViz`, so after a
re-run where the decoration compares equal it holds instances that were never
rendered, and every `sync()` on them does nothing. The picker had exactly this
defect and was fixed by tracking from `toDOM`/`destroy` instead. Same shape of
fix, deliberately not applied at the same time because changing how a control
behaves mid-show was not what was asked for.

### `pick('warm')` repeats itself: decided, no fix
`const warm = pick('warm')` says the name twice, and it stays that way. The
string keys the stored colour so a colour chosen during a show survives an edit.
The alternatives are worse: keying by position in the source breaks when lines
move, and the variable name is not visible to the sandbox. Every spelling that
avoids the repetition either loses the colour on an edit or cannot be written.
Closed as a decision rather than left open as work.

### Blackout: connector rebuilt, needs swapping over
**Checked, and this was never a code bug.** The fix shipped in `94b0175` on
19 August. The connector holding port 3001 is
`C:\Users\Admin\Downloads\gobo-connector-windows.exe`, built 14 August, five
days earlier. The 19 August re-download is byte-identical to it, so the
published release asset was never rebuilt either, and a startup script
relaunches that same old binary at every login.

`release/gobo-connector-windows.exe` has been rebuilt and contains the fix,
confirmed by byte search. Point the startup script at it and restart the
process. If the lag survives that, then it is the fixture's own fade-time menu.

## Already open elsewhere

- `trail` on `.chase()`: attempted, reverted, notes recorded.
- Coverage script for the Pattern prototype: 947 methods, ~60 worth documenting.
- One value domain, 0..1, with `dmx(n)` for raw: blocked on a decision about
  slot channels.
- Chainable setters: `.fill()` returns void while `.viz()` returns the instance.
- Retake the README screenshot and `og.png`.
- No eyedropper on the drawn colour wheel. The platform picker had one, and
  reproducing it needs the EyeDropper API, which is Chromium only.

## Done

### Gradients and colour palettes
A palette is a plain array of colours. `const warm = [amber, orange, red]`
spreads across a strip with `.fill(warm)`, across a group with
`rig.color(warm)`, and along a chase with `.chase(warm)`.

### `fill()` takes a colour
Predefined, a mix, several stops, a palette, or a pattern of colour tokens.
`readColorStops()` is the one ladder every caller reads through.

### A mini-notation for colour
`mini('r - g - b')` flashes red, green, blue. Tokens resolve by full name or by
any prefix naming one colour. A number token is a grey. A rest is silence
rather than black.

### A colour implies its own brightness
On a fixture with a master dimmer, driving an emitter and never setting the
dimmer raises it at the end of the run, and says so. `dim(0)` and `dim(0.5)`
stand exactly as written, wherever they appear.

### A chase on a picked colour ran white
`.mul()` does not scale a duck-typed component: strudel reifies it with
`pure()`, so the multiply became a union and the channel read the envelope
alone. Silent, and the docs used that call as the example.

### Library search, independent of the docs search
Its own ranking over names, manufacturers, channel counts and channel names,
sharing nothing with the docs search. A name match beats a description match.

### Minimal / performance view
Alt+M hides the top bar, sim panel and level strip. Document-level handler, not
a CodeMirror keymap, so it fires without editor focus.

### Resync, and BPM x2 / ÷2
`resetPhase()` in the scheduler puts the count back to the top of a cycle
between ticks, so nothing is dropped. Halve and double go through the existing
clamp.

### Whole-fixture setters reach strip pixels
`wash.red(1)` now drives every pixel of every strip channel the fixture has, and
its own scalar channel of that name when it has one.

### Autocomplete ranks lighting commands first
A declared light's own verbs sort above pattern methods. Nothing is filtered
out, so `.slow()` is still reachable on a light.

### Bare colour names highlight
The eleven colour names and `pick` are painted in the editor, with six new hues
themed across every theme.

### `.viz()` widgets kept running when commented out
The cause was the scan, not the registry: it cut each line at the first `//`, so
a block comment went straight through, and a `//` inside a string hid real calls
after it. `source-scan.ts` now blanks comments and string contents properly and
counts one hit per call rather than per line.

### The colour picker is a wheel
A drawn HSV disc with a value bar, keyboard reachable, themed, closing on
Escape or a click away. It emits the same `#rrggbb` the native input did.

### `.chase()` and `rainbowChase()` no longer clear a dedicated white
Every colour path now writes r, g and b and leaves W where the scene put it.
`.full()` is still the call that lights every emitter.

### `rgbwStrip.fill(r, g, b)` with three numbers
Three values are a mix leaving W alone. Four still write W.

### Reading a colour token cost three times what it should
`colorPattern()` reads the source once per arc and shares it across the three
components. On a 48-pixel strip that is 144 queries a tick down to one.
