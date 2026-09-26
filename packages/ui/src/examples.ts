/**
 * Bundled example scenes.
 *
  * The demos that ship with gobo. They are read-only content held in
 * the source and loaded into the working buffer on request; once the user
 * edits one it is their buffer, not our template. Earlier versions seeded
 * them into localStorage as ordinary saved scenes, which needed in-place
 * patching of stale seeds, a reset button, and a "protected" flag on the
 * default.
 *
 * The code strings are copied verbatim from the scenes they replace. These
 * are working, rehearsed scenes, so they are content, not code to tidy up.
 *
 * EXAMPLES[0] is load-bearing: buffer.ts seeds a brand-new buffer from it, so
 * the first entry is what a first-time visitor sees. It is kept to two lines
 * on purpose. A wall of API in the editor is the wrong first impression when
 * the reference is one click away, and the tour that used to live there is
 * still here as its own entry.
 */

export interface Example {
  /** Stable id, safe to persist in a menu or a URL. Never reuse an id for
   *  different code, or an old link resolves to the wrong scene. */
  id: string;
  /** Short human label, shown in the list and in the status line that
   *  confirms a load. */
  label: string;
  /** One line saying what the example demonstrates, shown in the menu. */
  blurb: string;
  code: string;
}

export const EXAMPLES: Example[] = [
  {
    id: 'hello',
    label: 'start here',
    blurb: 'Two lines: patch an RGB wash and fade a colour across it.',
    // What a new browser opens on, so it is the whole first impression.
    //
    // Deliberately tiny, and deliberately the ordinary thing: patch a
    // fixture, give a channel a pattern. The one extra comment is the way to
    // real light, which is the next thing anyone asks. That is the shape of every scene
    // after it. No output call, so the first run cannot warn about a rig that
    // is not there, and the sim panel shows the result with nothing plugged
    // in. The fuller tour is one tab away.
    code: `// ctrl+enter to run · ctrl+space to stop · 'docs' for everything else
// real lights: click the connection light, top right, and pick an output
const wash = fixture(1, 'rgb')
wash.color(sine.slow(2), 0, cosine.slow(2))
`,
  },
  {
    id: 'small-rig',
    label: 'four pars and a strobe',
    blurb: 'A small real rig: patch by address, a palette across a group, a chase, a strobe fill.',
    // The shape most people's first real rig takes, with built-in fixture
    // types only, so it runs against hardware with nothing defined. Every
    // alternate is written to be swapped in for the line above it.
    code: `// four pars and a strobe · the usual first rig
// patch each light at the DMX address set on the fixture itself
// artnet('2.255.255.255')   // pick your network in the outputs panel
setBPM(124)

const par1 = fixture(1, 'dim-rgbw')
const par2 = fixture(6, 'dim-rgbw')
const par3 = fixture(11, 'dim-rgbw')
const par4 = fixture(16, 'dim-rgbw')
const pars = group(par1, par2, par3, par4)
const strb = fixture(21, 'strobe')

// ── colour · a palette spreads across the group, one stop per light ──
const warm = [amber, orange, red]
pars.color(warm)
// pars.color(red, amber, red, amber)
// pars.color(mini('<red blue>'))                // all change each bar

// ── chase · every light runs it, each a step behind the last ───────
pars.each(mini('1 - - -').fadeOut(2))
// pars.each(sine.slow(4), 4)                     // a smooth wave
// pars.dim(mini('1*8').across(saw))              // one light walks the rig
// pars.dim(mini('1 1 1 1').settle(0.5))          // all flash on the beat

// ── strobe · a fill at the end of every bar, dark the rest of it ───
strb.dim(mini('- - - [1 1 1 1]').flash())

// ── grand master · one fader for every light; drag the handle ───────
all(mul(slider(1)))
// strb.dim(mini('- - - -  - - - [1 1 1 1 1 1 1 1]').slow(2).flash()) // every other bar
`,
  },
  {
    // The id stays 'starter': ids are persisted in menus and links, and reusing
    // or changing one silently resolves an old reference to different code.
    // Only the label changes, because "starter demo" now names the thing that
    // is NOT what you start with.
    id: 'starter',
    label: 'language tour',
    blurb: 'Everything the language does: patching, mini notation, waveforms, groups, layering.',
    code: `// gobo · ctrl+enter run · ctrl+space stop · 'docs' for the full reference
// commented lines are alternates: swap one in and run again

// pick an output when you have one · the sim below needs none
// artnet('2.0.0.100')   // or usb() · td() · sacn(1) · osc() · mock()
setBPM(120)           // one cycle = one bar = 4 beats

// ── patch · fixture(startCh, id, universe = 0) · .viz adds a widget ─
const wash  = fixture(1, 'rgbw').viz('color')     // uni 0 · ch 1-4
const strb  = fixture(5, 'strobe').viz('meter')   // ch 5-6
const strip = rgbStrip(7, 10).viz('strip')        // ch 7-36, 3 per pixel

// any layout · 'pixels' below is a nested RGBW strip
defineFixture('four-color-bar', {
  name: 'Four-Colour Moving Bar',
  manufacturer: 'Generic',
  type: 'generic',
  channelCount: 38,
  channels: [
    { offset: 0, name: 'direction',   type: 'control'   },
    { offset: 1, name: 'speed',       type: 'control'   },
    { offset: 2, name: 'effect',      type: 'control'   },   // 0 = direct pixels
    { offset: 3, name: 'effectSpeed', type: 'control'   },
    { offset: 4, name: 'dim',         type: 'intensity' },
    { offset: 5, name: 'strobe',      type: 'strobe'    },
    { offset: 6, name: 'pixels', type: 'strip', pixelCount: 8, pixelLayout: 'rgbw' },
  ],
})
const bar = fixture(1, 'four-color-bar', 1)       // uni 1 · ch 1-38
bar.pixels.viz('strip')
bar.dim()                                         // no value at all = full

// ── mini · one bar, split evenly by its tokens ─────────────────────
wash.red(  mini('1 - - -  - - 1 -  - - 1 -  - - - -').glow())
wash.green(mini('- - 1 -  1 - - -  - - - -  - 1 - -'))
wash.blue( mini('- 1 - -  - - - 1  - <0 1> - -  1 - - 1'))
wash.white(mini('- - - 1  - - - -  - - - 1  - - - -'))

// swap any of these into a channel above
// wash.red(mini('1 [1 1] 1 -'))              // subdivide
// wash.red(mini('1*16'))                     // repeat
// wash.red(mini('1@3 0.2'))                  // hold three
// wash.red(mini('1!3 0.2'))                  // same, spelled out
// wash.red(mini('<0 0.5 1>'))                // one per bar
// wash.red(mini('1? 1? 1? 1?'))              // coin flip each
// wash.red(mini('1(5,16)'))                  // euclid
// wash.red(mini('{1 0, 0.4 0.4 0.4}'))       // polymeter, 2 against 3
// wash.red(mini('1*16').degradeBy(0.3))      // thinned at random
// wash.red(mini('1 - - -, 0.25 0.25 0.25 0.25')) // layered, brightest wins

// ── longer than a bar · a string is ONE cycle, so .slow(n) ─────────
strb.dim(0.9)
strb.strobe(mini(\`
  - - - -    - - - -
  - - - -    - [1 1 1 1] - [1 1 1 1]
\`).slow(2).flash())

// ── waveforms · sine cosine square saw rand, chained left to right ─
// swap one of these in for the two strip lines below
// strip.red(sine.slow(4).segment(8))               // stepped
// strip.red(sine.slow(8).rangex(0.01, 1))          // a fade the eye sees evenly
// strip.red(sine.slow(4).range(1, 0))              // inverted
// strip.red(sine.slow(2).mask(mini('1 1 - -')))    // gated, keeps running
// strip.red(sine.slow(4).struct(mini('1 - 1 -')))  // rhythm from elsewhere
// strip.red(sine.mul(mini('1 0.25')))              // one pattern scales another
// strip.red(mini('1 0.6 0.3 0').iter(4))           // rotates a step each bar
// strip.red(mini('1 0.6 0.3 0').palindrome())      // there and back
// strip.red(mini('1 0.6 0.3 0').linger(0.25))      // stutter on beat one
// strip.red(mini('1 - 1 -').every(4, fast(2)))     // doubles every 4th bar
// strip.red(mini('1 1 1 1').chunk(4, mul(0.2)))    // dip travels across
// strip.red(mini('1 0.5').ply(mini('<1 2 4 8>')))  // subdivides per bar
// strip.red(mini('1*8').swingBy(1/3, 2))           // stops marching

// ── fades · every step comes up, settles and goes out ──────────────
// strip.red(mini('1 - 1 -').fadeIn(0.5))           // swells in
// strip.red(mini('1 - - -').fadeOut(2))            // glows after the hit
// strip.red(mini('1 1 1 1').settle(0.25))          // a flash per beat

// ── per-pixel · .each(pattern): every pixel runs it, a step later ───
strip.color(blue)
strip.each(cosine.slow(2).range(-8, 1))           // the wave runs over the colour

bar.pixels.rainbowChase()                         // colour along the pixels, prebuilt
// bar.pixels.pixelGrid([[1,0,0,0], [0,0,1,0]]).repeat() // red/blue tile
// bar.pixels.pixel(0, 1, 0, 0, 0)                      // one pixel, red (rgbw)

// ── group · a fixture counts once, a strip once per pixel ──────────
const rig = group(wash, strip, bar.pixels)
// rig.each(cosine.slow(4).range(-6, 1), 4)       // one sweep, whole rig
// rig.mono(mini('1*16').across(rand).fadeOut(1))  // sparkle with tails
// rig.color(1, 0, 0)
// rig.red()
// rig.off()

// ── layering · brightest wins, so a layer adds without erasing ─────
bar.pixels.white(mini('1 - - -').range(-15, 1).off(0.25, mul(0.35)))
// bar.pixels.white(mini('1 - - -').echo(4, 0.125, 0.5)) // repeats, each dimmer
// bar.pixels.white(stack(mini('1 - - -'), sine.slow(8).mul(0.2)))

// ── movement ───────────────────────────────────────────────────────
bar.direction(sine.slow(8)); bar.speed(0.6)       // sweep
// bar.direction(saw.slow(6)); bar.speed(0.8)     // spin

// ── looks · a named block; alt+1 / alt+2 or the chips pick one ─────
// swap these in for the wash lines at the top, where mini sets the colour
// verse: { wash.color(blue) }
// chorus: { wash.color(red) }
// cue(verse, chorus)
// bar.speed(0)                                   // freeze
`,
  },
  {
    id: 'four-color-bar',
    label: 'four-colour bar demo',
    blurb: 'One custom fixture end to end: defineFixture, pixel effects, movement.',
    code: `// four-colour bar · live demo
// every line at the bottom runs on ctrl+enter; comment one out to silence it.

// pick an output when you have one · the sim below needs none
// artnet('2.0.0.100')   // or usb() · td() · sacn(1) · osc() · mock()
setBPM(120)

// ── define a custom fixture ───────────────────
// defineFixture(id, def) registers a channel layout under a name we can
// reference below. 38 channels total: 4 macro/control channels, master
// dim + strobe, then an 8-pixel RGBW strip (32 chs) starting at offset 6.
// offsets are 0-based relative to whatever startChannel we instantiate at.
defineFixture('demo-bar', {
  name: 'Four-Colour Moving Bar',
  manufacturer: 'Generic',
  type: 'generic',
  channelCount: 38,
  channels: [
    { offset: 0, name: 'direction',   type: 'control'   },
    { offset: 1, name: 'speed',       type: 'control'   },
    { offset: 2, name: 'effect',      type: 'control'   },
    { offset: 3, name: 'effectSpeed', type: 'control'   },
    { offset: 4, name: 'dim',         type: 'intensity' },
    { offset: 5, name: 'strobe',      type: 'strobe'    },
    { offset: 6, name: 'pixels',      type: 'strip', pixelCount: 8, pixelLayout: 'rgbw' },
  ],
})

// instantiate the fixture at universe 1, channel 1.
const bar = fixture(1, 'demo-bar', 1)
bar.pixels.viz('strip')
bar.dim(1)

// ── LIVE ──────────────────────────────────────
// swap one line or block in for the solid white and ctrl+enter to apply.
// each block is a self-contained effect; the trailing comment is its label.

bar.pixels.fill(0, 0, 0, 1)                                          // solid white
// bar.pixels.white(sine.slow(8).range(0.1, 1).glow())             // breathe
// bar.pixels.white(mini('1 - - -').range(-15, 1).flash())           // pulse
// bar.pixels.white(mini('1 - 1 -').range(-15, 1).flash())           // double

// walk: a fade that passes through each pixel in turn. The last number is
// how far apart the pixels run; lower the -7 for a wider band.
// bar.pixels.each(cosine.slow(2).range(-7, 1), 2)                   // walk
// bar.pixels.each(mini('1 - - - - - - -').fadeOut(2))                // chase with tails

// bar.pixels.rainbowChase({ cycles: 2, width: 0.14 })               // rainbow

// bar.pixels.pixelGrid([[1,0,0,0], [1,0,0,0], [1,0,0,0], [1,0,0,0], [0,0,1,0]]).hold() // half red, half blue

// bar.pixels.pixelGrid([[1,0,0,0], [0,0,1,0]]).repeat()              // red/blue tile
// bar.pixels.pixelGrid([[1,0,0,0], [0,1,0,0], [0,0,1,0]]).mirror()   // r/g/b symmetry
// bar.pixels.pixelGrid([[1,1,0,0]]).hold()                           // yellow hold

// movement (stack on top of any pixel effect)
// bar.direction(0.5); bar.speed(0)                                  // center
// bar.direction(0); bar.speed(0)                                    // left
// bar.direction(1); bar.speed(0)                                    // right
// bar.direction(sine.slow(8)); bar.speed(0.6)                     // sweep
// bar.direction(saw.slow(6)); bar.speed(0.8)                      // spin
// bar.direction(sine.slow(1).range(0.4, 0.6)); bar.speed(0.5)     // wobble
// bar.speed(0)                                                      // freeze
`,
  },
];

/** Look up an example by id. Returns undefined for unknown ids so callers
 *  (a stale menu entry, a hand-edited link) can fail visibly instead of
 *  silently loading the wrong scene. */
export function getExample(id: string): Example | undefined {
  return EXAMPLES.find((e) => e.id === id);
}
