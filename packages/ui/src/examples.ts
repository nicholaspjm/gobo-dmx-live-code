/**
 * Bundled example scenes.
 *
 * These are the three demos that ship with gobo. They used to be seeded
 * into localStorage as ordinary saved scenes, which meant the app fought
 * the user over them: a stale seed had to be patched in place, a reset
 * button existed only to re-apply one, and a "protected" flag stopped the
 * default from being overwritten. None of that is needed now. Examples are
 * read-only content held in the source, loaded into the working buffer on
 * request; if the user edits one, it is their buffer, not our template.
 *
 * The code strings are copied verbatim from the scenes they replace —
 * these are working, rehearsed scenes, so they are content, not something
 * to tidy up.
 *
 * EXAMPLES[0] is load-bearing: buffer.ts seeds a brand-new buffer from it,
 * so the first entry must stay the general introduction to the language.
 */

export interface Example {
  /** Stable id — safe to persist in a menu or a URL. Never reuse an id
   *  for different code, or an old link resolves to the wrong scene. */
  id: string;
  /** Short human label; also used as the buffer name when loaded, so it
   *  doubles as the suggested filename. Keep it filename-friendly. */
  label: string;
  /** One line saying what the example demonstrates, shown in the menu. */
  blurb: string;
  code: string;
}

