/**
 * Shared help index for gobo API.
 *
 * One entry per identifier or method name. The autocomplete extension
 * derives its Completion[] from this list, and the hover-help extension
 * looks entries up by the word under the cursor, so both surfaces stay
 * in step without duplication.
 *
 * `context` narrows where the entry is offered:
 *   - 'command': bare identifiers (sine, fixture, artnet, …)
 *   - 'pattern-method': chains on a pattern (.slow, .range, …)
 *   - 'fixture-method': calls on a fixture / strip (.red, .pixel, …)
 *   - 'property':       non-callable members (.pixelCount, etc.)
 *
 * The hover lookup is context-blind (it matches on label only). Context
 * is used only by autocomplete, to narrow suggestions after a dot.
 */

export type HelpContext =
  | 'command'
  | 'pattern-method'
  | 'fixture-method'
  | 'property';

export interface HelpEntry {
  /** Identifier as it appears in code. */
  label: string;
  /** Function signature or property type. */
  signature: string;
  /** One-line description. */
  description: string;
  /** Real, copy-pasteable example. */
  example: string;
  context: HelpContext;
  /** Completion type for the CodeMirror autocomplete UI. */
  kind: 'function' | 'method' | 'variable' | 'property';
}

export const HELP_ENTRIES: HelpEntry[] = [
  // ─── Fixtures ──────────────────────────────────────────────────────────────
  {
    label: 'fixture',
    signature: 'fixture(startCh, id, universe = 0)',
    description: 'Create a fixture instance at a DMX start channel.',
    example: "const wash = fixture(1, 'rgbw').viz('color')",
    context: 'command',
    kind: 'function',
  },
  {
    label: 'rgbStrip',
    signature: 'rgbStrip(startCh, pixelCount, universe = 0)',
    description: 'RGB pixel strip, 3 channels per pixel.',
    example: "const strip = rgbStrip(7, 16).viz('strip')",
    context: 'command',
    kind: 'function',
  },
  {
    label: 'rgbwStrip',
    signature: 'rgbwStrip(startCh, pixelCount, universe = 0)',
    description: 'RGBW pixel strip, 4 channels per pixel.',
    example: "const strip = rgbwStrip(7, 8).viz('strip')",
    context: 'command',
    kind: 'function',
  },
  {
    label: 'defineFixture',
    signature: 'defineFixture(id, def)',
    description: 'Register a custom fixture with a specific channel layout.',
    example: `defineFixture('my-bar', {
  name: 'My Bar', manufacturer: 'Generic', type: 'generic',
  channelCount: 4,
  channels: [
    { offset: 0, name: 'dim',   type: 'intensity' },
    { offset: 1, name: 'red',   type: 'color'     },
    { offset: 2, name: 'green', type: 'color'     },
    { offset: 3, name: 'blue',  type: 'color'     },
  ],
})`,
    context: 'command',
    kind: 'function',
  },
  {
    label: 'listFixtures',
    signature: 'listFixtures() => string[]',
    description: 'List every registered fixture id (built-in + custom + library).',
    example: 'console.log(listFixtures())',
    context: 'command',
    kind: 'function',
  },

  // ─── Output ────────────────────────────────────────────────────────────────
  {
    label: 'artnet',
    signature: "artnet(host = '127.0.0.1', port = 6454)",
    description: 'Send Art-Net DMX packets via the bridge.',
    example: "artnet('2.0.0.100')",
    context: 'command',
    kind: 'function',
  },
  {
    label: 'osc',
    signature: "osc(host = '127.0.0.1', port = 9000)",
    description: 'Send OSC messages via the bridge (e.g. into TouchDesigner).',
    example: "osc('127.0.0.1', 9000)",
    context: 'command',
    kind: 'function',
  },
  {
    label: 'sacn',
    signature: 'sacn(universe = 1, priority = 100)',
    description: 'Multicast sACN / E1.31 packets.',
    example: 'sacn(1, 100)',
    context: 'command',
    kind: 'function',
  },
  {
    label: 'mock',
    signature: 'mock()',
    description: 'Log-only output, no network. Useful for headless dev.',
    example: 'mock()',
    context: 'command',
    kind: 'function',
  },

  // ─── Clock ─────────────────────────────────────────────────────────────────
  {
    label: 'setBPM',
    signature: 'setBPM(bpm)',
    description: 'Set the scheduler tempo. Range 1..400.',
    example: 'setBPM(120)',
    context: 'command',
    kind: 'function',
  },

  // ─── Patterns ──────────────────────────────────────────────────────────────
  {
    label: 'sine',
    signature: 'sine() => Pattern',
    description: 'Sine waveform 0..1. One full cycle per beat by default.',
    example: 'wash.red(sine().slow(4).range(0.2, 1))',
    context: 'command',
    kind: 'function',
  },
  {
    label: 'cosine',
    signature: 'cosine() => Pattern',
    description: 'Cosine waveform 0..1. Same as sine, phase-shifted by ¼ cycle.',
    example: 'wash.blue(cosine().slow(4))',
    context: 'command',
    kind: 'function',
  },
  {
    label: 'square',
    signature: 'square() => Pattern',
    description: '50% duty square wave: 1 for half the cycle, then 0.',
    example: 'wash.dim(square().slow(2))',
    context: 'command',
    kind: 'function',
  },
  {
    label: 'saw',
    signature: 'saw() => Pattern',
    description: 'Sawtooth ramp 0→1. Useful for sweeps and phase indexing.',
    example: 'wash.red(saw().slow(8))',
    context: 'command',
    kind: 'function',
  },
  {
    label: 'rand',
    signature: 'rand() => Pattern',
    description: 'Uniform random 0..1, new value every cycle.',
    example: 'spot.red(rand().range(-6, 1))',
    context: 'command',
    kind: 'function',
  },

  // ─── Sequencing (mini-notation) ────────────────────────────────────────────
  {
    label: 'mini',
    signature: "mini(pattern: string) => Pattern",
    description:
      "Step sequencer. Tokens split one cycle equally. `-` is a rest, `[a b]` compresses, `*N` repeats, `<a b>` alternates per cycle.",
    example: "wash.white(mini('1 - 1 -').flash())",
    context: 'command',
    kind: 'function',
  },
  {
    label: 'm',
    signature: "m(pattern: string) => Pattern",
    description: 'Alias for mini().',
    example: "wash.green(m('1*16').range(-2, 0.6))",
    context: 'command',
    kind: 'function',
  },
  {
    label: 'sequence',
    signature: 'sequence(...steps) => Pattern',
    description: 'Positional-args form of mini(). Each arg is one step.',
    example: 'wash.red(sequence(1, 0, sine(), 0))',
    context: 'command',
    kind: 'function',
  },
  {
    label: 'cat',
    signature: 'cat(...patterns) => Pattern',
    description: 'Concatenate patterns. Each takes one full cycle in turn.',
    example: 'wash.dim(cat(sine(), saw(), square()).slow(3))',
    context: 'command',
    kind: 'function',
  },
  {
    label: 'stack',
    signature: 'stack(...patterns) => Pattern',
    description: 'Run patterns in parallel on one channel. The brightest value wins, as on a desk.',
    example: 'wash.red(stack(mini("1 - - -"), sine().mul(0.3)))',
    context: 'command',
    kind: 'function',
  },

  // ─── Low-level DMX ─────────────────────────────────────────────────────────
  {
    label: 'ch',
    signature: 'ch(channel, value?)',
    description: 'Set a universe-1 channel directly. Values 0..1 (normalised) or 1..255 raw. Omit the value for full.',
    example: 'ch(1, sine().slow(2))',
    context: 'command',
    kind: 'function',
  },
  {
    label: 'uni',
    signature: 'uni(universe, channel, value?)',
    description: 'Set a channel on any universe. Omit the value for full.',
    example: 'uni(2, 5, mini("1 0 1 0"))',
    context: 'command',
    kind: 'function',
  },
  {
    label: 'dim',
    signature: 'dim(channel, value?)',
    description: 'Alias for ch(). Same semantics, clearer intent.',
    example: 'dim(1, 0.8)',
    context: 'command',
    kind: 'function',
  },
  {
    label: 'rgb',
    signature: 'rgb(startCh, r, g, b)',
    description: 'Set three contiguous channels at once. All three or none; rgb(startCh) is full white.',
    example: 'rgb(1, sine(), 0, cosine().slow(3))',
    context: 'command',
    kind: 'function',
  },
  {
    label: 'group',
    signature: 'group(...fixtures) => Group',
    description:
      'Treat several fixtures, strips and pixels as one. Same setters as a fixture, plus .each() to spread a pattern across the whole group in order.',
    example: `const rig = group(washA, washB, bar.pixels)
rig.each(p => sine().early(p).slow(4))`,
    context: 'command',
    kind: 'function',
  },

  // ─── Pattern extension ─────────────────────────────────────────────────────
  {
    label: 'register',
    signature: 'register(name, fn)',
    description:
      'Extend Pattern with a custom chain method. fn takes a pattern and returns a transformed one; the name then works on every pattern.',
    example: `const punch = register('punch', (p) => p.range(-4, 1).flash())
spot.white(mini('1 - - -').punch())`,
    context: 'command',
    kind: 'function',
  },

  // ─── Pattern methods ───────────────────────────────────────────────────────
  {
    label: 'slow',
    signature: '.slow(n) => Pattern',
    description: 'Stretch the pattern so one cycle takes n beats.',
    example: 'sine().slow(4)',
    context: 'pattern-method',
    kind: 'method',
  },
  {
    label: 'fast',
    signature: '.fast(n) => Pattern',
    description: 'Compress the pattern by n. Inverse of slow().',
    example: 'mini("1 0").fast(2)',
    context: 'pattern-method',
    kind: 'method',
  },
  {
    label: 'early',
    signature: '.early(n) => Pattern',
    description: 'Shift the pattern earlier by n cycles (phase shift forward).',
    example: 'cosine().early(1/3).slow(12)',
    context: 'pattern-method',
    kind: 'method',
  },
  {
    label: 'late',
    signature: '.late(n) => Pattern',
    description: 'Shift the pattern later by n cycles.',
    example: 'sine().late(0.5)',
    context: 'pattern-method',
    kind: 'method',
  },
  {
    label: 'range',
    signature: '.range(lo, hi) => Pattern',
    description: 'Remap 0..1 output to [lo, hi]. Values outside 0..1 (e.g. lo=-8) clip, which narrows the peaks.',
    example: 'cosine().range(-8, 1)',
    context: 'pattern-method',
    kind: 'method',
  },
  {
    label: 'add',
    signature: '.add(n | pattern) => Pattern',
    description: 'Add a number or pattern to the output.',
    example: 'sine().slow(4).add(0.2)',
    context: 'pattern-method',
    kind: 'method',
  },
  {
    label: 'mul',
    signature: '.mul(n | pattern) => Pattern',
    description: 'Multiply the output by a number or pattern. Combine an envelope with a colour cycle.',
    example: 'cosine().range(-8, 1).mul(sine().slow(12))',
    context: 'pattern-method',
    kind: 'method',
  },
  {
    label: 'rangex',
    signature: '.rangex(lo, hi) => Pattern',
    description:
      'Range on an exponential curve, so the motion is visible at the dim end where a linear fade is not. Keep lo above 0.',
    example: 'spot.dim(sine().slow(8).rangex(0.01, 1))',
    context: 'pattern-method',
    kind: 'method',
  },
  {
    label: 'struct',
    signature: '.struct(pattern) => Pattern',
    description: 'Take values from this pattern and rhythm from another.',
    example: "wash.red(sine().slow(4).struct(mini('1 - 1 - 1 - - -')))",
    context: 'pattern-method',
    kind: 'method',
  },
  {
    label: 'mask',
    signature: '.mask(pattern) => Pattern',
    description:
      'Gate a pattern: audible where the mask is on, silent where it is off. The pattern keeps running underneath, so it returns mid-motion.',
    example: "wash.red(sine().slow(2).mask(mini('1 1 - -')))",
    context: 'pattern-method',
    kind: 'method',
  },
  {
    label: 'segment',
    signature: '.segment(n) => Pattern',
    description: 'Sample a continuous waveform n times per cycle, turning a smooth fade into n steps.',
    example: 'spot.dim(sine().segment(8))',
    context: 'pattern-method',
    kind: 'method',
  },
  {
    label: 'every',
    signature: '.every(n, fn) => Pattern',
    description: 'Apply a transform on every nth cycle. firstOf / lastOf are the same idea at named ends.',
    example: "wash.red(mini('1 - 1 -').every(4, p => p.fast(2)))",
    context: 'pattern-method',
    kind: 'method',
  },
  {
    label: 'iter',
    signature: '.iter(n) => Pattern',
    description: 'Rotate the pattern one step left each cycle, resetting after n. One bar becomes a phrase.',
    example: "bar.pixels.red(mini('1 0.6 0.3 0').iter(4))",
    context: 'pattern-method',
    kind: 'method',
  },
  {
    label: 'chunk',
    signature: '.chunk(n, fn) => Pattern',
    description: 'Split the cycle into n parts and transform a different part each cycle, walking across.',
    example: "wash.red(mini('1 1 1 1').chunk(4, p => p.mul(0.2)))",
    context: 'pattern-method',
    kind: 'method',
  },
  {
    label: 'rev',
    signature: '.rev() => Pattern',
    description: 'Play the cycle backwards. palindrome() alternates forwards and back each cycle.',
    example: "bar.pixels.red(mini('1 0.6 0.3 0').palindrome())",
    context: 'pattern-method',
    kind: 'method',
  },
  {
    label: 'palindrome',
    signature: '.palindrome() => Pattern',
    description: 'Alternate forwards and backwards each cycle. Turns any chase into a bounce.',
    example: "bar.pixels.red(mini('1 0.6 0.3 0').palindrome())",
    context: 'pattern-method',
    kind: 'method',
  },
  {
    label: 'ply',
    signature: '.ply(n | pattern) => Pattern',
    description: 'Repeat each step n times inside its own slot. Takes a pattern, so subdivision can change per bar.',
    example: "strb.strobe(mini('1 0.5').ply(mini('<1 2 4 8>')))",
    context: 'pattern-method',
    kind: 'method',
  },
  {
    label: 'linger',
    signature: '.linger(n) => Pattern',
    description: 'Play only the first n of the cycle and repeat it for the rest. A stutter, or a hold.',
    example: "wash.red(mini('1 0.6 0.3 0').linger(0.25))",
    context: 'pattern-method',
    kind: 'method',
  },
  {
    label: 'superimpose',
    signature: '.superimpose(fn) => Pattern',
    description: 'Layer a transformed copy on top of the original. Merged brightest-wins, so nothing is lost.',
    example: "wash.red(mini('1 - - -').superimpose(p => p.late(0.125).mul(0.4)))",
    context: 'pattern-method',
    kind: 'method',
  },
  {
    label: 'echoWith',
    signature: '.echoWith(times, time, fn) => Pattern',
    description:
      'n copies, each shifted a further `time` later and passed through fn with its index. A decaying tail in one line.',
    example: "wash.red(mini('1 - - -').echoWith(4, 0.125, (p, i) => p.mul(1 / (i + 1))))",
    context: 'pattern-method',
    kind: 'method',
  },
  {
    label: 'euclid',
    signature: '.euclid(k, n) => Pattern',
    description: "Spread k hits evenly across n steps. euclidRot(k, n, r) rotates it. Same as mini('1(k,n,r)').",
    example: "strb.strobe(mini('1').euclid(3, 8))",
    context: 'pattern-method',
    kind: 'method',
  },
  {
    label: 'euclidRot',
    signature: '.euclidRot(k, n, rotation) => Pattern',
    description: 'A euclid spread rotated r steps, so two fixtures interlock instead of firing together.',
    example: "washB.red(mini('1').euclidRot(3, 8, 2))",
    context: 'pattern-method',
    kind: 'method',
  },
  {
    label: 'degradeBy',
    signature: '.degradeBy(n) => Pattern',
    description: "Drop a fraction n of events at random. A '?' after a mini token does the same at 50%.",
    example: "strb.strobe(mini('1*16').degradeBy(0.3))",
    context: 'pattern-method',
    kind: 'method',
  },
  {
    label: 'sometimesBy',
    signature: '.sometimesBy(n, fn) => Pattern',
    description: 'Transform a fraction n of events rather than dropping them. someCyclesBy works per bar.',
    example: "wash.red(mini('1 1 1 1').sometimesBy(0.3, p => p.mul(0.2)))",
    context: 'pattern-method',
    kind: 'method',
  },
  {
    label: 'swingBy',
    signature: '.swingBy(amount, subdivision) => Pattern',
    description: 'Push every other subdivision late, so a straight grid stops marching.',
    example: "strb.strobe(mini('1*8').swingBy(1/3, 2))",
    context: 'pattern-method',
    kind: 'method',
  },
  {
    label: 'flash',
    signature: '.flash() => Pattern',
    description: 'Inline viz: editor line flashes on rising edges. No effect on DMX output.',
    example: "wash.white(mini('1 - 1 -').flash())",
    context: 'pattern-method',
    kind: 'method',
  },
  {
    label: 'glow',
    signature: '.glow() => Pattern',
    description: 'Inline viz: editor line background tracks the pattern value. No effect on DMX output.',
    example: 'wash.blue(sine().slow(16).range(0.1, 0.9).glow())',
    context: 'pattern-method',
    kind: 'method',
  },
  {
    label: 'wave',
    signature: '.wave() => Pattern',
    description: 'Inline viz: sparkline at line-end. No effect on DMX output.',
    example: 'wash.red(saw().slow(4).wave())',
    context: 'pattern-method',
    kind: 'method',
  },

  // ─── Fixture / strip methods ───────────────────────────────────────────────
  {
    label: 'color',
    signature: '.color(r, g, b [, w])',
    description:
      'Set R / G / B (and optionally W) in one call. Channels absent on the fixture are skipped silently, so the same line works on rgb / rgbw / dim-rgbw / moving heads.',
    example: `wash.color(1, 0, 0)         // red on any colour fixture
wash.color(1, 0, 0, 0.3)    // RGBW: red + a touch of white
wash.color(sine(), 0, 0)    // animated red`,
    context: 'fixture-method',
    kind: 'method',
  },
  {
    label: 'off',
    signature: '.off()',
    description:
      'Zero every light-emitting channel on the fixture (dim, RGB(W), amber, embedded strips). Leaves state channels like pan / tilt / gobo alone.',
    example: 'wash.off()',
    context: 'fixture-method',
    kind: 'method',
  },
  {
    label: 'full',
    signature: '.full()',
    description:
      'Drive every light-emitting channel to 1. Brings dim + RGB(W) up together on fixtures that have both.',
    example: 'wash.full()',
    context: 'fixture-method',
    kind: 'method',
  },
  {
    label: 'red',
    signature: '.red(value | pattern)',
    description: 'Set the red channel. Accepts a constant 0..1 or a pattern.',
    example: 'wash.red(sine().slow(4))',
    context: 'fixture-method',
    kind: 'method',
  },
  {
    label: 'green',
    signature: '.green(value | pattern)',
    description: 'Set the green channel.',
    example: 'wash.green(mini("1 1 1 1").range(0, 0.35))',
    context: 'fixture-method',
    kind: 'method',
  },
  {
    label: 'blue',
    signature: '.blue(value | pattern)',
    description: 'Set the blue channel.',
    example: 'wash.blue(cosine().slow(8))',
    context: 'fixture-method',
    kind: 'method',
  },
  {
    label: 'white',
    signature: '.white(value | pattern)',
    description: 'Set the white channel (RGBW fixtures only).',
    example: "wash.white(mini('1 - - -').flash())",
    context: 'fixture-method',
    kind: 'method',
  },
  {
    label: 'strobe',
    signature: '.strobe(value | pattern)',
    description: 'Strobe rate channel. 0 = open, 1 = fastest.',
    example: 'wash.strobe(0)',
    context: 'fixture-method',
    kind: 'method',
  },
  {
    label: 'pan',
    signature: '.pan(value | pattern)',
    description: 'Pan channel (moving heads). 0 = left, 1 = right.',
    example: 'head.pan(saw().slow(8))',
    context: 'fixture-method',
    kind: 'method',
  },
  {
    label: 'tilt',
    signature: '.tilt(value | pattern)',
    description: 'Tilt channel (moving heads). 0 = front, 1 = back.',
    example: 'head.tilt(sine().slow(4).range(0.2, 0.8))',
    context: 'fixture-method',
    kind: 'method',
  },
  {
    label: 'pixel',
    signature: '.pixel(i, brightness) | .pixel(i, r, g, b [, w])',
    description:
      'Set one pixel on a strip. One value = monochrome (R = G = B; W = 0 on RGBW), the usual form in chase loops. Three or four values = full colour control.',
    example: `for (let i = 0; i < strip.pixelCount; i++) {
  const fade = cosine().early(i/strip.pixelCount).slow(2).range(-7, 1)
  strip.pixel(i, fade)
}`,
    context: 'fixture-method',
    kind: 'method',
  },
  {
    label: 'fill',
    signature: '.fill(r, g, b [, w])',
    description: 'Set every pixel on a strip to the same colour.',
    example: 'strip.fill(0, 0, 0, 0)',
    context: 'fixture-method',
    kind: 'method',
  },
  {
    label: 'pixelGrid',
    signature: '.pixelGrid(rows) → { repeat, hold, mirror }',
    description:
      'Set pixels from an array-of-rows. Each inner array is one pixel: [r, g, b] for RGB strips, [r, g, b, w] for RGBW. Missing channels default to 0. Chain .repeat() / .hold() / .mirror() to fill the remaining pixels.',
    example: `strip.pixelGrid([
  [1, 0, 0, 0],   // red
  [0, 0, 1, 0],   // blue
]).repeat()`,
    context: 'fixture-method',
    kind: 'method',
  },
  {
    label: 'each',
    signature: '.each((phase, i, count) => value | [r,g,b] | [r,g,b,w])',
    description:
      'Run a callback per pixel. Return one value for a monochrome chase (applied to R=G=B) or an array for full colour control. phase = i / count.',
    example: `strip.each(p => cosine().early(p).slow(2).range(-7, 1))
strip.each(p => [sine().early(p), 0, cosine().early(p)])`,
    context: 'fixture-method',
    kind: 'method',
  },
  {
    label: 'rainbowChase',
    signature: '.rainbowChase({ speed?, narrow?, rainbowSpeed?, packets? })',
    description: 'Built-in rainbow chase. Bigger `narrow` = tighter packet; `packets` = simultaneous chases.',
    example: 'strip.rainbowChase({ speed: 2, narrow: 8 })',
    context: 'fixture-method',
    kind: 'method',
  },
  {
    label: 'viz',
    signature: ".viz('color' | 'wave' | 'meter' | 'strip')",
    description: 'Opt into an inline editor widget at line-end for this fixture/strip.',
    example: "fixture(1, 'rgbw').viz('color')",
    context: 'fixture-method',
    kind: 'method',
  },
  {
    label: 'set',
    signature: '.set(channelName, value)',
    description: 'Set a channel by its declared name (the same name used in defineFixture).',
    example: "head.set('zoom', 0.5)",
    context: 'fixture-method',
    kind: 'method',
  },
  {
    label: 'channels',
    signature: '.channels() => string[]',
    description: 'List channel names exposed by this fixture.',
    example: 'console.log(wash.channels())',
    context: 'fixture-method',
    kind: 'method',
  },
  {
    label: 'pixelCount',
    signature: '.pixelCount: number',
    description: 'Number of pixels on a strip. For nested strips, use `.pixels.pixelCount`.',
    example: 'for (let i = 0; i < strip.pixelCount; i++) { … }',
    context: 'property',
    kind: 'property',
  },
  {
    label: 'channelCount',
    signature: '.channelCount: number',
    description: 'Total DMX channels this strip occupies.',
    example: 'console.log(strip.channelCount)',
    context: 'property',
    kind: 'property',
  },
  {
    label: 'startChannel',
    signature: '.startChannel: number',
    description: '1-based DMX start channel of this fixture/strip.',
    example: 'console.log(wash.startChannel)',
    context: 'property',
    kind: 'property',
  },
  {
    label: 'universe',
    signature: '.universe: number',
    description: 'Universe number this fixture lives on.',
    example: 'console.log(wash.universe)',
    context: 'property',
    kind: 'property',
  },

];

/** Fast lookup by label. Hover-help uses this; autocomplete builds its
 *  Completion[] from HELP_ENTRIES directly. */
export const HELP_INDEX: Map<string, HelpEntry> = new Map(
  HELP_ENTRIES.map((e) => [e.label, e]),
);
