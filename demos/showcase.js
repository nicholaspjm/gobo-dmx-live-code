// gobo showcase · 2 moving bars, 4 Atomics, 5 pars and the page itself, to a 124 BPM track
//
// before the doors
//   1. load a 124 BPM track (or change setBPM below to match yours)
//   2. tap T on the beat a few times, then press sync on the one of a bar
//   3. alt+m for minimal view, so the page behind the code is the whole screen
//
// how the set runs: four layers below, each one block that starts with $:
// an underscore in front (_$:) mutes the whole block, taking it off brings it
// in; ctrl+enter after every change. Inside a block, the line for each part
// of the track is written out: comment one in, the other out.
//
//   doors      page glow and candle pars are on; bars and Atomics muted
//   intro      unmute the bars, then the Atomics, on a downbeat
//   build      swap each block to its build line
//   drop       swap to the drop lines; turn the hot swatch for a new colour
//   breakdown  mute the Atomics, swap bars and pars to breakdown
//   lift       the lift lines, Atomic strobe strips back in
//   outro      pars and bars to outro, mute the rest, ctrl+. to black out
//
// prefer picking sections with keys? the looks at the bottom do the same set
// as alt+1 to alt+7: mute the four layers and unmute the cue line there.

setBPM(124)

// ── patch · addresses from the DMX patch sheet ──────────────────────────────
// the sheet's universes 1, 2 and 3 are Art-Net universes 0, 1 and 2 here;
// if your node counts from 1, add one to each
const U1 = 0
const U2 = 1
const U3 = 2

// the Four-Colour Moving Bar: four control channels, dimmer, strobe, then eight
// RGBW pixels. The sheet reserves 40 channels per bar; the profile uses 38.
defineFixture('moving-bar-8', {
  name: 'Four-Colour Moving Bar',
  manufacturer: 'Generic',
  type: 'generic',
  channelCount: 38,
  channels: [
    { offset: 0, name: 'direction',   type: 'control'   },   // 0 left, 0.5 centre, 1 right
    { offset: 1, name: 'speed',       type: 'control'   },   // 0 for a fixed position
    { offset: 2, name: 'effect',      type: 'control'   },   // 0 = the pixels below
    { offset: 3, name: 'effectSpeed', type: 'control'   },
    { offset: 4, name: 'dim',         type: 'intensity' },
    { offset: 5, name: 'strobe',      type: 'strobe'    },
    { offset: 6, name: 'pixels', type: 'strip', pixelCount: 8, pixelLayout: 'rgbw' },
  ],
})

const bar1 = fixture(17, 'moving-bar-8', U1)
const bar2 = fixture(57, 'moving-bar-8', U1)
bar1.pixels.viz('strip')
bar2.pixels.viz('strip')

const par1 = fixture(295, 'par-rgbw-7ch', U2).viz('color')
const par2 = fixture(302, 'par-rgbw-7ch', U2)
const par3 = fixture(309, 'par-rgbw-7ch', U2)
const par4 = fixture(316, 'par-rgbw-7ch', U2)
const par5 = fixture(323, 'par-rgbw-7ch', U2)

const atom1 = fixture(350, 'atomic-strobe-154ch', U2)
const atom2 = fixture(1, 'atomic-strobe-154ch', U3)
const atom3 = fixture(155, 'atomic-strobe-154ch', U3)
const atom4 = fixture(309, 'atomic-strobe-154ch', U3)

// the page behind the code is a light: in minimal view the whole screen is it,
// so a laptop on stage or a projector on the back wall joins the rig
const page = screen(1, { background: true })

const bars = group(bar1, bar2)
const barPix = group(bar1.pixels, bar2.pixels)
const pars = group(par1, par2, par3, par4, par5)
const atomics = group(atom1, atom2, atom3, atom4)
const grids = group(atom1.pixels, atom2.pixels, atom3.pixels, atom4.pixels)
const strips = group(atom1.strip, atom2.strip, atom3.strip, atom4.strip)