export const EXAMPLES: Example[] = [
  {
    id: 'starter',
    label: 'starter demo',
    blurb: 'Tour of the language: fixtures, drum-grid patterns, waveforms, a pixel chase.',
    code: `// gobo — ctrl+enter to run · ctrl+space (or ctrl+.) to stop · open 'docs' for the reference

// Output target — swap in mock() for headless dev, osc() for TouchDesigner,
// or sacn(universe, priority) for E1.31. Port defaults to 6454 for Art-Net.
artnet('2.0.0.100')

// ── fixtures ──────────────────────────────────────────────
// fixture(startChannel, id, universe = 0) returns an object with one setter
// per named channel. Chain .viz('kind') to drop a live widget at line-end.
const wash  = fixture(1, 'rgbw').viz('color')          // uni 0, ch 1-4
const strb  = fixture(5, 'strobe').viz('meter')        // uni 0, ch 5-6

// rgbStrip(startChannel, pixelCount) — pixel bar at 3 channels per pixel.
const strip = rgbStrip(7, 10).viz('strip')             // uni 0, ch 7-36

// Custom fixture — defineFixture lets you describe any channel layout. The
// 'pixels' channel below is a nested RGBW strip thanks to pixelLayout:'rgbw'.
defineFixture('four-color-bar', {
  name: 'Four-Colour Moving Bar',
  manufacturer: 'Generic',
  type: 'generic',
  channelCount: 38,
  channels: [
    { offset: 0, name: 'direction',   type: 'control'   },
    { offset: 1, name: 'speed',       type: 'control'   },
    { offset: 2, name: 'effect',      type: 'control'   },   // leave 0 for direct pixel control
    { offset: 3, name: 'effectSpeed', type: 'control'   },
    { offset: 4, name: 'dim',         type: 'intensity' },
    { offset: 5, name: 'strobe',      type: 'strobe'    },
    { offset: 6, name: 'pixels',      type: 'strip', pixelCount: 8, pixelLayout: 'rgbw' },
  ],
})
const bar = fixture(1, 'four-color-bar', 1)            // uni 1, ch 1-38
bar.pixels.viz('strip')

// ── patterns ──────────────────────────────────────────────
// Channels take a number (constant) or a pattern (animated). Patterns
// come in two flavours: continuous waveforms (sine/cosine/square/saw/
// rand, chainable with .slow / .range / .mul / etc.) and step sequences
// (mini, a drum-grid notation — see the docs panel for full syntax).

// Drum-grid on the wash — one mini() string per channel. Each string
// plays through one scheduler cycle (= 4 beats) with tokens splitting
// the time equally. '-' rests, numbers pass through as values. Whitespace
// between tokens is free — group in fours for readability.
// See the 'sequencing' docs entry for subdivisions, repeats, and more.
wash.red(  mini('1 - - -  - - 1 -  - - 1 -  - - - -').glow())
wash.green(mini('- - 1 -  1 - - -  - - - -  - 1 - -'))
wash.blue( mini('- 1 - -  - - - 1  - 1 - -  1 - - 1'))
wash.white(mini('- - - 1  - - - -  - - - 1  - - - -'))

// Strobe burst on beats 2 and 4. [1 1 1 1] compresses four hits into
// one slot (4× the outer step rate), so each bracket gives a rapid
// roll. Uncomment to fire.
// strb.dim(0.9)
// strb.strobe(mini('- [1 1 1 1] - [1 1 1 1]').flash())

// Rainbow chase on the strip — manual for-loop version so the math is
// visible. strip.rainbowChase() would do the same in one line (see the
// 'effects' tab in the docs for the full mechanism).
const hueR = sine().slow(12).range(0, 1)
const hueG = sine().early(1/3).slow(12).range(0, 1)
const hueB = sine().early(2/3).slow(12).range(0, 1)
for (let i = 0; i < strip.pixelCount; i++) {
  const phase = i / strip.pixelCount
  const bright = cosine().early(phase).slow(2).range(-8, 1)
  strip.pixel(i, bright.mul(hueR), bright.mul(hueG), bright.mul(hueB))
}

// Same chase on the moving bar (universe 1) — one-line helper version.
bar.dim(1)
bar.pixels.rainbowChase()

// Kick — flash the whole bar white on every beat, sitting on top of the
// rainbow. One scheduler cycle = 4 beats, so .fast(4) gives one pulse per
// beat. .range(-15, 1) sharpens the cosine into a short snap. Writing to
// .white() alone overrides just the W channel the chase set to 0, so the
// rainbow's RGB stays visible between kicks.
//   .fast(2) → half notes · .fast(4) → quarters · .fast(8) → eighths
bar.pixels.white(cosine().fast(4).range(-15, 1))
`,
  },
  {
    id: 'ultratronics-11',
    label: 'ultratronics 11',
    blurb: 'Live-performance template: named instruments up top, a LIVE block you toggle mid-set.',
    code: `// ultratronics 11 — Ryoji Ikeda · 5:30 · 108 BPM
//
// Section cues extracted from the actual track via librosa analysis
// (scripts/analyse-track.py). Timings are seconds into the file —
// keep this comment pinned for rehearsal.
//
//   0:00  intro            sparse, dark · rms ~0.33
//   0:36  development      bass creeping in · rms ~0.36
//   1:12  first shift      texture change · rms ~0.39→0.68
//   1:35  main body        full drive · rms 0.70–0.94 (peaks ~2:10)
//   3:00  second wave      peak intensity · rms 0.72–0.98 (peak ~3:40)
//   4:36  outro            ebb · rms 0.56–0.60
//   5:21  fade             rms falls to silence
//
// Play the track through your own audio setup. setBPM(108) is wired
// from the librosa estimate; if it drifts from what you hear, tap-tempo
// with T to lock the internal clock to the beat.

artnet('2.0.0.100')
setBPM(108)

// ── fixtures ──────────────────────────────────────────────
// spot = simple RGBW par at uni 0 ch 1-4.
// bar  = custom 4-colour moving bar (see 'four-color-bar demo' scene
//        for the full breakdown of defineFixture).
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
const spot = fixture(1, 'rgbw').viz('color')
const bar  = fixture(1, 'demo-bar', 1)
bar.pixels.viz('strip')
bar.dim(1)

// ── instrument library ────────────────────────────────────
// Each call registers patterns on specific colour channels on the
// spot (r / g / b / w) — we have a 4-channel RGBW par with no
// dedicated dim, so brightness comes from driving the colour
// channels directly. One function per channel family at a time:
//
//   WHITE  → kicks / peaks
//   GREEN  → hi-hats / mid detail
//   BLUE   → drones
//   RED    → noise / bass
//
// Two functions that share a channel family will override each
// other (last call wins). Uncomment one from each family when you
// want them running in parallel.

// ── WHITE · kicks / peaks ─────────────────────────────────
function kickSlow()   { spot.white(mini('1 - - -').slow(2).flash()) }
function kick()       { spot.white(mini('1 - - -').flash()) }
function kickDouble() { spot.white(mini('1 - 1 -').flash()) }

// ── GREEN · hats / mid detail ─────────────────────────────
function hatsOffbeat() { spot.green(mini('- 1 - 1 - 1 - 1').range(0, 0.4)) }
function hats()        { spot.green(mini('1 1 1 1  1 1 1 1  1 1 1 1  1 1 1 1').range(0, 0.35)) }
function hatsDense()   { spot.green(mini('1*32').range(-2, 0.6)) }

// ── BLUE · drones ─────────────────────────────────────────
function sineDeep()  { spot.blue(sine().slow(32).range(0.3, 0.8).glow()) }
function sineTone()  { spot.blue(sine().slow(16).range(0.1, 0.9).glow()) }

// ── RED · noise / bass ────────────────────────────────────
function noiseBurst() { spot.red(rand().range(-6, 1)) }

// ── BAR · independent 8-pixel RGBW moving bar on universe 1 ──
function barPulse()  { bar.pixels.white(mini('1 - - -').range(-15, 1).flash()) }
function barSweep()  { bar.pixels.rainbowChase({ speed: 2, narrow: 12 }) }
function barStrobe() { bar.pixels.white(mini('1*16').range(-4, 1)) }
function barOff()    { bar.pixels.fill(0, 0, 0, 0) }

// ── LIVE ──────────────────────────────────────────────────
// Uncomment elements per section, Ctrl+Enter to apply. Section cue
// times in the header comment. You're not required to follow them —
// improvise — but the grouping below is a suggested arrangement.

// --- intro · 0:00-0:36 · minimal ---
// sineDeep()

// --- development · 0:36-1:12 · bass creeps in ---
// sineDeep()
// noiseBurst()
// hatsOffbeat()

// --- first shift · 1:12-1:35 · texture change ---
// sineTone()
// hatsOffbeat()
// noiseBurst()

// --- main body · 1:35-3:00 · full drive ---
// kick()
// hats()
// sineTone()
// barSweep()

// --- second wave · 3:00-4:36 · peak intensity ---
// kickDouble()
// hats()
// barPulse()
// barSweep()

// --- outro · 4:36-5:21 · ebb ---
// sineTone()
// hatsOffbeat()

// --- fade · 5:21-5:30 ---
// barOff()
`,
  },
  {
    id: 'four-color-bar',
    label: 'four-colour bar demo',
    blurb: 'One custom fixture, every trick it can do — defineFixture, pixel effects, movement.',
    code: `// four-colour bar — live demo
// every line at the bottom runs on ctrl+enter. comment a line to silence it.

artnet('2.0.0.100')
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
// uncomment one line/block and ctrl+enter to apply. each block is a
// self-contained effect — the trailing comment is the label.

bar.pixels.fill(0, 0, 0, 1)                                          // solid white
// bar.pixels.white(sine().slow(8).range(0.1, 1).glow())             // breathe
// bar.pixels.white(mini('1 - - -').range(-15, 1).flash())           // pulse
// bar.pixels.white(mini('1 - 1 -').range(-15, 1).flash())           // double

// walk — fade through each pixel in sequence.
// raise speed for faster passes; raise narrow for tighter fade.
// const speed = 2, narrow = 7
// for (let i = 0; i < bar.pixels.pixelCount; i++) {
//   const fade = cosine().slow(speed).early(i / bar.pixels.pixelCount).range(-narrow, 1)
//   bar.pixels.pixel(i, fade)
// }

// bar.pixels.rainbowChase({ speed: 2, narrow: 6 })                  // rainbow

// split — half red / half blue
// for (let i = 0; i < bar.pixels.pixelCount; i++) {
//   bar.pixels.pixel(i, i < 4 ? 1 : 0, 0, i < 4 ? 0 : 1, 0)
// }

// bar.pixels.pixelGrid([[1,0,0,0], [0,0,1,0]]).repeat()              // red/blue tile
// bar.pixels.pixelGrid([[1,0,0,0], [0,1,0,0], [0,0,1,0]]).mirror()   // r/g/b symmetry
// bar.pixels.pixelGrid([[1,1,0,0]]).hold()                           // yellow hold

// movement (stack on top of any pixel effect)
// bar.direction(0.5); bar.speed(0)                                  // center
// bar.direction(0);   bar.speed(0)                                  // left
// bar.direction(1);   bar.speed(0)                                  // right
// bar.direction(sine().slow(8)); bar.speed(0.6)                     // sweep
// bar.direction(saw().slow(6));  bar.speed(0.8)                     // spin
// bar.direction(sine().slow(1).range(0.4, 0.6)); bar.speed(0.5)     // wobble
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
