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
    label: 'screen',
    signature: 'screen(pixels?, { columns?, label? })',
    description:
      'A light made of screen: no DMX address, drawn on the page. One colour wash by default; give it pixels and columns for a grid. Answers every strip method.',
    example: "const room = screen()\nroom.fill(sine().slow(4), 0, cosine().slow(4))",
    context: 'command',
    kind: 'function',
  },
  {
    label: 'tri',
    signature: 'tri() => Pattern',
    description: 'Triangle signal: up then down in equal time, with no dwell at either end.',
    example: 'spot.dim(tri().slow(8))',
    context: 'command',
    kind: 'function',
  },
  {
    label: 'isaw',
    signature: 'isaw() => Pattern',
    description: 'Ramp down, 1 to 0 across the cycle. The mirror of saw().',
    example: 'strip.blue(isaw().slow(2))',
    context: 'command',
    kind: 'function',
  },
  {
    label: 'perlin',
    signature: 'perlin() => Pattern',
    description:
      'Smooth noise: wanders rather than jumping, so it reads as flicker or drift where rand() reads as sparkle.',
    example: 'wash.red(perlin().slow(4).range(0.3, 1))',
    context: 'command',
    kind: 'function',
  },
  {
    label: 'irand',
    signature: 'irand(n) => Pattern',
    description: 'A whole number below n, at random. Usually wants dividing down into a level.',
    example: 'wash.red(irand(4).div(4).segment(8))',
    context: 'command',
    kind: 'function',
  },
  {
    label: 'run',
    signature: 'run(n) => Pattern',
    description: 'Counts 0 to n-1 across the cycle.',
    example: 'wash.red(run(4).div(4))',
    context: 'command',
    kind: 'function',
  },
  {
    label: 'pure',
    signature: 'pure(value) => Pattern',
    description: 'A constant, as a pattern. Mostly useful inside cat() or a conditional.',
    example: 'wash.red(pure(0.5))',
    context: 'command',
    kind: 'function',
  },
  {
    label: 'silence',
    signature: 'silence',
    description: 'Nothing at all. Written without parentheses.',
    example: "wash.red(cat(mini('1 - 1 -'), silence))",
    context: 'command',
    kind: 'variable',
  },
  {
    label: 'choose',
    signature: 'choose(...values) => Pattern',
    description: 'Pick one of the values at random, continuously. Add .segment(n) to settle it into steps.',
    example: 'wash.red(choose(0.2, 0.6, 1).segment(4))',
    context: 'command',
    kind: 'function',
  },
  {
    label: 'wchoose',
    signature: 'wchoose([value, weight], …) => Pattern',
    description: 'choose with the odds written down: each pair is a value and how likely it is.',
    example: 'wash.red(wchoose([0.2, 3], [1, 1]).segment(4))',
    context: 'command',
    kind: 'function',
  },
  {
    label: 'chooseCycles',
    signature: 'chooseCycles(...values) => Pattern',
    description: 'Pick one of the values per bar rather than continuously.',
    example: 'wash.red(chooseCycles(0.2, 1))',
    context: 'command',
    kind: 'function',
  },
  {
    label: 'randcat',
    signature: 'randcat(...patterns) => Pattern',
    description: 'Play one of the patterns for the cycle, chosen at random. wrandcat weights the choice.',
    example: "wash.red(randcat(mini('1 - 1 -'), mini('1 1 1 1')))",
    context: 'command',
    kind: 'function',
  },
  {
    label: 'wrandcat',
    signature: 'wrandcat([pattern, weight], …) => Pattern',
    description: 'randcat with the odds written down.',
    example: "wash.red(wrandcat([mini('1 - 1 -'), 3], [mini('1 1 1 1'), 1]))",
    context: 'command',
    kind: 'function',
  },
  {
    label: 'brand',
    signature: 'brand',
    description: 'Random zero or one rather than a level between. brandBy(p) biases it.',
    example: 'wash.red(sine().mul(brand.segment(8)))',
    context: 'command',
    kind: 'variable',
  },
  {
    label: 'brandBy',
    signature: 'brandBy(probability) => Pattern',
    description: 'Random zero or one, with p as the chance of a one.',
    example: 'wash.red(sine().mul(brandBy(0.7).segment(8)))',
    context: 'command',
    kind: 'function',
  },
  {
    label: 'shuffle',
    signature: '.shuffle(n) => Pattern',
    description:
      'Cut the cycle into n parts and reorder them, using each exactly once. The material is preserved; only the order changes.',
    example: "bar.pixels.red(mini('1 0.6 0.3 0').shuffle(4))",
    context: 'pattern-method',
    kind: 'method',
  },
  {
    label: 'scramble',
    signature: '.scramble(n) => Pattern',
    description: 'Like shuffle, but parts are picked freely, so they can repeat or vanish.',
    example: "bar.pixels.red(mini('1 0.6 0.3 0').scramble(4))",
    context: 'pattern-method',
    kind: 'method',
  },
  {
    label: 'slowcat',
    signature: 'slowcat(...patterns) => Pattern',
    description: 'Each pattern gets a whole cycle in turn. What plain cat() does.',
    example: "wash.red(slowcat(mini('1 - - -'), mini('1 1 1 1')))",
    context: 'command',
    kind: 'function',
  },
  {
    label: 'fastcat',
    signature: 'fastcat(...patterns) => Pattern',
    description: 'Squeeze every pattern into one cycle, sharing it equally.',
    example: "wash.red(fastcat(mini('1 - - -'), mini('1 1 1 1')))",
    context: 'command',
    kind: 'function',
  },
  {
    label: 'timeCat',
    signature: 'timeCat([weight, pattern], …) => Pattern',
    description: 'cat with the shares written down, for sections that are not equal length. stepcat is the same.',
    example: "wash.red(timeCat([3, mini('1 - - -')], [1, mini('1 1 1 1')]))",
    context: 'command',
    kind: 'function',
  },
  {
    label: 'stepcat',
    signature: 'stepcat([weight, pattern], …) => Pattern',
    description: 'The same as timeCat: cat with explicit shares.',
    example: "wash.red(stepcat([2, mini('1 - - -')], [1, mini('1 1')]))",
    context: 'command',
    kind: 'function',
  },
  {
    label: 'polymeter',
    signature: 'polymeter(...patterns) => Pattern',
    description:
      "Step every pattern at the same rate, so different lengths drift against each other. The function form of {a, b}. pm is the short name.",
    example: "wash.red(polymeter(mini('1 0'), mini('0.4 0.4 0.4')))",
    context: 'command',
    kind: 'function',
  },
  {
    label: 'polyrhythm',
    signature: 'polyrhythm(...patterns) => Pattern',
    description:
      "Squeeze every pattern into the same cycle, so they stay aligned but subdivide differently. The function form of [a, b]. pr is the short name.",
    example: "wash.red(polyrhythm(mini('1 0'), mini('0.4 0.4 0.4')))",
    context: 'command',
    kind: 'function',
  },
  {
    label: 'pm',
    signature: 'pm(...patterns) => Pattern',
    description: "Short name for polymeter.",
    example: "wash.red(pm(mini('1 0'), mini('0.4 0.4 0.4')))",
    context: 'command',
    kind: 'function',
  },
  {
    label: 'pr',
    signature: 'pr(...patterns) => Pattern',
    description: "Short name for polyrhythm.",
    example: "wash.red(pr(mini('1 0'), mini('0.4 0.4 0.4')))",
    context: 'command',
    kind: 'function',
  },
  {
    label: 'monoStrip',
    signature: 'monoStrip(startCh, cells, universe?, opts?)',
    description:
      'A strip of single-channel cells: a segmented white strobe strip, or a bar of plain dimmers. Same geometry as the colour strips, one level per cell.',
    example: 'const seg = monoStrip(147, 8)',
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
    label: 'roll',
    signature: '.roll() => Pattern',
    description:
      'Inline viz: the bar as blocks, one per event, with a playhead. Shows structure, including holds the wire cannot express. No effect on DMX output.',
    example: "wash.red(mini('1 - - -  - - 1 -').roll())",
    context: 'pattern-method',
    kind: 'method',
  },
  {
    label: 'punchcard',
    signature: '.punchcard() => Pattern',
    description:
      'Inline viz: the bar as a fixed sixteen-cell grid, for reading rhythm at a glance. No effect on DMX output.',
    example: "strb.strobe(mini('1(5,16)').punchcard())",
    context: 'pattern-method',
    kind: 'method',
  },
  {
    label: 'spiral',
    signature: '.spiral() => Pattern',
    description:
      'Inline viz: the bar wound round with the playhead sweeping it. Compact, and shows drift against the bar. No effect on DMX output.',
    example: "wash.blue(mini('1(3,8)').spiral())",
    context: 'pattern-method',
    kind: 'method',
  },
  {
    label: 'spectrum',
    signature: '.spectrum() => Pattern',
    description:
      'Inline viz: which rates the recent values move at, for checking a strobe. Analyses the channel, not audio. No effect on DMX output.',
    example: "strb.strobe(mini('1*16').spectrum())",
    context: 'pattern-method',
    kind: 'method',
  },
  {
    label: 'slider',
    signature: 'slider(name, min?, max?, opts?)',
    description:
      'A value with a draggable handle at this point in the source. Moving it changes the light immediately, with nothing re-evaluated, and the position survives a re-run.',
    example: "const level = slider('level')\nwash.dim(level)",
    context: 'command',
    kind: 'function',
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
    label: 'pixelXY',
    signature: '.pixelXY(x, y, …)',
    description:
      'Set one pixel by grid position, x left to right and y top to bottom. Needs columns declared on the strip.',
    example: 'wash.pixels.pixelXY(3, 1, 1, 0, 0)',
    context: 'fixture-method',
    kind: 'method',
  },
  {
    label: 'eachXY',
    signature: '.eachXY((x, y, w, h) => value)',
    description:
      'Run a callback per pixel with its grid position and the grid size. Return a level or [r, g, b]. each() for when the shape matters.',
    example: 'wash.pixels.eachXY((x, y, w) => sine().early(x / w).slow(4))',
    context: 'fixture-method',
    kind: 'method',
  },
  {
    label: 'row',
    signature: '.row(y, …)',
    description: 'Set every pixel in one row (0-indexed from the top).',
    example: 'wash.pixels.row(0, 1, 1, 1)',
    context: 'fixture-method',
    kind: 'method',
  },
  {
    label: 'column',
    signature: '.column(x, …)',
    description: 'Set every pixel in one column (0-indexed from the left).',
    example: 'wash.pixels.column(11, 0, 0, 1)',
    context: 'fixture-method',
    kind: 'method',
  },
  {
    label: 'width',
    signature: '.width => number',
    description: 'Pixels across one row. A plain strip is width = pixelCount.',
    example: 'wash.pixels.width',
    context: 'property',
    kind: 'property',
  },
  {
    label: 'height',
    signature: '.height => number',
    description: 'Rows in the grid. A plain strip is height = 1.',
    example: 'wash.pixels.height',
    context: 'property',
    kind: 'property',
  },
  {
    label: 'slots',
    signature: '.slots(channelName) => string[]',
    description:
      "The named positions on a wheel channel. Pass a name to the setter to pick one: head.color('red').",
    example: "console.log(head.slots('color'))",
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
    label: 'chase',
    signature: ".chase(colour, { cycles?, width?, waves?, reverse?, down? })",
    description:
      'A band of colour travelling along the strip, endlessly. No callback: this is the plain way to get a moving light. '
      + 'Colour by name or [r, g, b]. cycles = how long a lap takes (4), width = how much is lit at once (0.5), '
      + 'waves = crests at a time (1). A single-channel strip takes options alone.',
    example: "wash.pixels.chase('red')\nwash.pixels.chase('blue', { cycles: 2, width: 0.2 })",
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
