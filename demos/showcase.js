// gobo showcase · 16 pixel bars, 4 Atomics, 5 pars and the screen, to a 124 BPM track
//
// before the doors
//   1. load a 124 BPM track (or change setBPM below to match yours)
//   2. tap T on the beat a few times, then press sync on the one of a bar
//   3. alt+m for minimal view; settings, style, black background, so the
//      projected code does not light the room
//
// the set: one look per section, picked on the beat with alt+1 to alt+7
//   alt+1 doors      4 bars    the room screen breathes, pars at candle level
//   alt+2 intro     16 bars    warm pars wave, bars and Atomics in slow blue
//   alt+3 build      8 bars    everything doubles in speed bar by bar
//   alt+4 drop      16 bars    chase with tails, grid sweeps, colour on the wheel
//   alt+5 breakdown  8 bars    one light walks the bars, the pars fan out
//   alt+6 lift      16 bars    palette steps, halves answer each other, euclid flashes
//   alt+7 outro      8 bars    tungsten and amber, then ctrl+. to black out
//
// the layers below the looks start muted: take the underscore off to bring one
// in, put it back to drop it out, ctrl+enter each time. Use one strip layer at
// a time. The Atomic strips light in every look except doors and outro. The
// lines marked "move:" are edits to make live.

setBPM(124)

// ── patch · addresses from the DMX patch sheet ──────────────────────────────
// the sheet's universes 1, 2 and 3 are Art-Net universes 0, 1 and 2 here;
// if your node counts from 1, add one to each
const U1 = 0
const U2 = 1
const U3 = 2

const bar1 = fixture(173, 'pixel-bar-rgbw-8', U1)
const bar2 = fixture(207, 'pixel-bar-rgbw-8', U1)
const bar3 = fixture(241, 'pixel-bar-rgbw-8', U1)
const bar4 = fixture(275, 'pixel-bar-rgbw-8', U1)
const bar5 = fixture(309, 'pixel-bar-rgbw-8', U1)
const bar6 = fixture(343, 'pixel-bar-rgbw-8', U1)
const bar7 = fixture(377, 'pixel-bar-rgbw-8', U1)
const bar8 = fixture(411, 'pixel-bar-rgbw-8', U1)
const bar9 = fixture(445, 'pixel-bar-rgbw-8', U1)
const bar10 = fixture(479, 'pixel-bar-rgbw-8', U1)
const bar11 = fixture(1, 'pixel-bar-rgbw-8', U2)
const bar12 = fixture(35, 'pixel-bar-rgbw-8', U2)
const bar13 = fixture(69, 'pixel-bar-rgbw-8', U2)
const bar14 = fixture(103, 'pixel-bar-rgbw-8', U2)
const bar15 = fixture(137, 'pixel-bar-rgbw-8', U2)
const bar16 = fixture(171, 'pixel-bar-rgbw-8', U2)

const par1 = fixture(295, 'par-rgbw-7ch', U2).viz('color')
const par2 = fixture(302, 'par-rgbw-7ch', U2)
const par3 = fixture(309, 'par-rgbw-7ch', U2)
const par4 = fixture(316, 'par-rgbw-7ch', U2)
const par5 = fixture(323, 'par-rgbw-7ch', U2)

const atom1 = fixture(350, 'atomic-strobe-154ch', U2)
const atom2 = fixture(1, 'atomic-strobe-154ch', U3)
const atom3 = fixture(155, 'atomic-strobe-154ch', U3)
const atom4 = fixture(309, 'atomic-strobe-154ch', U3)

// the screen is a light too: a 12 x 4 wall that matches an Atomic, and one
// wash for a projector pointed at the back wall. Neither has a DMX address.
const wall = screen(48, { columns: 12, label: 'wall' })
const room = screen(1, { label: 'room' })

// ── groups ──────────────────────────────────────────────────────────────────
const bars = group(bar1, bar2, bar3, bar4, bar5, bar6, bar7, bar8,
  bar9, bar10, bar11, bar12, bar13, bar14, bar15, bar16)
const barPix = group(bar1.pixels, bar2.pixels, bar3.pixels, bar4.pixels,
  bar5.pixels, bar6.pixels, bar7.pixels, bar8.pixels, bar9.pixels,
  bar10.pixels, bar11.pixels, bar12.pixels, bar13.pixels, bar14.pixels,
  bar15.pixels, bar16.pixels)
const pars = group(par1, par2, par3, par4, par5)
const atomics = group(atom1, atom2, atom3, atom4)
const grids = group(atom1.pixels, atom2.pixels, atom3.pixels, atom4.pixels, wall)
const strips = group(atom1.strip, atom2.strip, atom3.strip, atom4.strip)