// ── always on ───────────────────────────────────────────────────────────────
bars.set('effect', 0)                         // the bars run their pixels from here, not a built-in effect
const hot = pick('hot', { start: magenta })   // the drop colour: click the swatch to change it live
const warm = [amber, orange, red, magenta]
all(mul(slider(1)))                           // grand master: every light, the page included
// const fader = midi(74)                     // or a hardware fader, after turning on midi in
// all(mul(fader))                            //   (outputs panel), in place of the line above

// ── layer 1 · the page ──────────────────────────────────────────────────────
$: {
  page.fill(sine.slow(8).range(0, 0.12), 0, sine.slow(8).range(0.05, 0.3))   // doors: a slow blue breath
  // page.color(hot)
  // page.each('1 - - -'.fadeOut(2))                                        // drop: a hit on every bar
  // page.color(white)
  // page.each('- - 1 -'.settle(0.25).fast('<1 2 4 8>'))                     // build: the fill doubles
}

// ── layer 2 · pars ──────────────────────────────────────────────────────────
$: {
  pars.temp(2000)
  pars.dim(0.08)                                                  // doors: candle level
  // pars.temp(3200)
  // pars.each(sine.slow(8).range(0.1, 0.5), 8)                   // intro: a slow wave through the pars
  // pars.color(cyan)
  // pars.dim('1*4'.fast('<1 1 2 2 4 4 8 8>').settle(0.25))       // build: flashes doubling every two bars
  // pars.color(hot)
  // pars.dim('1 - 1 -  1 - 1 1'.fadeOut(1).roll())               // drop  · move: .fast(2) on the second eight
  // pars.color(blue)
  // pars.dim(sine.slow(4).range(0.2, 0.8).fan(0.6))              // breakdown: brightest in the middle
  // pars.color('<0 1 2 3>'.palette(warm))
  // pars.dim('1(5,8)'.fadeOut(0.5))                              // lift: a palette step every bar
}

// ── layer 3 · the moving bars ───────────────────────────────────────────────
_$: {
  bars.dim(1)
  barPix.color(blue)
  barPix.each(sine.slow(4).range(0.1, 0.6), 2)                   // intro: a wave along both bars
  bar1.direction(sine.slow(8))
  bar2.direction(sine.slow(8).early(0.5))                          // mirrored: they cross in the middle
  bars.set('speed', 0.6)
  // barPix.color(white)
  // barPix.each(saw.fast('<1 1 2 2 4 4 8 8>'), 1)                // build
  // barPix.color(hot)
  // barPix.each('1 - - -'.fadeOut(2), 2)                        // drop: a chase with tails
  // bar1.direction(saw.slow(2))
  // bar2.direction(saw.slow(2).early(0.5))                       // drop: both spin
  // bars.dim('1 0 1 1'.jux(rev))                                // lift, in place of bars.dim(1): the bars answer each other
  // bars.set('direction', 0.5)
  // bars.set('speed', 0)                                        // breakdown: centred and still
}

// ── layer 4 · the Atomics ───────────────────────────────────────────────────
_$: {
  atomics.dim(1)                                                   // full: the pixels and strips carry the level
  grids.color(blue)
  grids.each(sine.slow(8).range(0, 0.25).glow(), 2)               // intro: a slow wash
  // grids.color(cyan)
  // grids.each(square.fast('<2 2 4 4 8 8 16 16>'), 0.5)          // build
  // grids.color('<red orange>')
  // atom1.pixels.eachXY(saw.fast(2))                             // drop: a sweep across each grid,
  // atom2.pixels.eachXY(saw.fast(2))
  // atom3.pixels.eachXY(saw.fast(2), 0, 1)                       //   and down the middle two
  // atom4.pixels.eachXY(saw.fast(2))
  // grids.color(white)
  // grids.each('1(3,8)'.clip(0.25).punchcard(), 0.5)             // lift: short euclid flashes
  // strips.each('1(3,8)'.clip(0.3).mul(slider(0.8)))             // strobe strips on an euclid rhythm
  // strips.each('- - - -  - - 1 1'.settle(0.25).fast('<1 2>'), 0)  // or a fill into the next section
}

