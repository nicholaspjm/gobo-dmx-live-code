/**
 * Editor autocomplete for the lumen API.
 *
 * Two contexts are recognised:
 *
 *   1. Bare identifier — `sin|` — we suggest top-level commands (fixture,
 *      sine, artnet, setBPM, …) plus any light names the user has
 *      declared via `const X = fixture(…)` / `rgbStrip(…)` / `rgbwStrip(…)`.
 *
 *   2. After a dot — `wash.|` or `sine().slow(4).|` — we suggest common
 *      method names: channel setters (.red, .dim, …), pattern chains
 *      (.slow, .range, …), pixel/strip ops (.pixel, .fill, …), and
 *      the viz methods (.viz, .flash, .glow, .wave).
 *
 * The completion set is deliberately curated rather than derived at eval
 * time — eval runs in a sandbox and its fixture metadata isn't available
 * to the editor. The lists here are the same names used by the
 * code-highlight plugin so colouring and suggestions agree.
 */

import {
  autocompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete';
import { syntaxTree } from '@codemirror/language';

// ─── Completion pools ────────────────────────────────────────────────────────

const commandCompletions: Completion[] = [
  // Fixtures
  { label: 'fixture',       type: 'function', detail: 'fixture(startCh, id, universe = 0)',
    info: 'Create a fixture instance at a DMX start channel.' },
  { label: 'rgbStrip',      type: 'function', detail: 'rgbStrip(startCh, pixelCount, universe = 0)',
    info: 'RGB pixel strip — 3 channels per pixel.' },
  { label: 'rgbwStrip',     type: 'function', detail: 'rgbwStrip(startCh, pixelCount, universe = 0)',
    info: 'RGBW pixel strip — 4 channels per pixel.' },
  { label: 'defineFixture', type: 'function', detail: 'defineFixture(id, def)',
    info: 'Register a custom fixture with a specific channel layout.' },
  { label: 'listFixtures',  type: 'function', detail: 'listFixtures()',
    info: 'List every registered fixture id.' },

  // Output
  { label: 'artnet', type: 'function', detail: "artnet(host = '127.0.0.1', port = 6454)",
    info: 'Send Art-Net DMX packets via the bridge.' },
  { label: 'osc',    type: 'function', detail: "osc(host = '127.0.0.1', port = 9000)",
    info: 'Send OSC messages via the bridge.' },
  { label: 'sacn',   type: 'function', detail: 'sacn(universe = 1, priority = 100)',
    info: 'Multicast sACN / E1.31 packets.' },
  { label: 'mock',   type: 'function', detail: 'mock()',
    info: 'Log-only output — no network.' },

  // Clock
  { label: 'setBPM', type: 'function', detail: 'setBPM(bpm)',
    info: 'Set the scheduler tempo.' },

  // Patterns
  { label: 'sine',   type: 'function', detail: 'sine()',   info: 'Sine waveform pattern 0..1.' },
  { label: 'cosine', type: 'function', detail: 'cosine()', info: 'Cosine waveform pattern 0..1.' },
  { label: 'square', type: 'function', detail: 'square()', info: '50% duty square wave 0/1.' },
  { label: 'saw',    type: 'function', detail: 'saw()',    info: 'Sawtooth ramp 0→1.' },
  { label: 'rand',   type: 'function', detail: 'rand()',   info: 'Uniform random 0..1.' },

  // Sequencing (Strudel mini-notation)
  { label: 'mini',     type: 'function', detail: "mini('1 - 1 -')",
    info: "Step sequencer — space-separated tokens split one cycle equally. '-' rests, [a b] compresses, *N repeats, <a b> alternates per cycle. See the 'sequencing' docs tab." },
  { label: 'm',        type: 'function', detail: "m('1 - 1 -')",
    info: 'Alias for mini().' },
  { label: 'sequence', type: 'function', detail: 'sequence(a, b, c, …)',
    info: 'Positional-args form of mini(). Each arg is one step — args can be patterns.' },
  { label: 'cat',      type: 'function', detail: 'cat(pat1, pat2, …)',
    info: 'Concatenate patterns — each takes one full cycle before the next.' },
  { label: 'stack',    type: 'function', detail: 'stack(pat1, pat2, …)',
    info: 'Run patterns in parallel. Usually apply separate mini() calls per channel instead.' },

  // Low-level DMX
  { label: 'ch',  type: 'function', detail: 'ch(channel, value)',      info: 'Set a universe-0 channel directly.' },
  { label: 'uni', type: 'function', detail: 'uni(universe, ch, value)', info: 'Set a channel on any universe.' },
  { label: 'dim', type: 'function', detail: 'dim(channel, value)',     info: 'Alias for ch().' },
  { label: 'rgb', type: 'function', detail: 'rgb(startCh, r, g, b)',   info: 'Set three contiguous channels.' },

  // Audio namespace
  { label: 'audio', type: 'variable',
    detail: 'audio.{ bass | mid | treble | rms | peak | bpm | position | … }',
    info: 'Audio-reactive namespace — bass/mid/treble/rms/peak return patterns; bpm/position are scalars.' },
];

/** Method names available on patterns (sine, cosine, audio.bass, …).
 *  Chain-shaping + viz decorations live here. */
const patternMethods: Completion[] = [
  { label: 'slow',  type: 'method', detail: '.slow(n)',       info: 'Stretch the pattern so one cycle takes n beats.' },
  { label: 'fast',  type: 'method', detail: '.fast(n)',       info: 'Compress the pattern by n.' },
  { label: 'early', type: 'method', detail: '.early(n)',      info: 'Shift the pattern earlier by n cycles (phase shift).' },
  { label: 'late',  type: 'method', detail: '.late(n)',       info: 'Shift the pattern later by n cycles.' },
  { label: 'range', type: 'method', detail: '.range(lo, hi)', info: 'Remap the pattern output to [lo, hi].' },
  { label: 'add',   type: 'method', detail: '.add(n | pat)',  info: 'Add a number or pattern to the output.' },
  { label: 'mul',   type: 'method', detail: '.mul(n | pat)',  info: 'Multiply the output by a number or pattern.' },
  { label: 'flash', type: 'method', detail: '.flash()',       info: 'Opt-in: editor line flashes on rising edges.' },
  { label: 'glow',  type: 'method', detail: '.glow()',        info: 'Opt-in: editor line bg tracks the pattern value.' },
  { label: 'wave',  type: 'method', detail: '.wave()',        info: 'Opt-in: inline sparkline at line-end.' },
];

/** Methods available on fixture instances and pixel strips.
 *  The setter names (red, green, pan, …) cover the common built-in
 *  channel types — a user-defined fixture can have arbitrary names, so
 *  we'll still show these as hints. */
const fixtureMethods: Completion[] = [
  // Common channel setters
  { label: 'red',    type: 'method', detail: '.red(value | pattern)',   info: 'Red channel (0..1 or 0..255).' },
  { label: 'green',  type: 'method', detail: '.green(value | pattern)', info: 'Green channel.' },
  { label: 'blue',   type: 'method', detail: '.blue(value | pattern)',  info: 'Blue channel.' },
  { label: 'white',  type: 'method', detail: '.white(value | pattern)', info: 'White channel (RGBW fixtures).' },
  { label: 'dim',    type: 'method', detail: '.dim(value | pattern)',   info: 'Master dimmer.' },
  { label: 'strobe', type: 'method', detail: '.strobe(value | pattern)', info: 'Strobe rate.' },
  { label: 'pan',    type: 'method', detail: '.pan(value | pattern)',   info: 'Pan (moving heads).' },
  { label: 'tilt',   type: 'method', detail: '.tilt(value | pattern)',  info: 'Tilt (moving heads).' },
  // Strip / pixel API
  { label: 'pixel',  type: 'method', detail: '.pixel(i, r, g, b [, w])', info: 'Set one pixel on a strip.' },
  { label: 'fill',   type: 'method', detail: '.fill(r, g, b [, w])',     info: 'Set every pixel on a strip.' },
  { label: 'rainbowChase', type: 'method',
    detail: '.rainbowChase({ speed?, narrow?, rainbowSpeed?, packets? })',
    info: 'Built-in rainbow chase effect — see the "effects" docs tab for the mechanism.' },
  // Viz chain
  { label: 'viz',    type: 'method', detail: ".viz('color' | 'wave' | 'meter' | 'strip')",
    info: 'Opt-in inline editor widget at line-end.' },
  // Housekeeping / metadata
  { label: 'set',         type: 'method', detail: ".set(channelName, value)", info: 'Set a channel by name.' },
  { label: 'channels',    type: 'method', detail: '.channels()',               info: 'List channel names on this fixture.' },
  { label: 'pixelCount',  type: 'property', detail: '.pixelCount',             info: 'Number of pixels on a strip.' },
  { label: 'channelCount',type: 'property', detail: '.channelCount',           info: 'Total DMX channels this strip occupies.' },
  { label: 'startChannel',type: 'property', detail: '.startChannel',           info: '1-based DMX start channel.' },
  { label: 'universe',    type: 'property', detail: '.universe',               info: 'Universe this fixture lives on.' },
];

/** Methods / properties on the audio namespace. */
const audioMethods: Completion[] = [
  { label: 'bass',     type: 'method',   detail: 'audio.bass()',     info: 'Low-band energy 0..1 (kick, bass).' },
  { label: 'mid',      type: 'method',   detail: 'audio.mid()',      info: 'Mid-band energy 0..1.' },
  { label: 'treble',   type: 'method',   detail: 'audio.treble()',   info: 'High-band energy 0..1.' },
  { label: 'rms',      type: 'method',   detail: 'audio.rms()',      info: 'Overall loudness 0..1.' },
  { label: 'peak',     type: 'method',   detail: 'audio.peak()',     info: 'Transient detector — spikes on hits, decays to 0.' },
  { label: 'bpm',      type: 'property', detail: 'audio.bpm',        info: 'Detected track BPM (number | null).' },
  { label: 'position', type: 'property', detail: 'audio.position',   info: 'Playhead position in seconds.' },
  { label: 'duration', type: 'property', detail: 'audio.duration',   info: 'Track duration in seconds.' },
  { label: 'isPlaying',type: 'property', detail: 'audio.isPlaying',  info: 'Whether the track is currently playing.' },
  { label: 'track',    type: 'property', detail: 'audio.track',      info: 'Loaded track filename.' },
];

// Merged method pool shown when we can't narrow by receiver.
const allMethods: Completion[] = [...patternMethods, ...fixtureMethods];

// ─── Light-name discovery (pre-scan user's doc) ──────────────────────────────
/** Mirrors the regex used in code-highlight.ts — kept in sync manually. */
const LIGHT_DECL_RE =
  /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:fixture|rgbStrip|rgbwStrip)\s*\(/g;

function collectLightNames(doc: string): string[] {
  const names = new Set<string>();
  LIGHT_DECL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = LIGHT_DECL_RE.exec(doc)) !== null) {
    names.add(m[1]);
  }
  return [...names];
}

