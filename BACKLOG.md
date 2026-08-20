# Backlog

Raised in one batch. Ordered by what a person hits first, not by effort.
Notes marked **checked** were verified against the running engine.

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

### Gradients and colour palettes
Define a palette once, use it everywhere a colour is taken. Should compose with
`pick()` and the predefined colours, and be the natural input to `.chase()` and
`.fill()`. Probably the largest item here and the one that unlocks the most.

### `fill()` should take a colour
Predefined, a mix, a defined palette colour, or a pattern. Partly done:
`.fill(color)` and `.color(color)` accept a colour value now. What is missing is
palette input and clearer precedence.

### A mini-notation for colour
`mini('r - g - b')` to flash red, green, blue in order, the way `'1 - 1 -'`
works for levels. Needs a decision about whether tokens resolve against the
predefined names, a scene palette, or both.

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
attaches named setters only sees scalar channels. That is the real gap, and it
matches the audit finding that the r,g,b mix is `.color()` on a fixture and
`.fill()` on a strip.

### Autocomplete should rank lighting commands above pattern chains
After a dot, the pool is pattern methods and fixture methods merged. A receiver
that is a declared light should weight its own verbs first;
`packages/ui/src/declared-lights.ts` already knows which names are lights.

### A colour should imply its own brightness
Decided against defaulting `dim` to 1: a rig that comes up hot the moment a
fixture is patched is a worse failure than a dark one, because it happens on a
half-written scene.

Infer instead. On a fixture that has a master dimmer, driving an emitter and
never touching the dimmer is always a mistake, so raise the dimmer to full at
commit time. Rules:

- Only when the scene drove at least one emitter on that fixture.
- Only when the scene never set the dimmer itself, so `dim(0)` and `dim(0.5)`
  are left exactly as written, including a deliberate blackout.
- Applied once per run at commit, not per call, so the order of lines does not
  matter.

This is the failure that cost real time on the 154-channel wash: a perfect
yellow picture on the pixels with channel 1 at zero and nothing visible. The
fixture's own description says "nothing is visible at all unless this is up",
which is the definition of a value nobody should have to remember.

Needs care: it changes what a scene outputs without the scene saying so, and
that is the kind of help that is infuriating when it guesses wrong. The
"scene never set the dimmer" condition is what keeps it honest, and it should
be visible somewhere, probably the status line or the hover tooltip, rather
than silent.

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

## Already open elsewhere

- `trail` on `.chase()`: attempted, reverted, notes recorded.
- Coverage script for the Pattern prototype: 947 methods, ~60 worth documenting.
- One value domain, 0..1, with `dmx(n)` for raw: blocked on a decision about
  slot channels.
- Chainable setters: `.fill()` returns void while `.viz()` returns the instance.
- Retake the README screenshot and `og.png`.
