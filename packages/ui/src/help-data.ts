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
 * Six labels appear twice on purpose, because the name really is two things:
 * `red` is a colour value and a channel setter, and so are green, blue, white,
 * strobe and flash. Both surfaces use `context` to tell them apart — findHelp()
 * at the bottom of this file picks by whether a dot precedes the word, and
 * autocomplete narrows its suggestions the same way. Any other repeated label
 * is a mistake: a plain Map keyed by label keeps whichever comes last, so a
 * second entry silently replaces the first.
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
  // ─── Colours ───────────────────────────────────────────────────────────────
  // One entry per predefined colour. They are values, not strings: a colour
  // reaches every call that takes one, and a quoted name is refused.
  {
    label: 'red',
    signature: 'red: Color',
    description: 'The colour red, as an r,g,b mix of 1, 0, 0. Written bare, or quoted as mini-notation where a pattern of colours is wanted.',
    example: 'wash.pixels.chase(red)',
    context: 'command',
    kind: 'variable',
  },
  {
    label: 'orange',
    signature: 'orange: Color',
    description: 'The colour orange, as an r,g,b mix of 1, 0.35, 0. Written bare, or quoted as mini-notation where a pattern of colours is wanted.',
    example: 'wash.pixels.chase(orange)',
    context: 'command',
    kind: 'variable',
  },
  {
    label: 'amber',
    signature: 'amber: Color',
    description: 'The colour amber, as an r,g,b mix of 1, 0.55, 0.1. Written bare, or quoted as mini-notation where a pattern of colours is wanted.',
    example: 'wash.pixels.chase(amber)',
    context: 'command',
    kind: 'variable',
  },
  {
    label: 'yellow',
    signature: 'yellow: Color',
    description: 'The colour yellow, as an r,g,b mix of 1, 1, 0. Written bare, or quoted as mini-notation where a pattern of colours is wanted.',
    example: 'wash.pixels.chase(yellow)',
    context: 'command',
    kind: 'variable',
  },
  {
    label: 'green',
    signature: 'green: Color',
    description: 'The colour green, as an r,g,b mix of 0, 1, 0. Written bare, or quoted as mini-notation where a pattern of colours is wanted.',
    example: 'wash.pixels.chase(green)',
    context: 'command',
    kind: 'variable',
  },
  {
    label: 'cyan',
    signature: 'cyan: Color',
    description: 'The colour cyan, as an r,g,b mix of 0, 1, 1. Written bare, or quoted as mini-notation where a pattern of colours is wanted.',
    example: 'wash.pixels.chase(cyan)',
    context: 'command',
    kind: 'variable',
  },
  {
    label: 'blue',
    signature: 'blue: Color',
    description: 'The colour blue, as an r,g,b mix of 0, 0, 1. Written bare, or quoted as mini-notation where a pattern of colours is wanted.',
    example: 'wash.pixels.chase(blue)',
    context: 'command',
    kind: 'variable',
  },
  {
    label: 'purple',
    signature: 'purple: Color',
    description: 'The colour purple, as an r,g,b mix of 0.5, 0, 1. Written bare, or quoted as mini-notation where a pattern of colours is wanted.',
    example: 'wash.pixels.chase(purple)',
    context: 'command',
    kind: 'variable',
  },
  {
    label: 'magenta',
    signature: 'magenta: Color',
    description: 'The colour magenta, as an r,g,b mix of 1, 0, 1. Written bare, or quoted as mini-notation where a pattern of colours is wanted.',
    example: 'wash.pixels.chase(magenta)',
    context: 'command',
    kind: 'variable',
  },
  {
    label: 'pink',
    signature: 'pink: Color',
    description: 'The colour pink, as an r,g,b mix of 1, 0.35, 0.6. Written bare, or quoted as mini-notation where a pattern of colours is wanted.',
    example: 'wash.pixels.chase(pink)',
    context: 'command',
    kind: 'variable',
  },
  {
    label: 'white',
    signature: 'white: Color',
    description: 'The colour white, as an r,g,b mix of 1, 1, 1. Written bare, or quoted as mini-notation where a pattern of colours is wanted. Leaves a dedicated white emitter alone; use .full() to light every emitter.',
    example: 'wash.pixels.chase(white)',
    context: 'command',
    kind: 'variable',
  },

  // ─── Named moves ───────────────────────────────────────────────────────────
  {
    label: 'pulse',
    signature: 'pulse(cycles = 4)',
    description: 'The slow swell. Breathing, on any channel.',
    example: 'wash.dim(pulse(4))',
    context: 'command',
    kind: 'function',
  },
  {
    label: 'strobe',
    signature: 'strobe(per = 8)',
    description: 'Hard on and off, `per` times a cycle. A software strobe for a fixture without one.',
    example: 'wash.dim(strobe(16))',
    context: 'command',
    kind: 'function',
  },
  {
    label: 'flash',
    signature: 'flash(per = 1, tail = 0.3)',
    description: 'Sharp hit, quick decay: the move you make on a kick. `tail` is how much of each beat it stays lit.',
    example: 'wash.dim(flash())',
    context: 'command',
    kind: 'function',
  },
  {
    label: 'flicker',
    signature: 'flicker(amount = 0.3)',
    description: 'Wanders around full. Candles, fire, a lamp on its way out.',
    example: 'wash.dim(flicker(0.4))',
    context: 'command',
    kind: 'function',
  },
  {
    label: 'adsr',
    signature: 'adsr(attack, decay, sustain, release)',
    description: 'A cue-style fade shape to multiply onto any effect, once per cycle: fade up (attack), drop to a hold level (decay, sustain), fade out (release). Times are fractions of a cycle.',
    example: 'wash.dim(flicker().mul(adsr(0.1, 0.1, 0.7, 0.2)))',
    context: 'command',
    kind: 'function',
  },

  // ─── From strudel, spelled as strudel spells them ──────────────────────────
  {
    label: 'fadeIn',
    signature: '.fadeIn(beats)',
    description:
      'Each step comes up over this many beats instead of snapping on: the fade in a desk gives every step of a chase. Strudel calls it attack, in seconds, and .attack() does the same here.',
    example: "rig.dim(mini('1 - 1 -').fadeIn(0.5))",
    context: 'pattern-method',
    kind: 'method',
  },
  {
    label: 'fadeOut',
    signature: '.fadeOut(beats)',
    description:
      'Each step keeps glowing for this many beats after it ends, going out as the next one comes up: the tail that makes a chase look like one. Strudel calls it release, in seconds, and .release() does the same here.',
    example: "rig.each(mini('1 - - -').fadeOut(2))",
    context: 'pattern-method',
    kind: 'method',
  },
  {
    label: 'settle',
    signature: '.settle(beats, level = 0)',
    description:
      'Each step hits full and falls to `level` over this many beats, then holds there while the step lasts. With no level every step is a flash. Strudel spells it decay and sustain; .decay() and .sustain() do the same here, and .adsr("a:d:s:r") sets all four in seconds.',
    example: "strb.dim(mini('1 1 1 1').settle(0.25))        // a flash per beat\nwash.dim(mini('1 - 1 -').settle(0.5, 0.3))   // hit, then hold at 30%",
    context: 'pattern-method',
    kind: 'method',
  },
  {
    label: 'palette',
    signature: '.palette(colours)',
    description:
      "Numbers pick colours: 0 the first in the palette, 1 the next, wrapping past the end, and a number between two blends them. Strudel's .scale() turns numbers into notes; this turns them into the colours a designer picks from. The result goes to .color() or .fill(). A list, [red, amber, white], or a string of names, 'red amber white'.",
    example: "wash.color(mini('<0 1 2>').palette(warm))          // one colour a bar\nwash.color(saw.slow(8).mul(3).palette(warm))      // a slow sweep through them",
    context: 'pattern-method',
    kind: 'method',
  },
  {
    label: 'across',
    signature: '.across(position)',
    description:
      "Where across a group each step lands: 0 the first light, 1 the last, and a position between two lights shared between them. A pattern of positions places every step on its own, so .across(saw) walks along the rig and .across(rand) scatters. Strudel calls this .pan(), its stereo position with the lights as the speakers, and a pasted .pan() does the same; on a moving head .pan() is the head's own pan channel.",
    example: "rig.dim(mini('1*8').across(saw))               // one light walks the rig\nrig.dim(mini('1*16').across(rand).fadeOut(1))  // sparkle with tails",
    context: 'pattern-method',
    kind: 'method',
  },
  {
    label: 'stut',
    signature: '.stut(n, feedback, time)',
    description: 'Repeat n times, each quieter than the last: an echo that decays. The trail effect, already built in.',
    example: "wash.dim(flash().stut(4, 0.6, 0.125))",
    context: 'pattern-method',
    kind: 'method',
  },
  {
    label: 'linger',
    signature: '.linger(fraction)',
    description: 'Repeat the first part of a cycle for the whole cycle. A hold, or a stutter.',
    example: "wash.dim(mini('1 0 0 0').linger(0.25))",
    context: 'pattern-method',
    kind: 'method',
  },
  {
    label: 'when',
    signature: '.when(pattern, change)',
    description: 'Apply a change only while a pattern of 1s and 0s says 1. With <…> in the pattern that is one bar in several.',
    example: "wash.dim(sine.when(mini('<1 0 0 0>'), fast(4)))   // every fourth bar, four times as fast",
    context: 'pattern-method',
    kind: 'method',
  },
  {
    label: 'hush',
    signature: 'hush()',
    description: 'Everything dark, from inside the scene. Drops every channel the scene has driven.',
    example: "hush()",
    context: 'command',
    kind: 'function',
  },
  {
    label: 'setcps',
    signature: 'setcps(cyclesPerSecond)',
    description: 'Tempo as strudel writes it, so pasted code runs. One cycle is one bar of four beats.',
    example: "setcps(0.5)",
    context: 'command',
    kind: 'function',
  },
  {
    label: 'setcpm',
    signature: 'setcpm(cyclesPerMinute)',
    description: 'Tempo in cycles per minute. setcpm(30) is 120 bpm.',
    example: "setcpm(30)",
    context: 'command',
    kind: 'function',
  },

  {
    label: 'pick',
    signature: 'pick(name, { start })',
    description:
      'A colour with a wheel behind it. Shows a swatch beside the call; clicking opens the colour picker, '
      + 'and turning it moves the rig live without a re-run. Reads as a colour anywhere a colour is taken.',
    example: "const warm = pick('warm', { start: amber })\nwash.color(warm)",
    context: 'command',
    kind: 'function',
  },

  {
    label: 'mix',
    signature: 'mix(a, b, t)',
    description:
      'Blend two colours, t of the way from the first to the second. Use it when the even spread across a '
      + 'palette is not the curve you want. Both endpoints come back as themselves, so mix(red, blue, 0) is red.',
    example: 'wash.color(mix(red, amber, 0.3))\nwash.color(mix(red, blue, sine.slow(4)))   // crossfade, four bars',
    context: 'command',
    kind: 'function',
  },

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
    signature: 'listFixtures()',
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
  {
    label: 'usb',
    signature: 'usb(universe?)',
    description:
      'Drive a USB DMX box (Enttec DMX USB Pro type) from the browser, nothing installed. Chrome or Edge. Pick the box once in the outputs panel first.',
    example: 'usb()',
    context: 'command',
    kind: 'function',
  },
  {
    label: 'td',
    signature: "td(host = 'localhost', port = 9980)",
    description:
      'Send every frame straight to a TouchDesigner WebSocket DAT, nothing installed. TouchDesigner puts the Art-Net on the network.',
    example: 'td()',
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
    signature: 'sine',
    description: 'Sine waveform 0..1. One full cycle per pattern cycle, which is one bar of four beats, so .fast(4) gives one per beat. Strudel writes signals without the brackets, sine.slow(4), and that works too, for every signal.',
    example: 'wash.red(sine.slow(4).range(0.2, 1))',
    context: 'command',
    kind: 'function',
  },
  {
    label: 'cosine',
    signature: 'cosine',
    description: 'Cosine waveform 0..1. Same as sine, phase-shifted by ¼ cycle.',
    example: 'wash.blue(cosine.slow(4))',
    context: 'command',
    kind: 'function',
  },
  {
    label: 'square',
    signature: 'square',
    description: '50% duty square wave: 1 for half the cycle, then 0.',
    example: 'wash.dim(square.slow(2))',
    context: 'command',
    kind: 'function',
  },
  {
    label: 'saw',
    signature: 'saw',
    description: 'Sawtooth ramp 0→1. Useful for sweeps and phase indexing.',
    example: 'wash.red(saw.slow(8))',
    context: 'command',
    kind: 'function',
  },
  {
    label: 'rand',
    signature: 'rand',
    description: 'Uniform random 0..1, new value every cycle.',
    example: 'spot.red(rand.range(-6, 1))',
    context: 'command',
    kind: 'function',
  },

  // ─── Sequencing (mini-notation) ────────────────────────────────────────────
  {
    label: 'mini',
    signature: "mini(pattern: string)",
    description:
      "Step sequencer. Tokens split one cycle equally. `-` is a rest, `[a b]` compresses, `*N` repeats, `<a b>` alternates per cycle.",
    example: "wash.white(mini('1 - 1 -').flash())",
    context: 'command',
    kind: 'function',
  },
  {
    label: 'm',
    signature: "m(pattern: string)",
    description: 'Alias for mini().',
    example: "wash.green(m('1*16').range(-2, 0.6))",
    context: 'command',
    kind: 'function',
  },
  {
    label: 'sequence',
    signature: 'sequence(step, step, …)',
    description: 'Positional-args form of mini(). Each arg is one step.',
    example: 'wash.red(sequence(1, 0, sine, 0))',
    context: 'command',
    kind: 'function',
  },
  {
    label: 'cat',
    signature: 'cat(pattern, pattern, …)',
    description: 'Concatenate patterns. Each takes one full cycle in turn.',
    example: 'wash.dim(cat(sine, saw, square).slow(3))',
    context: 'command',
    kind: 'function',
  },
  {
    label: 'stack',
    signature: 'stack(pattern, pattern, …)',
    description: 'Run patterns in parallel on one channel. The brightest value wins, as on a desk.',
    example: 'wash.red(stack(mini("1 - - -"), sine.mul(0.3)))',
    context: 'command',
    kind: 'function',
  },

  // ─── Low-level DMX ─────────────────────────────────────────────────────────
  {
    label: 'ch',
    signature: 'ch(channel, value?)',
    description: 'Set a universe-1 channel directly. Values 0..1 (normalised) or 1..255 raw. Omit the value for full.',
    example: 'ch(1, sine.slow(2))',
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
    example: 'rgb(1, sine, 0, cosine.slow(3))',
    context: 'command',
    kind: 'function',
  },
  {
    label: 'screen',
    signature: 'screen(pixels?, { columns?, label? })',
    description:
      'A light made of screen: no DMX address, drawn on the page. One colour wash by default; give it pixels and columns for a grid. Answers every strip method.',
    example: "const room = screen()\nroom.fill(sine.slow(4), 0, cosine.slow(4))",
    context: 'command',
    kind: 'function',
  },
  {
    label: 'tri',
    signature: 'tri',
    description: 'Triangle signal: up then down in equal time, with no dwell at either end.',
    example: 'spot.dim(tri.slow(8))',
    context: 'command',
    kind: 'function',
  },
  {
    label: 'isaw',
    signature: 'isaw',
    description: 'Ramp down, 1 to 0 across the cycle. The mirror of saw.',
    example: 'strip.blue(isaw.slow(2))',
    context: 'command',
    kind: 'function',
  },
  {
    label: 'mouseX',
    signature: 'mouseX · mouseY',
    description:
      'Where the pointer is across the window, 0 at the left or top and 1 at the right or bottom, read live. Two of them make an XY pad for a moving head.',
    example: 'head.pan(mouseX)\nhead.tilt(mouseY)',
    context: 'command',
    kind: 'variable',
  },
  {
    label: 'mouseY',
    signature: 'mouseY',
    description: 'The pointer down the window, 0 at the top and 1 at the bottom. See mouseX.',
    example: 'head.tilt(mouseY)',
    context: 'command',
    kind: 'variable',
  },
  {
    label: 'seq',
    signature: 'seq(a, b, c, …)',
    description:
      "One cycle split evenly between the values, one after another: the same as sequence(), under the name strudel uses. seq(1, 0, 0.5, 0) is a four-step level pattern.",
    example: 'wash.dim(seq(1, 0, 0.5, 0))',
    context: 'command',
    kind: 'function',
  },
  {
    label: 'arrange',
    signature: 'arrange([cycles, pattern], …)',
    description:
      'Lay patterns end to end, each for so many cycles (bars): the running order of a song, written as code. It loops when it reaches the end.',
    example: "wash.dim(arrange([8, mini('1 - 1 -')], [8, sine.fast(2)]))",
    context: 'command',
    kind: 'function',
  },
  {
    label: 'xfade',
    signature: 'xfade(a, position, b)',
    description:
      'A crossfade between two patterns: position 0 is all a, 1 is all b, and anything between mixes them. Give it a slider for a crossfader in code.',
    example: "wash.dim(xfade(mini('1 - 1 -'), slider('xf'), sine))",
    context: 'command',
    kind: 'function',
  },
  {
    label: 'perlin',
    signature: 'perlin',
    description:
      'Smooth noise: wanders rather than jumping, so it reads as flicker or drift where rand reads as sparkle.',
    example: 'wash.red(perlin.slow(4).range(0.3, 1))',
    context: 'command',
    kind: 'function',
  },
  {
    label: 'irand',
    signature: 'irand(n)',
    description: 'A whole number below n, at random. Usually wants dividing down into a level.',
    example: 'wash.red(irand(4).div(4).segment(8))',
    context: 'command',
    kind: 'function',
  },
  {
    label: 'run',
    signature: 'run(n)',
    description: 'Counts 0 to n-1 across the cycle.',
    example: 'wash.red(run(4).div(4))',
    context: 'command',
    kind: 'function',
  },
  {
    label: 'pure',
    signature: 'pure(value)',
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
    signature: 'choose(value, value, …)',
    description: 'Pick one of the values at random, continuously. Add .segment(n) to settle it into steps.',
    example: 'wash.red(choose(0.2, 0.6, 1).segment(4))',
    context: 'command',
    kind: 'function',
  },
  {
    label: 'wchoose',
    signature: 'wchoose([value, weight], …)',
    description: 'choose with the odds written down: each pair is a value and how likely it is.',
    example: 'wash.red(wchoose([0.2, 3], [1, 1]).segment(4))',
    context: 'command',
    kind: 'function',
  },
  {
    label: 'chooseCycles',
    signature: 'chooseCycles(value, value, …)',
    description: 'Pick one of the values per bar rather than continuously.',
    example: 'wash.red(chooseCycles(0.2, 1))',
    context: 'command',
    kind: 'function',
  },
  {
    label: 'randcat',
    signature: 'randcat(pattern, pattern, …)',
    description: 'Play one of the patterns for the cycle, chosen at random. wrandcat weights the choice.',
    example: "wash.red(randcat(mini('1 - 1 -'), mini('1 1 1 1')))",
    context: 'command',
    kind: 'function',
  },
  {
    label: 'wrandcat',
    signature: 'wrandcat([pattern, weight], …)',
    description: 'randcat with the odds written down.',
    example: "wash.red(wrandcat([mini('1 - 1 -'), 3], [mini('1 1 1 1'), 1]))",
    context: 'command',
    kind: 'function',
  },
  {
    label: 'brand',
    signature: 'brand',
    description: 'Random zero or one rather than a level between. brandBy(p) biases it.',
    example: 'wash.red(sine.mul(brand.segment(8)))',
    context: 'command',
    kind: 'variable',
  },
  {
    label: 'brandBy',
    signature: 'brandBy(probability)',
    description: 'Random zero or one, with p as the chance of a one.',
    example: 'wash.red(sine.mul(brandBy(0.7).segment(8)))',
    context: 'command',
    kind: 'function',
  },
  {
    label: 'shuffle',
    signature: '.shuffle(n)',
    description:
      'Cut the cycle into n parts and reorder them, using each exactly once. The material is preserved; only the order changes.',
    example: "bar.pixels.red(mini('1 0.6 0.3 0').shuffle(4))",
    context: 'pattern-method',
    kind: 'method',
  },
  {
    label: 'scramble',
    signature: '.scramble(n)',
    description: 'Like shuffle, but parts are picked freely, so they can repeat or vanish.',
    example: "bar.pixels.red(mini('1 0.6 0.3 0').scramble(4))",
    context: 'pattern-method',
    kind: 'method',
  },
  {
    label: 'slowcat',
    signature: 'slowcat(pattern, pattern, …)',
    description: 'Each pattern gets a whole cycle in turn. What plain cat() does.',
    example: "wash.red(slowcat(mini('1 - - -'), mini('1 1 1 1')))",
    context: 'command',
    kind: 'function',
  },
  {
    label: 'fastcat',
    signature: 'fastcat(pattern, pattern, …)',
    description: 'Squeeze every pattern into one cycle, sharing it equally.',
    example: "wash.red(fastcat(mini('1 - - -'), mini('1 1 1 1')))",
    context: 'command',
    kind: 'function',
  },
  {
    label: 'timeCat',
    signature: 'timeCat([weight, pattern], …)',
    description: 'cat with the shares written down, for sections that are not equal length. stepcat is the same.',
    example: "wash.red(timeCat([3, mini('1 - - -')], [1, mini('1 1 1 1')]))",
    context: 'command',
    kind: 'function',
  },
  {
    label: 'stepcat',
    signature: 'stepcat([weight, pattern], …)',
    description: 'The same as timeCat: cat with explicit shares.',
    example: "wash.red(stepcat([2, mini('1 - - -')], [1, mini('1 1')]))",
    context: 'command',
    kind: 'function',
  },
  {
    label: 'polymeter',
    signature: 'polymeter(pattern, pattern, …)',
    description:
      "Step every pattern at the same rate, so different lengths drift against each other. The function form of {a, b}. pm is the short name.",
    example: "wash.red(polymeter(mini('1 0'), mini('0.4 0.4 0.4')))",
    context: 'command',
    kind: 'function',
  },
  {
    label: 'polyrhythm',
    signature: 'polyrhythm(pattern, pattern, …)',
    description:
      "Squeeze every pattern into the same cycle, so they stay aligned but subdivide differently. The function form of [a, b]. pr is the short name.",
    example: "wash.red(polyrhythm(mini('1 0'), mini('0.4 0.4 0.4')))",
    context: 'command',
    kind: 'function',
  },
  {
    label: 'pm',
    signature: 'pm(pattern, pattern, …)',
    description: "Short name for polymeter.",
    example: "wash.red(pm(mini('1 0'), mini('0.4 0.4 0.4')))",
    context: 'command',
    kind: 'function',
  },
  {
    label: 'pr',
    signature: 'pr(pattern, pattern, …)',
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
    signature: 'group(a, b, c, …)',
    description:
      'Treat several fixtures, strips and pixels as one. Same setters as a fixture, plus .each() to spread a pattern across the whole group in order.',
    example: `const rig = group(washA, washB, bar.pixels)
rig.each(sine.slow(4), 4)`,
    context: 'command',
    kind: 'function',
  },

  // ─── Pattern extension ─────────────────────────────────────────────────────
  {
    label: 'register',
    signature: 'register(name, change)',
    description:
      'Name a change of your own, so it chains like the built-in ones on every pattern. The change is written the way .every() takes one: range(-4, 1), fast(2), mul(0.5).',
    example: `register('punch', range(-4, 1))
spot.white(mini('1 - - -').punch())`,
    context: 'command',
    kind: 'function',
  },

  // ─── Pattern methods ───────────────────────────────────────────────────────
  {
    label: 'slow',
    signature: '.slow(n)',
    description: 'Stretch the pattern so one cycle takes n beats.',
    example: 'sine.slow(4)',
    context: 'pattern-method',
    kind: 'method',
  },
  {
    label: 'fast',
    signature: '.fast(n)',
    description: 'Compress the pattern by n. Inverse of slow().',
    example: 'mini("1 0").fast(2)',
    context: 'pattern-method',
    kind: 'method',
  },
  {
    label: 'early',
    signature: '.early(n)',
    description: 'Shift the pattern earlier by n cycles (phase shift forward).',
    example: 'cosine.early(1/3).slow(12)',
    context: 'pattern-method',
    kind: 'method',
  },
  {
    label: 'late',
    signature: '.late(n)',
    description: 'Shift the pattern later by n cycles.',
    example: 'sine.late(0.5)',
    context: 'pattern-method',
    kind: 'method',
  },
  {
    label: 'range',
    signature: '.range(lo, hi)',
    description: 'Remap 0..1 output to [lo, hi]. Values outside 0..1 (e.g. lo=-8) clip, which narrows the peaks.',
    example: 'cosine.range(-8, 1)',
    context: 'pattern-method',
    kind: 'method',
  },
  {
    label: 'add',
    signature: '.add(n | pattern)',
    description: 'Add a number or pattern to the output.',
    example: 'sine.slow(4).add(0.2)',
    context: 'pattern-method',
    kind: 'method',
  },
  {
    label: 'mul',
    signature: '.mul(n | pattern)',
    description: 'Multiply the output by a number or pattern. Combine an envelope with a colour cycle.',
    example: 'cosine.range(-8, 1).mul(sine.slow(12))',
    context: 'pattern-method',
    kind: 'method',
  },
  {
    label: 'rangex',
    signature: '.rangex(lo, hi)',
    description:
      'Range on an exponential curve, so the motion is visible at the dim end where a linear fade is not. Keep lo above 0.',
    example: 'spot.dim(sine.slow(8).rangex(0.01, 1))',
    context: 'pattern-method',
    kind: 'method',
  },
  {
    label: 'struct',
    signature: '.struct(pattern)',
    description: 'Take values from this pattern and rhythm from another.',
    example: "wash.red(sine.slow(4).struct(mini('1 - 1 - 1 - - -')))",
    context: 'pattern-method',
    kind: 'method',
  },
  {
    label: 'mask',
    signature: '.mask(pattern)',
    description:
      'Gate a pattern: it plays where the mask is on and is silent where it is off. The pattern keeps running underneath, so it returns mid-motion.',
    example: "wash.red(sine.slow(2).mask(mini('1 1 - -')))",
    context: 'pattern-method',
    kind: 'method',
  },
  {
    label: 'segment',
    signature: '.segment(n)',
    description: 'Sample a continuous waveform n times per cycle, turning a smooth fade into n steps.',
    example: 'spot.dim(sine.segment(8))',
    context: 'pattern-method',
    kind: 'method',
  },
  {
    label: 'every',
    signature: '.every(n, change)',
    description: 'Apply a transform on every nth cycle. firstOf / lastOf are the same idea at named ends.',
    example: "wash.red(mini('1 - 1 -').every(4, fast(2)))",
    context: 'pattern-method',
    kind: 'method',
  },
  {
    label: 'iter',
    signature: '.iter(n)',
    description: 'Rotate the pattern one step left each cycle, resetting after n. One bar becomes a phrase.',
    example: "bar.pixels.red(mini('1 0.6 0.3 0').iter(4))",
    context: 'pattern-method',
    kind: 'method',
  },
  {
    label: 'chunk',
    signature: '.chunk(n, change)',
    description: 'Split the cycle into n parts and transform a different part each cycle, walking across.',
    example: "wash.red(mini('1 1 1 1').chunk(4, mul(0.2)))",
    context: 'pattern-method',
    kind: 'method',
  },
  {
    label: 'rev',
    signature: '.rev()',
    description: 'Play the cycle backwards. palindrome() alternates forwards and back each cycle.',
    example: "bar.pixels.red(mini('1 0.6 0.3 0').palindrome())",
    context: 'pattern-method',
    kind: 'method',
  },
  {
    label: 'palindrome',
    signature: '.palindrome()',
    description: 'Alternate forwards and backwards each cycle. Turns any chase into a bounce.',
    example: "bar.pixels.red(mini('1 0.6 0.3 0').palindrome())",
    context: 'pattern-method',
    kind: 'method',
  },
  {
    label: 'ply',
    signature: '.ply(n | pattern)',
    description: 'Repeat each step n times inside its own slot. Takes a pattern, so subdivision can change per bar.',
    example: "strb.strobe(mini('1 0.5').ply(mini('<1 2 4 8>')))",
    context: 'pattern-method',
    kind: 'method',
  },
  {
    label: 'superimpose',
    signature: '.superimpose(change)',
    description: 'Layer a transformed copy on top of the original. Merged brightest-wins, so nothing is lost.',
    example: "wash.red(mini('1 - - -').superimpose(late(0.125)))",
    context: 'pattern-method',
    kind: 'method',
  },
  {
    label: 'echoWith',
    signature: '.echoWith(times, time, change)',
    description:
      'n copies, each shifted a further `time` later and passed through fn with its index. A decaying tail in one line.',
    example: "wash.red(mini('1 - - -').echoWith(4, 0.125, mul(0.5)))   // each repeat half the last",
    context: 'pattern-method',
    kind: 'method',
  },
  {
    label: 'euclid',
    signature: '.euclid(k, n)',
    description: "Spread k hits evenly across n steps. euclidRot(k, n, r) rotates it. Same as mini('1(k,n,r)').",
    example: "strb.strobe(mini('1').euclid(3, 8))",
    context: 'pattern-method',
    kind: 'method',
  },
  {
    label: 'euclidRot',
    signature: '.euclidRot(k, n, rotation)',
    description: 'A euclid spread rotated r steps, so two fixtures interlock instead of firing together.',
    example: "washB.red(mini('1').euclidRot(3, 8, 2))",
    context: 'pattern-method',
    kind: 'method',
  },
  {
    label: 'degradeBy',
    signature: '.degradeBy(n)',
    description: "Drop a fraction n of events at random. A '?' after a mini token does the same at 50%.",
    example: "strb.strobe(mini('1*16').degradeBy(0.3))",
    context: 'pattern-method',
    kind: 'method',
  },
  {
    label: 'sometimesBy',
    signature: '.sometimesBy(n, change)',
    description: 'Transform a fraction n of events rather than dropping them. someCyclesBy works per bar.',
    example: "wash.red(mini('1 1 1 1').sometimesBy(0.3, mul(0.2)))",
    context: 'pattern-method',
    kind: 'method',
  },
  {
    label: 'swingBy',
    signature: '.swingBy(amount, subdivision)',
    description: 'Push every other subdivision late, so a straight grid stops marching.',
    example: "strb.strobe(mini('1*8').swingBy(1/3, 2))",
    context: 'pattern-method',
    kind: 'method',
  },
  {
    label: 'flash',
    signature: '.flash()',
    description: 'Inline viz: editor line flashes on rising edges. No effect on DMX output.',
    example: "wash.white(mini('1 - 1 -').flash())",
    context: 'pattern-method',
    kind: 'method',
  },
  {
    label: 'roll',
    signature: '.roll()',
    description:
      'Inline viz: the bar as blocks, one per event, with a playhead. Shows structure, including holds the wire cannot express. No effect on DMX output.',
    example: "wash.red(mini('1 - - -  - - 1 -').roll())",
    context: 'pattern-method',
    kind: 'method',
  },
  {
    label: 'punchcard',
    signature: '.punchcard()',
    description:
      'Inline viz: the bar as a fixed sixteen-cell grid, for reading rhythm at a glance. No effect on DMX output.',
    example: "strb.strobe(mini('1(5,16)').punchcard())",
    context: 'pattern-method',
    kind: 'method',
  },
  {
    label: 'spiral',
    signature: '.spiral()',
    description:
      'Inline viz: the bar wound round with the playhead sweeping it. Compact, and shows drift against the bar. No effect on DMX output.',
    example: "wash.blue(mini('1(3,8)').spiral())",
    context: 'pattern-method',
    kind: 'method',
  },
  {
    label: 'spectrum',
    signature: '.spectrum()',
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
    label: 'pick',
    signature: '.pick(looks: Pattern[])',
    description:
      "Choose between whole patterns with a pattern of indices. The switch is written into the pattern, so the document still says everything about what the rig will do.",
    example: "const verse  = mini('1 0 1 0')\nconst chorus = mini('1 1 1 1')\nwash.red(mini('<0 1 1 2>').pick([verse, chorus]))",
    context: 'pattern-method',
    kind: 'method',
  },
  {
    label: 'pickmod',
    signature: '.pickmod(looks: Pattern[])',
    description:
      'Like .pick(), but the index wraps instead of clamping, so an index past the end comes back round to the start.',
    example: "wash.red(mini('<0 1 2 3 4>').pickmod([verse, chorus]))",
    context: 'pattern-method',
    kind: 'method',
  },
  {
    label: 'pickSqueeze',
    signature: '.pickSqueeze(looks: Pattern[])',
    description:
      'Like .pick(), but each chosen pattern is squeezed into the step that chose it, so a whole look plays inside one step.',
    example: "wash.red(mini('<0 1>').pickSqueeze([verse, chorus]))",
    context: 'pattern-method',
    kind: 'method',
  },
  {
    label: 'pickRestart',
    signature: '.pickRestart(looks: Pattern[])',
    description:
      'Like .pick(), but the chosen pattern starts from its beginning each time it is picked rather than carrying on where it was.',
    example: "wash.red(mini('<0 1>').pickRestart([verse, chorus]))",
    context: 'pattern-method',
    kind: 'method',
  },
  {
    label: 'squeeze',
    signature: '.squeeze(looks: Pattern[])',
    description:
      'Fit a whole chosen pattern into each step of this one. The same join .pickSqueeze() uses, under its shorter strudel name.',
    example: "wash.red(mini('<0 1>').squeeze([verse, chorus]))",
    context: 'pattern-method',
    kind: 'method',
  },
  {
    label: 'ctrl+shift+enter',
    signature: 'run only the edits in the selection',
    description:
      "Commits just the edits inside your selection, or the block around the cursor, on top of what is already running. The half-written look elsewhere in the file stays out of the rig — and stays out even when it is broken.",
    example: "// edit one look, put the cursor in it, ctrl+shift+enter",
    context: 'command',
    kind: 'variable',
  },
  {
    label: 'cue',
    signature: 'cue(verse, chorus, selector?)',
    description:
      'Offer a set of looks and run whichever one is selected. A look is a block with a name, verse: { … }, like a cue on a desk; _verse: mutes one. Pick one with its chip under the editor, alt+1..9, or a MIDI program change. Put a selector after the looks, a pattern of names or a control, and the scene chooses for itself, every frame, without being evaluated again.',
    example: "verse: {\n  wash.color(blue)\n}\nchorus: {\n  wash.color(red)\n}\ncue(verse, chorus)\n\n// or let the scene choose:\ncue(verse, chorus, mini('<verse chorus>'))",
    context: 'command',
    kind: 'function',
  },
  {
    label: 'midi',
    signature: 'midi(cc, opts?)',
    description:
      'A hardware fader as a value. Continuous controller cc, read live at query time, handed on as 0..1. opts: { channel = 1, start = 0 }. Turn on midi in under inputs in the outputs panel first.',
    example: "const level = midi(74)\nspot.dim(level)",
    context: 'command',
    kind: 'function',
  },
  {
    label: 'glow',
    signature: '.glow()',
    description: 'Inline viz: editor line background tracks the pattern value. No effect on DMX output.',
    example: 'wash.blue(sine.slow(16).range(0.1, 0.9).glow())',
    context: 'pattern-method',
    kind: 'method',
  },
  {
    label: 'wave',
    signature: '.wave()',
    description: 'Inline viz: sparkline at line-end. No effect on DMX output.',
    example: 'wash.red(saw.slow(4).wave())',
    context: 'pattern-method',
    kind: 'method',
  },

  // ─── Fixture / strip methods ───────────────────────────────────────────────
  {
    label: 'color',
    signature: '.color(color) | .color(stop, stop, …) | .color(palette) | .color(r, g, b [, w])',
    description:
      'Set R / G / B (and optionally W) in one call, on a fixture, a group or a strip alike. Takes a colour by name '
      + 'bare or in quotes as mini-notation (\'<red blue>\'), a pattern of colour tokens, or the components. Channels absent on the fixture are skipped '
      + 'silently, so the same line works on rgb / rgbw / dim-rgbw / moving heads. A channel counts as a colour when '
      + 'it is named red / green / blue / white in any case and with any trailing number, or spelled r / g / b / w '
      + "and declared type: 'color'. Several colours are a run: it spreads across whatever positions the light has, "
      + 'endpoint to endpoint, so a wash with pixels or a group of members takes a gradient. A par is one position '
      + 'and refuses the run rather than quietly painting its first stop: take one stop with warm[0], or put the '
      + "palette in time with cat(...warm).slow(4). A fixture with a colour wheel reads a single argument as a slot "
      + "instead: head.color('red').",
    example: `wash.color(red)             // a colour by name, no quotes
wash.color(1, 0, 0)         // red on any colour fixture
wash.color(1, 0, 0, 0.3)    // RGBW: red + a touch of white
wash.color(sine, 0, 0)    // animated red
wash.color(mini('r - g - b'))  // colour tokens, changing in time
wash.color(red, blue)       // a gradient, if the wash has pixels
bar.pixels.color(warm)      // the same word on a strip, as .fill() does
rig.color(warm)             // a palette across the members of a group`,
    context: 'fixture-method',
    kind: 'method',
  },
  {
    label: 'off',
    signature: '.off()',
    description:
      'Zero every light-emitting channel — on a fixture, a group or a strip alike (dim, RGB(W), amber, embedded strips, every pixel). Leaves state channels like pan / tilt / gobo alone, because a wheel selects rather than emits.',
    example: 'wash.off()\nbar.pixels.off()\nrig.off()',
    context: 'fixture-method',
    kind: 'method',
  },
  {
    label: 'dim',
    signature: '.dim(value | pattern)',
    description:
      'Brightness on a fixture that has a dimmer, which most real pars and every moving head do. It is a channel setter like '
      + '.red(), so it exists only when the definition has a channel for it: a bare rgb par has no dimmer and its brightness '
      + 'lives in the colour, so scale the colour or use .full(). Not to be confused with the bare dim(channel, value), which '
      + 'writes a raw DMX channel by number.',
    example: 'wash.dim(0.8)\nwash.dim(sine.slow(4))\nrig.dim(0.5)      // every member that has one',
    context: 'fixture-method',
    kind: 'method',
  },
  {
    label: 'pixels',
    signature: 'fixture.pixels',
    description:
      'The pixel strip inside a fixture, under whatever name its definition gave that channel — pixels is the usual one. '
      + 'Everything a bare rgbStrip answers to, it answers to: .color(), .fill(), .pixel(i, …), .pixelXY(x, y, …), .each(fn), '
      + '.chase(), .rainbowChase(), .off(), .full(). The fixture itself also answers .color() and .off() and passes them down, '
      + 'so reach for this when you want the pixels individually rather than the light as one thing.',
    example: "const bar = fixture(1, 'pixel-bar-rgbw-8')\nbar.pixels.color(red)\nbar.pixels.each(sine)\nbar.color(red)   // the same light, as one",
    context: 'property',
    kind: 'property',
  },
  {
    label: 'mono',
    signature: '.mono(value | pattern)',
    description:
      'Every emitter on this light at one level: white, as bright as you ask for. The brightness that works on any '
      + 'fixture, because .dim() is a channel setter and only exists where the definition has that channel — a bare rgb '
      + 'par keeps its brightness in its colour and has no dimmer at all. Drives a master, or three colours, or four, or '
      + 'a strip of pixels, and takes a pattern like any other value. On a fixture, a group and a strip alike.',
    example: 'par.mono(0.5)        // half, in white\npar.mono(pulse(4))   // breathing\nrig.mono(0.3)        // a whole rig, evenly',
    context: 'fixture-method',
    kind: 'method',
  },
  {
    label: 'temp',
    signature: '.temp(kelvin)',
    description:
      'White at a colour temperature, the way lighting has always said it. 2000 is candlelight, 3200 tungsten, 5600 '
      + 'daylight, 6500 neutral, and above that it goes blue — warmer means a smaller number. It says what colour the '
      + 'white is, not how bright, so pair it with .mono() or a dimmer. On a fixture, a group and a colour strip alike; '
      + 'a single-channel strip has no colour to set.',
    example: 'wash.temp(3200)      // tungsten\nwash.temp(5600)      // daylight\nwash.temp(2700); wash.mono(0.4)',
    context: 'fixture-method',
    kind: 'method',
  },
  {
    label: 'solo',
    signature: '.solo()',
    description:
      'Darken every other light this scene patched, and leave this one alone. The button every desk has, for answering '
      + '"just that one, now" without unpicking the look around it. The others are darkened rather than forgotten, so '
      + 'running the scene again brings the whole thing back. Only lights this run patched are known, which is the same '
      + 'window everything else works in.',
    example: 'spot.solo()          // just the spot\nbar.pixels.solo()    // just the bar',
    context: 'fixture-method',
    kind: 'method',
  },
  {
    label: 'full',
    signature: '.full()',
    description:
      'Drive every light-emitting channel to 1, on a fixture, a group or a strip alike. Brings dim + RGB(W) up together on fixtures that have both, and lights the dedicated white a colour call deliberately leaves alone.',
    example: 'wash.full()\nbar.pixels.full()',
    context: 'fixture-method',
    kind: 'method',
  },
  {
    label: 'red',
    signature: '.red(value | pattern)',
    description: 'Set the red channel. Accepts a constant 0..1 or a pattern.',
    example: 'wash.red(sine.slow(4))',
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
    example: 'wash.blue(cosine.slow(8))',
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
    example: 'head.pan(saw.slow(8))',
    context: 'fixture-method',
    kind: 'method',
  },
  {
    label: 'tilt',
    signature: '.tilt(value | pattern)',
    description: 'Tilt channel (moving heads). 0 = front, 1 = back.',
    example: 'head.tilt(sine.slow(4).range(0.2, 0.8))',
    context: 'fixture-method',
    kind: 'method',
  },
  {
    label: 'pixel',
    signature: '.pixel(i, brightness) | .pixel(i, r, g, b [, w])',
    description:
      'Set one pixel on a strip. One value = monochrome (R = G = B; W = 0 on RGBW), the usual form in chase loops. Three or four values = full colour control.',
    example: `for (let i = 0; i < strip.pixelCount; i++) {
  const fade = cosine.early(i/strip.pixelCount).slow(2).range(-7, 1)
  strip.pixel(i, fade)
}`,
    context: 'fixture-method',
    kind: 'method',
  },
  {
    label: 'fill',
    signature: '.fill(color) | .fill(stop, stop, …) | .fill(palette) | .fill(r, g, b [, w])',
    description:
      'Paint every pixel on a strip. One colour repeats across the whole strip. Two or more spread as a gradient, '
      + 'endpoint to endpoint: the first colour lands on the first pixel, the last on the last, blended in between. '
      + 'A palette is a plain array of colours and spreads the same way. A pattern of colour tokens is one colour that '
      + 'changes in time, so the strip moves together. Three or more values that are not colours stay the per-component '
      + 'spelling, which on an RGB strip takes patterns as readily as numbers. On an RGBW strip a colour writes r, g '
      + 'and b and leaves the dedicated white emitter where the scene last put it; .full() is still the call that '
      + 'lights every emitter. A single-channel strip has no colour and takes a level.',
    example: `strip.fill(red)                  // one colour, every pixel
strip.fill(red, blue)            // two stops, a gradient across the strip
strip.fill(warm)                 // a palette, spread the same way
strip.fill(mini('r - g - b'))    // colour tokens, changing in time
strip.fill(0, 0, 0, 0)`,
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
    signature: '.eachXY(pattern, across = 1, down = 0)',
    description:
      'each() for when the shape matters: every pixel runs the pattern, later the further across and down it is. across and down are how many cycles that adds up to over the width and the height.',
    example: 'wash.pixels.eachXY(sine.slow(4))          // sweep across\nwash.pixels.eachXY(sine.slow(2), 0, 1)    // wipe down',
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
    signature: '.width',
    description: 'Pixels across one row. A plain strip is width = pixelCount.',
    example: 'wash.pixels.width',
    context: 'property',
    kind: 'property',
  },
  {
    label: 'height',
    signature: '.height',
    description: 'Rows in the grid. A plain strip is height = 1.',
    example: 'wash.pixels.height',
    context: 'property',
    kind: 'property',
  },
  {
    label: 'slots',
    signature: '.slots(channelName)',
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
    signature: '.each(pattern, spread = 1)',
    description:
      'Every pixel, or every light in a group, runs the pattern, each a step later than the one before: a phase spread. '
      + 'The steps add up to spread cycles along the strip, one bar by default, so a slow pattern wants a spread to '
      + 'match. The pattern is a level, all emitters together on a colour strip. A level or a colour on its own is '
      + 'the same for every pixel.',
    example: `strip.each(cosine.slow(2).range(-7, 1), 2)     // a band walks the strip
strip.each(mini('1 - - - - - - -').fadeOut(2))  // a chase with tails
strip.each(rand.range(-3, 1), 3.7)              // sparkle`,
    context: 'fixture-method',
    kind: 'method',
  },
  {
    label: 'chase',
    signature: '.chase(color | palette, { cycles?, width?, waves?, reverse?, down?, early? })',
    description:
      'A band of colour travelling along the strip, endlessly: the plain way to get a moving light. '
      + 'Colour by name (red, blue, amber...), three numbers 0 to 1, or a palette, whose stops spread '
      + 'along the strip so the band runs over a gradient. Under .down() the stops re-sample onto the rows instead of '
      + 'the columns. A pattern of colour tokens changes the whole band in time rather than across space. '
      + 'On an RGBW strip .chase() leaves the dedicated white channel where the scene put it, the same as .fill(). '
      + 'cycles = how long a lap takes (4), width = how much is lit at once (0.5), '
      + 'waves = crests at a time (1), early = start this many cycles ahead. A single-channel strip takes options alone. '
      + 'Chainable: .slow(n), .fast(n), .early(n), .late(n), .reverse(), .down(), .width(n) and .waves(n) restate it with one option changed. Travels left to right by default.',
    example: `wash.pixels.chase(red)
wash.pixels.chase(blue, { cycles: 2, width: 0.2 })
bar.pixels.chase(warm, { cycles: 2 })            // over a gradient
bar.pixels.chase(warm, { cycles: 2 }).down()     // stops onto the rows`,
    context: 'fixture-method',
    kind: 'method',
  },
  {
    label: 'rainbowChase',
    signature: '.rainbowChase({ cycles?, width?, waves?, hue? })',
    description: 'Built-in rainbow chase. Same option names as .chase(): cycles, width, waves, plus hue for the colour rotation.',
    example: 'strip.rainbowChase({ cycles: 2, width: 0.11 })',
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
    signature: '.channels()',
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

/**
 * Lookup by label, split by whether the name follows a dot.
 *
 * Six labels are deliberately two different things: `red` is a colour value and
 * also a channel setter, `strobe` a named move and also a channel, and the same
 * for green, blue, white and flash. One Map keyed by label kept whichever came
 * last in this file, which was the setter every time, so hovering the `red` in
 * `wash.color(red)` — a bare value, the most common way the word is written —
 * explained `.red(value | pattern)` instead of the colour.
 *
 * The file header already says the hover lookup is context-blind. It does not
 * have to be: a name preceded by a dot is a member and a name that is not is
 * not, which separates every one of these pairs. The fallback keeps a miss
 * working, so a member with only a bare entry still resolves.
 */
const indexOf = (keep: (c: HelpContext) => boolean): Map<string, HelpEntry> =>
  new Map(HELP_ENTRIES.filter((e) => keep(e.context)).map((e) => [e.label, e]));

const BARE_INDEX = indexOf((c) => c === 'command');
const MEMBER_INDEX = indexOf((c) => c !== 'command');

/** The entry for a hovered word. `dotted` is true when a `.` precedes it. */
export function findHelp(label: string, dotted: boolean): HelpEntry | undefined {
  const first = dotted ? MEMBER_INDEX : BARE_INDEX;
  const second = dotted ? BARE_INDEX : MEMBER_INDEX;
  return first.get(label) ?? second.get(label);
}
