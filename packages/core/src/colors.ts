/**
 * Colour values.
 *
 * A colour is a value. It comes from a predefined name written as an
 * identifier (`red`), or from an r, g, b mix. Both can be checked at the point
 * of use. A single quoted string is read as mini-notation or a hex code (see
 * readColorStops()); other quoted colours are refused with a message pointing
 * at the identifier of the same name.
 *
 * `wash.red(1)` drives one channel and is not a colour. Slot names on a wheel
 * (`head.color('red')`) stay strings and stay out of this file. A slot is a
 * mechanical position with a manufacturer's label on it: 'open', 'red/blue',
 * 'CTO'. Some are not valid identifiers, none of them mix, and the name means
 * only what the maker of the light decided it means.
 */

import { levelOf } from './dmx.js';
import { stringPattern } from './string-patterns.js';

/**
 * A colour, as an r/g/b mix with each component 0 to 1.
 *
 * A component may also be a pattern, which is how `pick()` stays live: every
 * call that takes a colour writes its components to channels, and a channel
 * accepts a pattern as well as a number, so a colour whose components are
 * patterns works everywhere and updates without a re-run.
 */
export interface Color {
  readonly r: ColorComponent;
  readonly g: ColorComponent;
  readonly b: ColorComponent;
}

/** A number 0 to 1, or anything the channel writer accepts as a pattern. */
export type ColorComponent = number | { queryArc(begin: number, end: number): unknown };

const COLOR_BRAND = Symbol.for('gobo.color');

/** Build a colour from three components, each 0 to 1. */
export function makeColor(r: number, g: number, b: number): Color {
  return Object.freeze({ [COLOR_BRAND]: true, r, g, b } as unknown as Color);
}

/**
 * The colour of white at a temperature, in Kelvin.
 *
 * Lighting specifies white in Kelvin: 3200 is a tungsten lamp, 5600 is
 * daylight, 2000 is candlelight, and "a warmer white" means a smaller number.
 * This saves every scene mixing that by eye from r, g and b.
 *
 * Uses Daniel Neumann's widely used fit of the black-body curve: accurate
 * enough to look right between about 1000K and 40000K, and cheap enough to run
 * in a pattern every frame. Input is clamped to that range, because the fit
 * goes visibly wrong outside it.
 *
 * Normalised so the brightest component is 1: this sets the colour of the
 * white and leaves brightness to .mono() or the dimmer.
 */