// ── sections, off by default ────────────────────────────────────────────────
// the same set as seven looks, picked on the beat with alt+1 to alt+7. To use
// them, put an underscore on the four layers above and take it off the cue
// line below. The autopilot line plays the whole arrangement against the
// track from the bar you synced.
doors: {
  page.fill(sine.slow(8).range(0, 0.12), 0, sine.slow(8).range(0.05, 0.3))
  pars.temp(2000)
  pars.dim(0.08)
}
intro: {
  page.color(blue)
  page.each(sine.slow(8).range(0, 0.2))
  pars.temp(3200)
  pars.each(sine.slow(8).range(0.1, 0.5), 8)
  bars.dim(1)
  barPix.color(blue)
  barPix.each(sine.slow(4).range(0.1, 0.6), 2)
  bars.set('direction', sine.slow(8))
  bars.set('speed', 0.6)
  atomics.dim(1)
  grids.color(blue)
  grids.each(sine.slow(8).range(0, 0.25), 2)
}
build: {
  page.color(white)
  page.each('- - 1 -'.settle(0.25).fast('<1 2 4 8>'))
  pars.color(cyan)
  pars.dim('1*4'.fast('<1 1 2 2 4 4 8 8>').settle(0.25))
  bars.dim(1)
  barPix.color(white)
  barPix.each(saw.fast('<1 1 2 2 4 4 8 8>'), 1)
  atomics.dim(1)
  grids.color(cyan)
  grids.each(square.fast('<2 2 4 4 8 8 16 16>'), 0.5)
}
drop: {
  page.color(hot)
  page.each('1 - - -'.fadeOut(2))
  pars.color(hot)
  pars.dim('1 - 1 -  1 - 1 1'.fadeOut(1))
  bars.dim(1)
  barPix.color(hot)
  barPix.each('1 - - -'.fadeOut(2), 2)
  bars.set('direction', saw.slow(2))
  bars.set('speed', 0.8)
  atomics.dim(1)
  grids.color('<red orange>')
  atom1.pixels.eachXY(saw.fast(2))
  atom2.pixels.eachXY(saw.fast(2))
  atom3.pixels.eachXY(saw.fast(2), 0, 1)
  atom4.pixels.eachXY(saw.fast(2))
}
breakdown: {
  page.color(blue)
  page.each(sine.slow(4).range(0, 0.15))
  pars.color(blue)
  pars.dim(sine.slow(4).range(0.2, 0.8).fan(0.6))
  bars.dim(1)
  barPix.color(blue)
  barPix.each(sine.slow(8).range(0.05, 0.3), 1)
  bars.set('direction', 0.5)
  bars.set('speed', 0)
}
lift: {
  page.color('<0 1 2 3>'.palette(warm))
  page.each('1(5,8)'.fadeOut(0.5))
  pars.color('<0 1 2 3>'.palette(warm))
  pars.dim('1(5,8)'.fadeOut(0.5))
  barPix.color('0 1 2 3'.palette(warm))
  bars.dim('1 0 1 1'.jux(rev))
  bars.set('direction', sine.slow(4))
  bars.set('speed', 0.6)
  atomics.dim(1)
  grids.color(white)
  grids.each('1(3,8)'.clip(0.25), 0.5)
  strips.each('1(3,8)'.clip(0.3))
}
outro: {
  pars.temp(3200)
  pars.each(sine.slow(8).range(0, 0.5), 8)
  bars.dim(1)
  barPix.temp(2700)
  barPix.each(saw.slow(8).range(0, 0.3), 8)
  bars.set('direction', 0.5)
  bars.set('speed', 0)
}

_$: cue(doors, intro, build, drop, breakdown, lift, outro)
_$: cue(doors, intro, build, drop, breakdown, lift, outro,
  arrange([4, 'doors'], [16, 'intro'], [8, 'build'], [16, 'drop'],
    [8, 'breakdown'], [16, 'lift'], [8, 'outro']))
