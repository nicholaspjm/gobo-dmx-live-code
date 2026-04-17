/**
 * Reference panel — renders the user-facing API docs.
 *
 * The content here mirrors what's actually available in the eval sandbox
 * (see packages/core/src/eval.ts). Keep this in sync when the API changes.
 */

interface DocEntry {
  name: string;
  signature: string;
  description: string;
  example?: string;
  /**
   * When present, the entry renders as a compact clickable row that
   * switches the docs panel to the named tab when clicked. Used on the
   * welcome page to keep the overview tight: each "step" is a one-liner
   * that takes you to its own tab rather than duplicating content here.
   */
  tabLink?: DocCategory;
}

interface DocSection {
  title: string;
  blurb?: string;
  entries: DocEntry[];
  /** Tab this section lives under. Sections without a category fall into
   *  'reference' so nothing ever gets lost. */
  category?: DocCategory;
}

/**
 * Tab categories shown across the top of the docs panel. Order here is the
 * order they appear. 'start' is intentionally the default so new users land
 * on the walkthrough instead of the reference wall.
 */
type DocCategory = 'welcome' | 'patterns' | 'fixtures' | 'viz' | 'audio' | 'output' | 'reference';

// Tab order mirrors Strudel's navigation (welcome · patterns · sounds · ref
// · export · console · settings) but adapted to lights — "sounds" → fixtures
// is our equivalent output target, and we gain viz + audio tabs for the
// lumen-specific inline-decoration and audio-reactive features.
const DOC_TABS: Array<{ id: DocCategory; label: string }> = [
  { id: 'welcome',   label: 'welcome' },
  { id: 'patterns',  label: 'patterns' },
  { id: 'fixtures',  label: 'fixtures' },
  { id: 'viz',       label: 'viz' },
  { id: 'audio',     label: 'audio' },
  { id: 'output',    label: 'output' },
  { id: 'reference', label: 'reference' },
];

const DEFAULT_TAB: DocCategory = 'welcome';