export function kelvinToColor(kelvin: number): Color {
  const k = Math.min(40000, Math.max(1000, kelvin)) / 100;

  let r: number;
  let g: number;
  let b: number;

  if (k <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(k) - 161.1195681661;
  } else {
    r = 329.698727446 * Math.pow(k - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(k - 60, -0.0755148492);
  }

  if (k >= 66) b = 255;
  else if (k <= 19) b = 0;
  else b = 138.5177312231 * Math.log(k - 10) - 305.0447927307;

  const c = [r, g, b].map((v) => Math.min(255, Math.max(0, v)));
  // Normalised on the brightest component, so a warm white comes out at full
  // strength. The zero-peak guard is defensive: the clamp above rules it out,
  // and it would otherwise divide by zero.
  const peak = Math.max(c[0], c[1], c[2]) || 255;
  return makeColor(c[0] / peak, c[1] / peak, c[2] / peak);
}

/** Build a colour whose components are read live, for `pick()`. The object is
 *  frozen, but its component patterns answer differently each tick. */
export function livingColor(r: ColorComponent, g: ColorComponent, b: ColorComponent): Color {
  return Object.freeze({ [COLOR_BRAND]: true, r, g, b } as unknown as Color);
}

export function isColor(v: unknown): v is Color {
  return typeof v === 'object' && v !== null && (v as Record<symbol, unknown>)[COLOR_BRAND] === true;
}

/**
 * A palette is a plain array of colours. There is no Palette type.
 *
 * Arrays are already familiar: `warm[0]` takes one stop, `[...warm].reverse()`
 * turns it round, `warm.slice(0, 2)` shortens it, and `cat(...warm)` puts it in
 * time. A dedicated palette object would need each of those as a method, and a
 * second branded type beside `Color` would need an ordering rule at every call
 * site that takes either; getting one wrong silently flattens a palette to its
 * first stop.
 *
 * An array of numbers stays a mix and is never a palette: `[1, 0, 0.5]` is one
 * colour. A colour is branded and a number never is, so the two cannot collide.
 */
export type Palette = readonly Color[];

/** The colour this value is or spells, or null if it is neither. */
export function toColorValue(v: unknown): Color | null {
  if (isColor(v)) return v;
  // Indexed loop, because every() skips holes: a sparse array built as
  // warm[0] = red; warm[2] = blue would pass a vacuously true test and come
  // back as a colour of undefined components.
  if (!Array.isArray(v) || v.length < 3) return null;
  for (let i = 0; i < v.length; i++) {
    if (typeof v[i] !== 'number') return null;
  }
  return makeColor(clamp01(v[0]), clamp01(v[1]), clamp01(v[2]));
}

export function isPalette(v: unknown): v is Color[] {
  if (!Array.isArray(v) || v.length === 0) return false;
  for (let i = 0; i < v.length; i++) {
    if (toColorValue(v[i]) === null) return false;
  }
  return true;
}

/** Anything that answers like a pattern. Reading `.queryArc` runs scene code
 *  and can throw, which is why the test is guarded. */
type ColorPatternLike = { queryArc(begin: number, end: number): Array<{ value: unknown }> };

function isPatternLike(v: unknown): v is ColorPatternLike {
  try {
    return typeof (v as { queryArc?: unknown })?.queryArc === 'function';
  } catch {
    return false;
  }
}

/**
 * The predefined colours, and the only names that are colours.
 *
 * One exported table, so the sandbox identifiers, the chase resolver and the
 * documentation all read the same list. Keep every colour name here; a second
 * list elsewhere will drift out of agreement with this one.
 */
export const COLORS: Readonly<Record<string, Color>> = Object.freeze({
  red:     makeColor(1, 0, 0),
  orange:  makeColor(1, 0.35, 0),
  amber:   makeColor(1, 0.55, 0.1),
  yellow:  makeColor(1, 1, 0),
  green:   makeColor(0, 1, 0),
  cyan:    makeColor(0, 1, 1),
  blue:    makeColor(0, 0, 1),
  purple:  makeColor(0.5, 0, 1),
  magenta: makeColor(1, 0, 1),
  pink:    makeColor(1, 0.35, 0.6),
  /** The r, g, b mix. A dedicated white emitter is left alone: see `.full()`
   *  for the call that lights every emitter a fixture has. */
  white:   makeColor(1, 1, 1),
});

/** The predefined colour names, in the order they are documented. */
export const COLOR_NAMES: readonly string[] = Object.freeze(Object.keys(COLORS));

/**
 * The colour a name spells, looking only at the table's own entries.
 *
 * A plain index would walk the prototype chain, so `constructor` and `toString`
 * would come back as functions and count as colours: truthy values that are
 * not colours, handed to whatever asked for one.
 */
function namedColor(key: string): Color | undefined {
  return Object.prototype.hasOwnProperty.call(COLORS, key) ? COLORS[key] : undefined;
}

// ─── Blending ─────────────────────────────────────────────────────────────────

/**
 * Where stop `i` of `count` sits, 0 to 1, counting both ends.
 *
 * Endpoint-inclusive, so the first colour lands on the first pixel and the last
 * on the last, which is what "red to blue across the bar" means. A cyclic
 * phase would put the last stop one step short of the end and leave the
 * gradient looking clipped.
 */
export function phaseFor(i: number, count: number): number {
  return count < 2 ? 0 : i / (count - 1);
}

/**
 * The colour at a point along a run of stops.
 *
 * One stop is returned by identity, unblended. This is required for
 * correctness: `.chase(red)` reaches chaseImpl's `c === 0` and `c === 1` short
 * cuts only if the components are still the exact literals, so a single stop
 * has to come back as the same object it went in as.
 */
export function sampleStops(stops: Palette, phase: number): Color {
  if (stops.length === 1) return stops[0];
  const t = clamp01(phase) * (stops.length - 1);
  const i = Math.floor(t);
  if (i >= stops.length - 1) return stops[stops.length - 1];
  return mix(stops[i], stops[i + 1], t - i);
}

/**
 * Blend two colours, `t` of the way from the first to the second.
 *
 * A colour a quarter of the way from red to blue is `mix(red, blue, 0.25)`,
 * as in `wash.color(mix(red, blue, 0.25))`. Both endpoints come back by
 * identity, so a blend that lands on a stop is that same object.
 */
export function mix(a: Color, b: Color, t: number | ColorComponent): Color {
  if (!isColor(a) || !isColor(b)) {
    throw new Error(
      `mix(): needs two colours and an amount, as in mix(red, blue, 0.5). ` +
      `Write a colour as one of ${COLOR_NAMES.join(', ')} without quotes, ` +
      `or as three numbers from 0 to 1.`,
    );
  }
  if (typeof t === 'number') {
    const k = clamp01(t);
    if (k === 0) return a;
    if (k === 1) return b;
  }
  return livingColor(
    blendComponent(a.r, b.r, t),
    blendComponent(a.g, b.g, t),
    blendComponent(a.b, b.b, t),
  );
}

/** Three numbers blend now. Anything else has to wait until it is queried, so
 *  a picked colour keeps moving after the scene has run. */
function blendComponent(
  a: ColorComponent,
  b: ColorComponent,
  t: number | ColorComponent,
): ColorComponent {
  if (typeof a === 'number' && typeof b === 'number' && typeof t === 'number') {
    return a + (b - a) * clamp01(t);
  }
  return {
    queryArc(begin: number, end: number) {
      const av = componentLevel(a, begin, end);
      const bv = componentLevel(b, begin, end);
      const k = clamp01(componentLevel(t, begin, end));
      return [{ value: av + (bv - av) * k }];
    },
  };
}

/**
 * One level from a component, whether it is a number or a pattern.
 *
 * Several haps in one arc reduce to the highest, the same merge tick() applies
 * to anything overlapping. No haps at all is dark, so a rest in a mini string
 * reads as a gap.
 */
function componentLevel(c: ColorComponent | number, begin: number, end: number): number {
  if (typeof c === 'number') return c;
  if (!isPatternLike(c)) return 0;
  let out = 0;
  try {
    for (const hap of c.queryArc(begin, end)) {
      const v = levelOf(hap.value);
      if (v !== null && v > out) out = v;
    }
  } catch {
    return 0;
  }
  return out;
}

// ─── Reading a colour from a call ─────────────────────────────────────────────

/**
 * The colour a single token names, by full name or by any prefix that names
 * only one colour.
 *
 * The prefixes are derived from COLOR_NAMES, so a new entry in the table above
 * updates the tokens, the suggestions and the error text in one edit.
 */
export function colorFromToken(token: string, what: string): Color {
  const key = token.trim().toLowerCase();
  const exact = namedColor(key);
  if (exact !== undefined) return exact;

  const hits = key === '' ? [] : COLOR_NAMES.filter((n) => n.startsWith(key));
  if (hits.length === 1) return COLORS[hits[0]];
  if (hits.length > 1) {
    throw new Error(
      `${what}: "${token}" could be ${listOr(hits)}. ` +
      `Write ${listOr(hits.map(shortestUnique))}, or the whole name.`,
    );
  }
  throw new Error(
    `${what}: "${token}" is not a colour. Write one of ${COLOR_NAMES.join(', ')}, ` +
    `or a prefix that names only one of them.`,
  );
}

/** The fewest letters that still name only this colour: pi for pink. */
function shortestUnique(name: string): string {
  for (let n = 1; n <= name.length; n++) {
    const p = name.slice(0, n);
    if (COLOR_NAMES.filter((c) => c.startsWith(p)).length === 1) return p;
  }
  return name;
}

function listOr(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`;
}

/**
 * Turn a pattern whose haps name colours into one colour that changes with it.
 *
 * Works like resolveSlots() in fixtures.ts: wrap the source once per component
 * and rewrite each hap as it comes past, leaving the pattern itself untouched.
 * That lets `wash.color(mini('r - g - b'))` work without mini() knowing
 * anything about colour, and keeps a rest a rest.
 *
 * A number token is a grey, so `mini('1 - 1 -')` means the same shape in a
 * colour position as it already does in a level position.
 */
export function colorPattern(pat: ColorPatternLike, what: string): Color {
  const reported = new Set<string>();

  // One reading of the source per arc, shared by the three components.
  //
  // tick() asks every channel about the same instant, and every pixel of a
  // strip holds the same colour object, so one reading serves all of them.
  // Without the memo each component would query the source and resolve the
  // whole colour to keep its own third, three reads per pixel per tick.
  //
  // Keyed on the arc and holding exactly one, so the next tick, which asks
  // about a later instant, reads the source again instead of replaying stale
  // haps. A live source such as pick() keeps moving.
  type ReadHap = { hap: object; rgb: readonly [number, number, number] };
  let memoBegin = NaN;
  let memoEnd = NaN;
  let memo: ReadHap[] | null = null;

  const readArc = (begin: number, end: number): ReadHap[] => {
    if (memo !== null && begin === memoBegin && end === memoEnd) return memo;
    const read = pat.queryArc(begin, end).map((hap) => ({
      hap: hap as object,
      rgb: rgbOf(hap.value, begin, end, what, reported),
    }));
    memoBegin = begin;
    memoEnd = end;
    memo = read;
    return read;
  };

  const wrap = (comp: 0 | 1 | 2): ColorComponent => ({
    queryArc(begin: number, end: number) {
      // Spread, so whatever the source put on the hap reaches the channel
      // writer intact.
      return readArc(begin, end).map(({ hap, rgb }) => ({ ...hap, value: rgb[comp] }));
    },
  });

  // Checked here, so a typo throws while the scene is being evaluated and
  // the whole run rolls back. At query time it would report sixty times a
  // second into a console nobody has open, and the light would stay dark.
  // A token hidden behind an alternation is not visible in the first cycle and
  // still reports late; checking without running cannot catch it.
  try {
    for (const hap of pat.queryArc(0, 1)) {
      if (typeof hap.value === 'string') colorFromToken(hap.value, what);
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith(what)) throw err;
    // A source that throws on its own reports through its own path.
  }

  return livingColor(wrap(0), wrap(1), wrap(2));
}

/**
 * The three levels one hap's value spells, in one pass.
 *
 * All three at once: deciding what the value is happens once whichever
 * component asked, so keeping the other two costs a lookup each and saves
 * reading the source twice more.
 */
function rgbOf(
  v: unknown,
  begin: number,
  end: number,
  what: string,
  reported: Set<string>,
): readonly [number, number, number] {
  const known = toColorValue(v);
  if (known !== null) {
    // A colour that picked up a gain on the way (strudel's controls merge
    // into an object value, so red.across(0) is red with a pan and, in a
    // group, a gain) is dimmed by it.
    const levels = levelsOf(known, begin, end);
    const { gain, velocity } = v as { gain?: unknown; velocity?: unknown };
    if (typeof gain !== 'number' && typeof velocity !== 'number') return levels;
    const k = clamp01((typeof gain === 'number' ? gain : 1) * (typeof velocity === 'number' ? velocity : 1));
    return [levels[0] * k, levels[1] * k, levels[2] * k];
  }
  // A bare number is a grey, the same rule in every position. A control object
  // is read the same way: echo() and hurry() yield { value, gain }, which
  // dmx.ts already unwraps as a level, so a colour position reads it as the
  // grey of that level instead of refusing it as "not a colour".
  const level = levelOf(v);
  // strudel's .color() on a pattern tags each step with a colour: here that
  // is the step's colour, at the step's level, so '1 0.5'.color('red blue')
  // is a full red then a half blue.
  if (level !== null && v !== null && typeof v === 'object' && 'color' in v) {
    const [r, g, b] = rgbOf((v as { color: unknown }).color, begin, end, what, reported);
    const k = clamp01(level);
    return [r * k, g * k, b * k];
  }
  if (level !== null) {
    const grey = clamp01(level);
    return [grey, grey, grey];
  }
  // A colour carried in a control object: a faded step ({ value: red, gain }),
  // a side from .jux() or a place from .across(), which a group turns into a
  // gain for each light. The colour is read as usual and the gain dims it.
  if (v !== null && typeof v === 'object' && 'value' in v) {
    const { value, gain, velocity } = v as { value: unknown; gain?: unknown; velocity?: unknown };
    const [r, g, b] = rgbOf(value, begin, end, what, reported);
    let k = 1;
    if (typeof gain === 'number') k *= gain;
    if (typeof velocity === 'number') k *= velocity;
    k = clamp01(k);
    return [r * k, g * k, b * k];
  }
  if (typeof v === 'string') {
    try {
      return levelsOf(colorFromToken(v, what), begin, end);
    } catch (err) {
      if (!reported.has(v)) {
        reported.add(v);
        console.error(`[gobo] ${(err as Error).message}`);
      }
      return [0, 0, 0];
    }
  }
  // Described by name, because typeof null is "object", which says nothing
  // useful about the value.
  const described = v === null ? 'null' : v === undefined ? 'nothing' : typeof v;
  const tag = `type:${described}`;
  if (!reported.has(tag)) {
    reported.add(tag);
    console.error(`[gobo] ${what}: cannot read a colour from ${described}.`);
  }
  return [0, 0, 0];
}

/** A colour's three components as levels, over one arc. */
function levelsOf(c: Color, begin: number, end: number): readonly [number, number, number] {
  return [
    componentLevel(c.r, begin, end),
    componentLevel(c.g, begin, end),
    componentLevel(c.b, begin, end),
  ];
}

/**
 * Read the run of colours a call was handed.
 *
 * One ordered ladder, first match wins, shared by everything that takes a
 * colour so the rules cannot drift apart between `.fill()` and `.color()`.
 *
 * The string checks come first. Any later, `.fill('red', 'green', 'blue')`
 * would be read as three arguments that are not colours and get the generic
 * message instead of the one about quotes.
 */
export function readColorStops(args: readonly unknown[], what: string): Color[] {
  const first = args[0];

  // A hex colour, as a web page writes one: '#ff8800' or '#f80'.
  const hex = typeof first === 'string' && args.length === 1
    ? /^\s*#([0-9a-f]{6}|[0-9a-f]{3})\s*$/i.exec(first)
    : null;
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].replace(/./g, '$&$&') : hex[1];
    return [makeColor(parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255)];
  }

  if (typeof first === 'string' && args.length === 1) {
    // Any other single string is mini-notation, as in strudel: '<red blue>' is
    // a colour that changes each bar, and 'red' is red. Every word in it is
    // checked now, so a misspelt colour is an error on the run instead of a
    // dark step later. colorFromToken throws the specific message for a word
    // it cannot read, including a short form that could be two colours.
    for (const word of first.match(/[A-Za-z]+/g) ?? []) colorFromToken(word, what);
    const parsed = stringPattern(first, what);
    if (parsed !== null) return [colorPattern(parsed, what)];
  }

  if (typeof first === 'string') {
    const known = namedColor(first.trim().toLowerCase());
    throw new Error(
      known
        ? `${what}: colours are written without quotes. Use ${first.trim().toLowerCase()} rather than '${first}'.`
        : `${what}: "${first}" is not a colour. Write one of ${COLOR_NAMES.join(', ')} without quotes, ` +
          `or give three numbers from 0 to 1.`,
    );
  }

  // Every argument is a colour: one stop each. Checked before the palette rule
  // because both are colour-shaped and only the nesting separates them.
  if (args.length > 0 && args.every((a) => toColorValue(a) !== null)) {
    return args.map((a) => toColorValue(a) as Color);
  }

  // One argument that is an array of colours.
  if (args.length === 1 && isPalette(first)) {
    return (first as unknown[]).map((a) => toColorValue(a) as Color);
  }

  // Three components. The same spelling as .color(r, g, b) and .fill(r, g, b),
  // so a mix reads the same wherever it appears.
  // Every argument must be a number. Counting numbers with a filter would let
  // .chase(red, 0, 0, 0) drop the red and run the strip black without a word.
  if (args.length >= 3 && args.every((a) => typeof a === 'number')) {
    const nums = args as readonly number[];
    return [makeColor(clamp01(nums[0]), clamp01(nums[1]), clamp01(nums[2]))];
  }

  // A pattern of colour tokens: one colour that changes over time, so every
  // position gets it and the whole run changes together.
  if (args.length === 1 && isPatternLike(first)) return [colorPattern(first, what)];

  throw new Error(
    `${what}: needs a colour. Write one of ${COLOR_NAMES.join(', ')} without quotes, ` +
    `three numbers from 0 to 1, as in ${what.replace(/\(\)$/, '')}(1, 0.4, 0), ` +
    `or an array of colours for a gradient.`,
  );
}

/**
 * Read exactly one colour.
 *
 * Refuses a palette instead of silently taking its first stop, and names both
 * ways to get one colour from it, because a light that ignored the rest of a
 * gradient would look as if it had worked.
 */
export function readColor(args: readonly unknown[], what: string): Color {
  const stops = readColorStops(args, what);
  if (stops.length === 1) return stops[0];
  throw new Error(
    `${what}: takes one colour, not ${stops.length}. Take one stop with warm[0], ` +
    `or put the palette in time with '<0 1 2>'.palette(warm).`,
  );
}

/** Read a run of `count` positions, spreading whatever stops were given across
 *  them. A single stop repeats by identity (see sampleStops). */
export function readColorRun(args: readonly unknown[], count: number, what: string): Color[] {
  const stops = readColorStops(args, what);
  return Array.from({ length: count }, (_, i) => sampleStops(stops, phaseFor(i, count)));
}

function clamp01(n: number): number {
  // Written as a positive test so NaN lands at 0. NaN fails both n < 0 and
  // n > 1, so the obvious spelling would pass it through unclamped and a
  // channel would get a value nothing can render.
  if (!(n > 0)) return 0;
  return n > 1 ? 1 : n;
}

/**
 * Reject option keys a call does not know.
 *
 * Neighbouring option bags spell the same idea differently, so the likeliest
 * mistake is passing another call's key. Unchecked, `{ colums: 12 }` would be
 * a silent single row of 48 pixels, and `rainbowChase({ cycles: 2 })` would run
 * at its default because that bag calls it `speed`. Channel writes and group
 * roles no member has are rejected the same way.
 */
export function checkOptions(
  opts: Record<string, unknown> | undefined,
  allowed: readonly string[],
  what: string,
  /** Valid keys that scenes should not use: the sim wiring that fixture() and
   *  screen() pass to the strip they build. Accepted silently and left out of
   *  the error message so it does not advertise them. */
  internal: readonly string[] = [],
): void {
  if (!opts) return;
  const unknown = Object.keys(opts)
    .filter((k) => !allowed.includes(k) && !internal.includes(k));
  if (unknown.length === 0) return;
  const near = unknown
    .map((k) => ({ k, hit: allowed.find((a) => a.toLowerCase() === k.toLowerCase() || near1(a, k)) }))
    .filter((x) => x.hit);
  const suggestion = near.length > 0
    ? ` Did you mean ${near.map((x) => `${x.hit} (not ${x.k})`).join(', ')}?`
    : '';
  throw new Error(
    `${what}: ${unknown.length === 1 ? 'no option named' : 'no options named'} ` +
    `${unknown.map((k) => `"${k}"`).join(', ')}.${suggestion} Accepts: ${allowed.join(', ')}.`,
  );
}

/** One edit apart: a transposition, a missing letter or an extra one. Enough
 *  to catch `colums` for `columns` without inventing matches. */
function near1(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  const [s, t] = a.length >= b.length ? [a, b] : [b, a];
  let i = 0;
  let j = 0;
  let slips = 0;
  while (i < s.length && j < t.length) {
    if (s[i].toLowerCase() === t[j].toLowerCase()) { i++; j++; continue; }
    if (++slips > 1) return false;
    if (s.length === t.length) { i++; j++; } else { i++; }
  }
  return slips + (s.length - i) + (t.length - j) <= 1;
}
