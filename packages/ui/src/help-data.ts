/**
 * Shared help index for lumen API.
 *
 * One entry per identifier or method name. The autocomplete extension
 * derives its Completion[] from this list, and the hover-help extension
 * looks entries up by the word under the cursor — keeping both surfaces
 * in lockstep without duplication.
 *
 * `context` narrows where the entry is offered:
 *   - 'command': bare identifiers (sine, fixture, artnet, …)
 *   - 'pattern-method': chains on a pattern (.slow, .range, …)
 *   - 'fixture-method': calls on a fixture / strip (.red, .pixel, …)
 *   - 'property':       non-callable members (.pixelCount, etc.)
 *
 * The hover lookup is context-blind (it matches on label only) — context
 * is only used by autocomplete to narrow suggestions after a dot.
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
    example: "const wash = fixture(1, 'generic-rgbw').viz('color')",
    context: 'command',
    kind: 'function',
  },
  {
    label: 'rgbStrip',
    signature: 'rgbStrip(startCh, pixelCount, universe = 0)',
    description: 'RGB pixel strip — 3 channels per pixel.',
    example: "const strip = rgbStrip(7, 16).viz('strip')",
    context: 'command',
    kind: 'function',
  },
  {
    label: 'rgbwStrip',
    signature: 'rgbwStrip(startCh, pixelCount, universe = 0)',
    description: 'RGBW pixel strip — 4 channels per pixel.',
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
    description: 'Log-only output — no network. Useful for headless dev.',
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
    description: 'Sine waveform 0..1 — one full cycle per beat by default.',
    example: 'wash.red(sine().slow(4).range(0.2, 1))',
    context: 'command',
    kind: 'function',
  },
  {
    label: 'cosine',
    signature: 'cosine() => Pattern',
    description: 'Cosine waveform 0..1 — same as sine but phase-shifted by ¼ cycle.',
    example: 'wash.blue(cosine().slow(4))',
    context: 'command',
    kind: 'function',
  },
  {
    label: 'square',
    signature: 'square() => Pattern',
    description: '50% duty square wave — 1 for half the cycle, then 0.',
    example: 'wash.dim(square().slow(2))',
    context: 'command',
    kind: 'function',
  },
  {
    label: 'saw',
    signature: 'saw() => Pattern',
    description: 'Sawtooth ramp 0→1 — useful for sweeps and phase indexing.',
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
    description: 'Concatenate patterns — each takes one full cycle in turn.',
    example: 'wash.dim(cat(sine(), saw(), square()).slow(3))',
    context: 'command',
    kind: 'function',
  },
  {
    label: 'stack',
    signature: 'stack(...patterns) => Pattern',
    description: 'Run patterns in parallel. Usually you want separate mini() per channel instead.',
    example: 'wash.red(stack(sine(), mini("1 0 1 0")))',
    context: 'command',
    kind: 'function',
  },

  // ─── Low-level DMX ─────────────────────────────────────────────────────────
  {
    label: 'ch',
    signature: 'ch(channel, value)',
    description: 'Set a universe-1 channel directly. Values 0..1 (normalised) or use Math.round for raw 0..255.',
    example: 'ch(1, sine().slow(2))',
    context: 'command',
    kind: 'function',
  },
  {
    label: 'uni',
    signature: 'uni(universe, channel, value)',
    description: 'Set a channel on any universe.',
    example: 'uni(2, 5, mini("1 0 1 0"))',
    context: 'command',
    kind: 'function',
  },
  {
    label: 'dim',
    signature: 'dim(channel, value)',
    description: 'Alias for ch() with intent — same semantics.',
    example: 'dim(1, 0.8)',
    context: 'command',
    kind: 'function',
  },
  {
    label: 'rgb',
    signature: 'rgb(startCh, r, g, b)',
    description: 'Set three contiguous channels at once.',
    example: 'rgb(1, sine(), 0, cosine().slow(3))',
    context: 'command',
    kind: 'function',
  },

  // ─── Pattern extension ─────────────────────────────────────────────────────
  {
    label: 'register',
    signature: 'register(name, fn)',
    description:
      'Extend Pattern with a custom chain method. fn takes a pattern, returns a transformed pattern. The name becomes callable on every pattern.',
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
    description: 'Remap 0..1 output to [lo, hi]. Values outside 0..1 (e.g. lo=-8) clip — useful for narrow peaks.',
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
    signature: '.pixel(i, r, g, b [, w])',
    description: 'Set one pixel on a strip. Pass `w` only for RGBW strips.',
    example: 'strip.pixel(0, 1, 0, 0)',
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
    signature: '.pixelGrid(values) → { repeat, hold, mirror }',
    description:
      'Set pixels from a flat values array (3 per pixel for RGB, 4 for RGBW). Chain .repeat() / .hold() / .mirror() to fill the remaining pixels; default leaves them at 0.',
    example: `strip.pixelGrid([
  1, 0, 0, 0,   // red
  0, 0, 1, 0,   // blue
]).repeat()`,
    context: 'fixture-method',
    kind: 'method',
  },
  {
    label: 'each',
    signature: '.each((phase, i, count) => value | [r,g,b] | [r,g,b,w])',
    description:
      'Run a callback per pixel. Return one value for a monochrome chase (applied to R=G=B) or an array for full colour control. phase = i / count, the common chase parameter.',
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
    example: "fixture(1, 'generic-rgbw').viz('color')",
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