// ── always on ───────────────────────────────────────────────────────────────
const hot = pick('hot', { start: magenta })   // the drop colour: click the swatch to change it live
const warm = [amber, orange, red, magenta]

all(mul(slider(1)))                           // grand master: every light in the room
// const fader = midi(74)                     // move: a hardware fader instead,
// all(mul(fader))                            //   after turning on midi in (outputs panel)

// ── looks ───────────────────────────────────────────────────────────────────
doors: {
  room.fill(sine.slow(8).range(0.05, 0.3), 0, sine.slow(8).range(0.15, 0.45))
  pars.temp(2000)
  pars.dim(0.08)
}

intro: {
  atomics.dim(1)                                         // full: the pixels and strips carry the level
  pars.temp(3200)
  pars.each(sine.slow(8).range(0.1, 0.5), 8)            // a slow wave through the pars
  barPix.color(blue)
  bars.dim(1)
  barPix.each(sine.slow(4).range(0, 0.35), 4)           // move: 4 to 1, the wave tightens
  grids.color(blue)
  grids.each(sine.slow(8).range(0, 0.2).glow(), 2)
}

build: {
  atomics.dim(1)
  pars.color(cyan)
  pars.dim('1*4'.fast('<1 1 2 2 4 4 8 8>').settle(0.25))   // flashes doubling every two bars
  barPix.color(white)
  bars.dim(1)
  barPix.each(saw.fast('<1 1 2 2 4 4 8 8>'), 1)
  grids.color(cyan)
  grids.each(square.fast('<2 2 4 4 8 8 16 16>'), 0.5)
}

drop: {
  atomics.dim(1)
  pars.color(hot)
  pars.dim('1 - 1 -  1 - 1 1'.fadeOut(1).roll())        // move: .fast(2) on the second eight
  barPix.color(hot)
  bars.each('1 - - -'.fadeOut(2))                        // a chase across all 16 bars, with tails
  grids.color('<red orange>')
  atom1.pixels.eachXY(saw.fast(2))                       // sweeps across each grid,
  atom2.pixels.eachXY(saw.fast(2))
  atom3.pixels.eachXY(saw.fast(2), 0, 1)                 // and down the middle two
  atom4.pixels.eachXY(saw.fast(2))
  wall.eachXY(saw.fast(2))                               // the screen runs the same sweep
}

breakdown: {
  atomics.dim(1)
  pars.color(blue)
  pars.dim(sine.slow(4).range(0.2, 0.8).fan(0.6))        // brightest in the middle, fanned out
  barPix.color(blue)
  bars.dim('1*16'.across(saw.slow(2)).spiral())          // one light walks the 16 bars and back
  grids.color(blue)
  grids.each(sine.slow(8).range(0, 0.1))
}

lift: {
  atomics.dim(1)
  pars.color('<0 1 2 3>'.palette(warm))                  // a new colour from the palette every bar
  pars.dim('1(5,8)'.fadeOut(0.5))
  barPix.color('0 1 2 3'.palette(warm))
  bars.dim('1 0 1 1'.jux(rev))                           // left half and right half answer each other
  grids.color(white)
  grids.each('1(3,8)'.clip(0.25).punchcard(), 0.5)       // short euclid flashes rolling across the grids
}

outro: {
  pars.temp(3200)
  pars.each(sine.slow(8).range(0, 0.5), 8)
  barPix.temp(2700)
  bars.each(saw.slow(8).range(0, 0.3), 8)
  room.fill(0.3, 0.15, 0)
}

// ── layers · take the underscore off to bring one in ────────────────────────
_$: strips.each('1(3,8)'.clip(0.3).mul(slider(0.8)))          // Atomic strobe strips on an euclid rhythm
_$: strips.each('- - - -  - - 1 1'.settle(0.25).fast('<1 2>'))  // a fill into the next section
_$: room.fill(hot)                                              // the room screen follows the drop colour

// ── choosing the look ───────────────────────────────────────────────────────
cue(doors, intro, build, drop, breakdown, lift, outro)

// autopilot: the whole arrangement against the track from the bar you synced.
// swap the underscores on these two lines to hand the choice to the pattern.
_$: cue(doors, intro, build, drop, breakdown, lift, outro,
  arrange([4, 'doors'], [16, 'intro'], [8, 'build'], [16, 'drop'],
    [8, 'breakdown'], [16, 'lift'], [8, 'outro']))
