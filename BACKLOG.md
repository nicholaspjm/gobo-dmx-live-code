# Backlog

Raised in one batch. Ordered by what a person hits first, not by effort.
Notes marked **checked** were verified against the running engine.

Anything touching patterns has to be verified in a browser. `@strudel/core`
cannot load under the test runner: its entry imports `SalatRepl` from
`@kabelsalat/web`, which is a browser-only bundle, so the import fails before
any gobo code runs. Hand-rolled `{ queryArc }` fakes are faithful stand-ins in
unit tests, because that is exactly the shape `pick()` produces.

## Done

### Gradients and colour palettes
A palette is a plain array of colours. `const warm = [amber, orange, red]`
spreads across a strip with `.fill(warm)`, across a group with
`rig.color(warm)`, and along a chase with `.chase(warm)`. No new type: an array
already indexes, reverses and slices, and `cat(...warm)` puts it in time.

### `fill()` takes a colour
Predefined, a mix, several stops, a palette, or a pattern of colour tokens.
`readColorStops()` is now the one ladder every caller reads through, so the
rules cannot drift apart between `.fill()` and `.color()`.

### A mini-notation for colour
`mini('r - g - b')` flashes red, green, blue. Tokens resolve against the eleven
predefined names by full name or by any prefix naming one colour. A number
token is a grey, so `mini('1 - 1 -')` means the same shape in a colour position
as in a level position. A rest is silence rather than black.

### A colour implies its own brightness
On a fixture with a master dimmer, driving an emitter and never setting the
dimmer raises it at the end of the run, and says so. `dim(0)` and `dim(0.5)`
stand exactly as written, wherever they appear in the scene. Read off the
staged definitions rather than by watching the setters, so a strip's pixels
count, and `.off()` stays off.

### A chase on a picked colour ran white
Not on the original list, found while building the above. `.mul()` does not
scale a duck-typed component: strudel reifies it with `pure()`, so the multiply
became a union and the channel read the envelope alone. Every
`.chase(pick(...))` ran at full brightness in white, with no error and nothing
to notice, and the docs used that call as the example.

## Wrong behaviour

### Blackout lags by about a bar
Stopping darkens the rig eventually rather than immediately. The browser side
is verified: buffers zero, sim and screens go dark, and a zero frame leaves the
page in the same tick. The connector repeats that frame three times over about
a sixth of a second.

So the delay is downstream of both. Three candidates, cheapest first:
1. **A fade time set on the fixture itself.** Many washes have a dimmer curve
   or fade-time menu option, and a one-bar fade on blackout is exactly what
   that looks like. Check the fixture's own menu before touching code.
2. **An old connector binary.** The repeated-blackout fix ships in
   `packages/bridge/dist`. A `gobo-connector-*.exe` downloaded earlier does not
   have it. Confirm which process holds port 3001.
3. **The node's own hold/failover.** Some Art-Net nodes ramp rather than cut.

### `.viz()` widgets keep running when commented out
An inline visualisation should stop when its line is commented. The line scan
in `packages/ui/src/inline-viz.ts` already strips `//` comments, so this is
likely the registry keeping the entry from the last run rather than the scan.

## Missing, and asked for directly

### Library search, independent of the docs search
The docs panel has search; the library panel does not. Should not share state
or ranking with the docs one.

### Minimal / performance view
Hide the output nodes, the sim panel and the top bar. Code and a few essentials
only. Worth a keybinding.

### Resync, and BPM x2 / ÷2
A button to bring the count back to 1 when it has drifted, and quick halve and
double next to the BPM. `setBPM` already clamps 1..400.

## Consistency

### Whole-fixture setters on strips and on fixtures that contain strips
**Checked:** strips already answer to `.red()`, `.green()`, `.blue()` and
`.white()`, so `strip.red(1)` works today. What does not work is a fixture whose
def has a strip channel: `wash.red(1)` reaches no pixels, because the loop that
attaches named setters only sees scalar channels. That is the real gap.

Now smaller than it was: `.fill()` on the nested strip takes a colour, so
`wash.pixels.fill(red)` is the working spelling. What is missing is the
whole-fixture shortcut reaching through to the pixels.

### Autocomplete should rank lighting commands above pattern chains
After a dot, the pool is pattern methods and fixture methods merged. A receiver
that is a declared light should weight its own verbs first;
`packages/ui/src/declared-lights.ts` already knows which names are lights.

### `pick('warm')` repeats itself
`const warm = pick('warm')` says the name twice. The string keys the stored
colour so it survives an edit, which is why it exists. Alternatives: key by
position in the source, which breaks when lines move, or infer the variable
name, which the sandbox cannot see. Neither is obviously better than the
repetition, so this needs a decision rather than a fix.

### The colour picker should be a wheel
It currently opens the operating system's picker, which is a wheel on most
platforms but not all, and cannot be styled. A drawn circular picker would be
consistent everywhere at the cost of owning it.

### `.chase()` zeroes W, `.fill()` leaves it alone
On an RGBW strip a colour path writes r, g and b and leaves the dedicated white
channel where the scene last put it. `.chase()` zeroes it instead. One of the
two is wrong and they should agree.

### Bare colour names do not highlight, and now `mix` does
`mix` was added to `BARE_TOKENS` in `packages/ui/src/code-highlight.ts`, so it
is the only bare colour-family name the editor paints. `pick` and the eleven
colour names have never been in that table, so `red` and `blue` still render as
plain identifiers even though they are reserved words in the sandbox.

Painting them is the consistent answer, and it is a design call rather than a
line of code: `METHOD_TOKENS` has hue marks for red, green, blue, white and
amber only, so orange, yellow, cyan, purple, magenta and pink would each need a
mark and a theme colour. Adding the five that already have marks would be worse
than either end state.

### Reading a colour token costs three times what it should
Each of `colorPattern`'s three component wrappers queries the source separately
and resolves the whole colour before keeping one component, so a token is
resolved three times per pixel per tick and two thirds is discarded. It is
correct, and it is measurable only on a long strip driven by a token pattern.
The `reported` set that keeps an unknown token from logging every frame is also
unbounded and keyed by the raw token, so a source generating fresh strings
defeats it. Both are contrived to hit, both are worth one pass if that path
ever gets used in anger.

### `rgbwStrip.fill(r, g, b)` with three numbers throws
It asks for all four of r, g, b, w, where `rgbStrip` takes three. A real
inconsistency, deliberately left alone while the colour work was in flight.

## Already open elsewhere

- `trail` on `.chase()`: attempted, reverted, notes recorded.
- Coverage script for the Pattern prototype: 947 methods, ~60 worth documenting.
- One value domain, 0..1, with `dmx(n)` for raw: blocked on a decision about
  slot channels.
- Chainable setters: `.fill()` returns void while `.viz()` returns the instance.
- Retake the README screenshot and `og.png`.
- `clearPickers()` is missing from `evalCode()`'s failure branch, so a
  rolled-back run leaves its picker declarations stale. One line, its own commit.