// ─── Completion source ───────────────────────────────────────────────────────

function lumenCompletions(context: CompletionContext): CompletionResult | null {
  // Skip inside strings and comments — typing "re" in a comment shouldn't
  // pop the whole API up.
  const tree = syntaxTree(context.state);
  const nodeBefore = tree.resolveInner(context.pos, -1);
  const kind = nodeBefore.name;
  if (kind === 'String' || kind === 'TemplateString' || kind === 'LineComment' || kind === 'BlockComment') {
    return null;
  }

  // Case 1: method context — something before the cursor ends in `.word`
  // (the word may be empty). Narrow the completion pool by the receiver
  // name so `audio.` only shows audio methods, etc.
  const dotMatch = context.matchBefore(/([A-Za-z_$][\w$]*)\.(\w*)$/);
  if (dotMatch) {
    const [, receiver] = dotMatch.text.match(/^([A-Za-z_$][\w$]*)\./) ?? [];
    const methodStart = dotMatch.from + dotMatch.text.indexOf('.') + 1;

    let options: Completion[];
    if (receiver === 'audio') {
      options = audioMethods;
    } else {
      // Best-effort: merge pattern + fixture methods. Filtering on the
      // user's prefix happens in the autocomplete UI.
      options = allMethods;
    }
    return { from: methodStart, options, validFor: /^\w*$/ };
  }

  // Case 2: bare identifier — commands + user-declared light names.
  const wordMatch = context.matchBefore(/[A-Za-z_$][\w$]*$/);
  if (!wordMatch) return null;
  if (wordMatch.from === wordMatch.to && !context.explicit) return null;

  const doc = context.state.doc.toString();
  const lightOptions: Completion[] = collectLightNames(doc).map((name) => ({
    label: name,
    type: 'variable',
    detail: 'fixture',
    info: 'A fixture you defined in this buffer.',
  }));

  return {
    from: wordMatch.from,
    options: [...commandCompletions, ...lightOptions],
    validFor: /^\w*$/,
  };
}

/** CodeMirror extension: our source over the default JavaScript completions. */
export const lumenAutocomplete = autocompletion({
  override: [lumenCompletions],
  activateOnTyping: true,
  closeOnBlur: true,
  maxRenderedOptions: 15,
});