const DOCS: DocSection[] = [
  // ─── welcome ────────────────────────────────────────────────────────────
  // Deliberately compact. Everything actionable lives in its own tab — this
  // page is just a one-paragraph intro plus link-list of jump-off points.
  {
    category: 'welcome',
    title: 'lumen',
    blurb:
      'Live DMX coding in the browser. JavaScript patterns drive real fixtures — Art-Net hardware, TouchDesigner via OSC, or pure simulation. Ctrl+Enter runs your code, Ctrl+. stops. Drop a track into the audio bar for bpm-locked reactivity. Hover any fixture in the sim panel for its live channel values.',
    entries: [],
  },
  {
    category: 'welcome',
    title: 'steps',
    entries: [
      { name: 'pick an output',   signature: 'artnet · osc · sacn · mock',             description: '', tabLink: 'output' },
      { name: 'define fixtures',  signature: 'fixture · rgbStrip · defineFixture',     description: '', tabLink: 'fixtures' },
      { name: 'write patterns',   signature: 'sine · cosine · square · saw · chains',  description: '', tabLink: 'patterns' },
      { name: 'inline viz',       signature: ".viz · .flash · .glow · .wave",          description: '', tabLink: 'viz' },
      { name: 'sync to audio',    signature: 'audio.bass · mid · treble · rms · peak', description: '', tabLink: 'audio' },
      { name: 'low-level DMX',    signature: 'ch · uni · dim · rgb',                   description: '', tabLink: 'reference' },
    ],
  },

  {
    category: 'output',
    title: 'output',
    blurb:
      'Pick where DMX data goes. Call exactly one of these at the top of your code. Switching while running reconfigures on the fly.',
    entries: [
      {
        name: 'artnet',
        signature: "artnet(host='127.0.0.1', port=6454)",
        description:
          "Send Art-Net DMX packets via the bridge. Port defaults to the standard Art-Net port 6454, so you almost never need to pass it. Use your node's IP to unicast, or a subnet broadcast (e.g. 2.255.255.255) to hit every node. One ArtDmx packet is transmitted per universe per tick, so multi-universe is automatic — just assign fixtures to different universes.",
        example: "artnet('2.0.0.100')",
      },
      {
        name: 'osc',
        signature: "osc(host='127.0.0.1', port=9000)",
        description:
          'Send every active channel as an OSC message via the bridge. Address format: /lumen/<universe>/<channel>, one float arg in [0,1]. Works great with TouchDesigner OSC In CHOP.',
        example: "osc('127.0.0.1', 9000)",
      },
      {
        name: 'sacn',
        signature: 'sacn(universe=1, priority=100)',
        description:
          'Multicast sACN (E1.31) packets via the bridge. Priority 1-200, universe 1-63999.',
        example: 'sacn(1, 100)',
      },
      {
        name: 'mock',
        signature: 'mock()',
        description:
          "Console-log mode. No UDP, no WebSocket — the bridge prints active channels ~2x per second. Useful when you just want to verify patterns without touching a network.",
        example: 'mock()',
      },
    ],
  },

  {
    category: 'patterns',
    title: 'clock',
    entries: [
      {
        name: 'setBPM',
        signature: 'setBPM(bpm)',
        description:
          'Set the scheduler tempo. One Strudel cycle = one beat, so .fast(4) at 120 BPM fires 4x per beat = 8 per second.',
        example: 'setBPM(128)',
      },
    ],
  },

  {
    category: 'audio',
    title: 'audio',
    blurb:
      "Optional. Load a track (or enable the mic) from the audio bar at the bottom of the screen; pattern code can then react to it. When a track is playing, the scheduler's cycle position follows the track — patterns stay phase-locked through pauses and seeks. Mic mode uses the internal clock (no track position). All audio sources return 0..1 patterns you can chain with .range / .add / .mul just like sine().",
    entries: [
      {
        name: 'audio.bass',
        signature: 'audio.bass()',
        description: 'Low-band energy (≤200Hz) — kick, bass. 0..1, chainable.',
        example: 'washA.red(audio.bass().range(0, 1))',
      },
      {
        name: 'audio.mid',
        signature: 'audio.mid()',
        description: 'Mid-band energy (200Hz–2kHz) — vocals, snare body.',
      },
      {
        name: 'audio.treble',
        signature: 'audio.treble()',
        description: 'High-band energy (2–12kHz) — hats, cymbals, sibilance.',
      },
      {
        name: 'audio.rms',
        signature: 'audio.rms()',
        description: 'Overall loudness across all bands, 0..1.',
        example: 'bar.pixels.white(audio.rms().mul(0.6))',
      },
      {
        name: 'audio.peak',
        signature: 'audio.peak()',
        description:
          'Transient detector — jumps to 1 when the RMS spikes above its recent average (beats, hits) and decays back to 0 over ~150ms. Great for strobes and flashes.',
        example: 'spot.dim(audio.peak())',
      },
      {
        name: 'audio.bpm / position / duration / isPlaying / track',
        signature: 'audio.bpm · audio.position · audio.duration',
        description:
          "Live scalar getters. bpm is null until a track is loaded and analysis succeeds; it's also auto-applied to setBPM() on load.",
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
          "Create a fixture instance. Returns an object with one setter per named channel (e.g. .red(), .dim(), .pan()). Built-in ids: generic-dimmer, generic-rgb, generic-rgbw, generic-rgba, generic-dim-rgb, generic-dim-rgbw, moving-head-basic, moving-head-spot, strobe-basic. Universe defaults to 0 (matches Art-Net / TouchDesigner's first-universe convention). Pass 1, 2, 3, … to address additional universes — the bridge sends one Art-Net packet per written universe per tick. Note: sACN requires universe ≥ 1.",
        example:
          "const wash = fixture(1, 'generic-rgbw')\nwash.red(sine().slow(4))\nwash.white(0.3)\n\n// Second universe\nconst par2 = fixture(1, 'generic-rgbw', 1)",
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
          'RGBW pixel strip. Each pixel = 4 channels (R,G,B,W) laid out contiguously, so 8 pixels = 32 channels. Same shape as rgbStrip but every setter takes an extra white arg and adds a .white(v) setter. The white channel is a separate LED emitter that adds to the colour mix, great for warm highlights or true whites.',
        example:
          "const bar = rgbwStrip(1, 8, 1)    // 8 px, universe 1\nbar.fill(sine().slow(4), 0, cosine().slow(4), 0.2)\nbar.pixel(0, 1, 0, 0, 0)           // pixel 0 red\nbar.white(0.1)                      // low white on every pixel",
      },
      {
        name: 'strip channel (in defineFixture)',
        signature: "{ offset, name, type: 'strip', pixelCount: N, pixelLayout?: 'rgb' | 'rgbw' }",
        description:
          "Inside defineFixture(), a channel with type 'strip' claims pixelCount × channelsPerPixel DMX channels starting at its offset and exposes a nested StripInstance on the fixture. pixelLayout defaults to 'rgb' (3 chs/pixel); set it to 'rgbw' for a 4-ch-per-pixel RGBW strip — you then get .fill(r,g,b,w), .pixel(i,r,g,b,w), and a .white(v) setter. Scalar channels before/after work normally, so you can mix a dimmer, strobe, and pixel segment in one fixture.",
        example:
          "defineFixture('my-bar', {\n  name: 'Custom Bar', manufacturer: 'Generic', type: 'generic',\n  channelCount: 12,\n  channels: [\n    { offset: 0,  name: 'dim',    type: 'intensity' },\n    { offset: 1,  name: 'strobe', type: 'strobe' },\n    { offset: 2,  name: 'pixels', type: 'strip', pixelCount: 3 }, // ch 3-11\n    { offset: 11, name: 'mode',   type: 'control' },\n  ],\n})\nconst bar = fixture(100, 'my-bar')\nbar.dim(0.8)\nbar.pixels.fill(sine(), 0, 0)\nbar.pixels.pixel(1, 1, 0, 0)",
      },
    ],
  },

  {
    category: 'viz',
    title: 'pattern viz',
    blurb:
      "Opt-in per-pattern editor decorations. Chain .flash() / .glow() / .wave() onto any pattern (sine/square/cosine/saw/rand, fallback waveforms, or audio.bass/mid/treble/rms/peak) and the editor line lights up with live feedback. Methods return the pattern unchanged so you can still pass it into a fixture setter. Never on by default.",
    entries: [
      {
        name: '.flash',
        signature: "sine().fast(2).flash()",
        description:
          "Pulses the editor line's background on each rising edge above mid-scale. Best for beats, strobes, square waves — things with a clear on/off shape. Refractory ~140ms so a sustained-high value doesn't strobe the UI.",
        example: 'spot.dim(square().fast(1).flash())',
      },
      {
        name: '.glow',
        signature: 'sine().slow(4).glow()',
        description:
          "Subtle left-to-right background rail whose intensity tracks the pattern's current value 0..1. Best for slow/smooth patterns (sines, envelopes) — you can literally watch the value breathe.",
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
      'Opt-in per-fixture editor visualizations. Chain .viz(kind) onto a fixture or strip and a live widget appears at the end of that line, driven from the current DMX buffer at ~60fps. Never on by default — nothing happens until you add a .viz() call.',
    entries: [
      {
        name: '.viz',
        signature: ".viz(...kinds)",
        description:
          "Attach one or more inline widgets to this fixture. Kinds: 'color' (mixed-output swatch), 'wave' (scrolling intensity scope), 'meter' (vertical bar), 'strip' (row of mini pixels — for rgbStrip). Multiple kinds stack side-by-side. Returns the fixture so you can keep chaining.",
        example:
          "const washA = fixture(1, 'generic-rgbw').viz('color')\nconst spot  = fixture(9, 'generic-dimmer').viz('wave', 'meter')\nconst strip = rgbStrip(12, 10).viz('strip')",
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
          "Mini scrolling oscilloscope. Plots the fixture's dominant intensity over the last ~1 second. Best for dimmer and strobe fixtures where you care about the shape of the modulation — square, sine, saw, etc.",
      },
      {
        name: 'meter',
        signature: ".viz('meter')",
        description:
          'Vertical bar showing current intensity 0-100%. Compact — good when you want many fixtures visualised on adjacent lines without eating horizontal space.',
      },
      {
        name: 'strip',
        signature: ".viz('strip')",
        description:
          'Row of tiny pixel dots, one per rgbStrip pixel, each showing its current RGB colour. Only makes sense for rgbStrip — on a regular fixture it renders an empty row.',
      },
    ],
  },

  {
    category: 'fixtures',
    title: 'fixture channels',
    blurb:
      'Every fixture instance has methods matching its channel names. A few common ones:',
    entries: [
      {
        name: 'generic-rgb',
        signature: '.red(v)  .green(v)  .blue(v)',
        description: '3-channel RGB PAR, no dedicated dimmer.',
      },
      {
        name: 'generic-rgbw',
        signature: '.red(v)  .green(v)  .blue(v)  .white(v)',
        description: '4-channel RGBW. Dim by modulating colour intensities directly.',
      },
      {
        name: 'generic-dim-rgbw',
        signature: '.dim(v)  .red(v)  .green(v)  .blue(v)  .white(v)',
        description: '5-channel with master dimmer.',
      },
      {
        name: 'generic-dimmer',
        signature: '.dim(v)',
        description: 'Single-channel dimmer — think tungsten par, smoke machine, UV flood.',
      },
      {
        name: 'moving-head-basic',
        signature: '.pan  .tilt  .dim  .strobe  .red  .green  .blue  .white',
        description: '8-channel moving head. Pan/tilt are 0-1 over full travel.',
      },
      {
        name: 'moving-head-spot',
        signature: '.pan  .panFine  .tilt  .tiltFine  .speed  .dim  .strobe  .zoom  .gobo  .color  .prism  .focus',
        description: '12-channel moving head spot.',
      },
      {
        name: 'strobe-basic',
        signature: '.dim(v)  .strobe(v)',
        description: '2-channel strobe. .dim is overall brightness, .strobe is flash rate.',
      },
    ],
  },

  {
    category: 'reference',
    title: 'low-level dmx',
    blurb:
      "Direct channel addressing — use these when a fixture abstraction isn't worth it.",
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
    title: 'patterns',
    blurb:
      'Strudel waveforms and pattern builders. Output is normalised to 0-1 unless stated.',
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
        description: 'Same as sine but 90° ahead — useful for phase-offset pairs.',
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
      {
        name: 'mini',
        signature: "mini('1 0 0.5 0')",
        description:
          "Mini-notation pattern. Space-separated steps cycle once per beat. Supports subdivisions with [a b], rests with ~, multiples with *n. Also aliased as m().",
        example: "spot.dim(m('1 0 0.8 0'))",
      },
      {
        name: 'sequence',
        signature: 'sequence(a, b, c, ...)',
        description: 'Programmatic version of mini. Each argument is one step.',
        example: 'ch(1, sequence(0, 1, 0.5, 1))',
      },
      {
        name: 'cat',
        signature: 'cat(pat1, pat2, ...)',
        description: 'Concatenate patterns — each takes one full cycle before the next.',
      },
      {
        name: 'stack',
        signature: 'stack(pat1, pat2, ...)',
        description:
          "Play multiple patterns simultaneously (value of last one wins at a channel, but useful as part of larger chains).",
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
        description: 'Stop — zero all channels and pause the scheduler.',
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
      // A tab-link entry is a compact clickable row — just the name, a
      // signature-style subtitle, and an arrow. Full descriptions live
      // in the target tab's own sections.
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
 * Filter the rendered docs against a search query and/or an active tab.
 *
 * - `query` filters entries by their search bag; empty string means "no
 *   query" and all entries pass the query filter.
 * - `activeCategory` gates which sections are shown by category. Pass
 *   `null` to disable the tab filter (used during active search, so the
 *   user sees matches from every tab at once).
 *
 * A section is visible when it has at least one entry surviving both
 * filters. The `no matches` message toggles when nothing at all matches.
 */
function applyFilter(
  body: HTMLElement,
  query: string,
  emptyMsg: HTMLElement,
  activeCategory: DocCategory | null,
): void {
  const q = query.trim().toLowerCase();
  const sections = body.querySelectorAll<HTMLElement>('.doc-section');

  let totalVisible = 0;

  sections.forEach((section) => {
    const sectionCategory = (section.getAttribute('data-category') ?? 'reference') as DocCategory;
    const passesTab = activeCategory === null || sectionCategory === activeCategory;
    if (!passesTab) {
      section.classList.add('hidden');
      return;
    }

    const sectionText = section.getAttribute('data-search') ?? '';
    const sectionMatches = q.length > 0 && sectionText.includes(q);
    // Entries in a section can be either .doc-entry (full) or .doc-link
    // (compressed welcome-style row). Both carry data-search.
    const entries = section.querySelectorAll<HTMLElement>('.doc-entry, .doc-link');

    let visibleInSection = 0;
    entries.forEach((entry) => {
      if (q === '') {
        entry.classList.remove('hidden');
        visibleInSection++;
        return;
      }
      const bag = entry.getAttribute('data-search') ?? '';
      const hit = bag.includes(q) || sectionMatches;
      entry.classList.toggle('hidden', !hit);
      if (hit) visibleInSection++;
    });

    // A welcome section with a blurb but no entries still should show when
    // its category is active — it's informational. Only hide if there ARE
    // entries and none are visible.
    const wasEmpty = entries.length === 0;
    section.classList.toggle('hidden', !wasEmpty && visibleInSection === 0);
    totalVisible += visibleInSection + (wasEmpty ? 1 : 0);
  });

  emptyMsg.classList.toggle('hidden', totalVisible > 0);
}

/** Render the docs content into the panel body. */
export function renderDocs(body: HTMLElement): void {
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
    <div class="doc-empty hidden" id="doc-empty">no matches — try a different word</div>`;

  body.innerHTML = searchBar + DOCS.map(renderSection).join('');

  const input = body.querySelector<HTMLInputElement>('#doc-search-input')!;
  const clearBtn = body.querySelector<HTMLButtonElement>('#doc-search-clear')!;
  const emptyMsg = body.querySelector<HTMLElement>('#doc-empty')!;
  const tabsBar = body.querySelector<HTMLElement>('#doc-tabs')!;

  let activeTab: DocCategory = DEFAULT_TAB;

  const update = (): void => {
    // Search overrides the tab filter — when the user types something, show
    // every matching result regardless of which tab they're on.
    const query = input.value.trim();
    applyFilter(body, query, emptyMsg, query.length > 0 ? null : activeTab);
    clearBtn.classList.toggle('visible', query.length > 0);
    // Hide the tab bar while searching so the results aren't being filtered
    // by two criteria at once.
    tabsBar.classList.toggle('hidden', query.length > 0);
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

  // Welcome-page link rows — delegate on the body since they're rebuilt
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
