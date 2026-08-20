/**
 * What a colour is.
 *
 * There were three ways to say red, and they were not three spellings of one
 * idea: `wash.color(1, 0, 0)` mixed a colour, `wash.red(1)` drove a channel,
 * and `head.color('red')` picked a slot on a wheel. Only the first was a
 * colour at all. On top of that `.chase('red')` took a fourth form, a quoted
 * string, which is the one form that cannot be checked before it runs.
 *
 * So: a colour is a value. It comes from a name that is an identifier, or from
 * an r, g, b mix. Those are the only two, and both are checkable at the point
 * of use. A quoted colour is refused with a message pointing at the identifier
 * of the same name.
 *
 * Slot names on a wheel stay strings, and stay out of this file. A slot is a
 * mechanical position with a manufacturer's label on it: 'open', 'red/blue',
 * 'CTO'. Some are not valid identifiers, none of them mix, and the name means
 * only what the maker of the light decided it means.
 */

import { levelOf } from './dmx.js';

/**
 * A colour, as an r/g/b mix with each component 0 to 1.
 *
 * A component may also be a pattern, which is what makes `pick()` live: every
 * call that takes a colour writes its components to channels, and a channel
 * takes a pattern as readily as a number, so a colour whose components are
 * patterns reaches all of them and updates without a re-run.
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

/** Build a colour whose components are read live, for `pick()`. Not frozen
 *  values but frozen references: the patterns answer differently each tick. */
export function livingColor(r: ColorComponent, g: ColorComponent, b: ColorComponent): Color {
  return Object.freeze({ [COLOR_BRAND]: true, r, g, b } as unknown as Color);
}

export function isColor(v: unknown): v is Color {
  return typeof v === 'object' && v !== null && (v as Record<symbol, unknown>)[COLOR_BRAND] === true;
}

/**
 * A palette is a plain array of colours. There is no Palette type.
 *
 * An array is a thing everyone already knows: `warm[0]` takes one stop,
 * `[...warm].reverse()` turns it round, `warm.slice(0, 2)` shortens it, and
 * `cat(...warm)` puts it in time. A dedicated palette object would have to
 * re-grow every one of those as a method, and a second branded type sitting
 * next to `Color` would need an ordering rule at every call site that takes
 * either, whose failure mode is a palette quietly flattening to its first stop.
 *
 * An array of numbers stays a mix and is never a palette: `[1, 0, 0.5]` is one
 * colour. A colour is branded and a number never is, so the two cannot collide.
 */
export type Palette = readonly Color[];

/** The colour this value is or spells, or null if it is neither. */
export function toColorValue(v: unknown): Color | null {
  if (isColor(v)) return v;
  if (Array.isArray(v) && v.length >= 3 && v.every((n) => typeof n === 'number')) {
    return makeColor(clamp01(v[0]), clamp01(v[1]), clamp01(v[2]));
  }
  return null;
}

export function isPalette(v: unknown): v is Color[] {
  return Array.isArray(v) && v.length > 0 && v.every((e) => toColorValue(e) !== null);
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
 * One table, exported, so the sandbox identifiers, the chase resolver and the
 * documentation all read from it. There used to be several lists that did not
 * agree: eleven names chase would take, twenty-three `.off()` recognised, four
 * `.color()` could actually paint. `amber` was on two of them and reachable
 * through none.
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
 * came back as functions rather than as unknown names. Every one of them then
 * counted as a colour: a truthy value that is not a colour at all, handed
 * straight to whatever asked for one.
 */
function namedColor(key: string): Color | undefined {
  return Object.prototype.hasOwnProperty.call(COLORS, key) ? COLORS[key] : undefined;
}

// ─── Blending ─────────────────────────────────────────────────────────────────

/**
 * Where stop `i` of `count` sits, 0 to 1, counting both ends.
 *
 * Endpoint-inclusive, so the first colour lands on the first pixel and the last
 * on the last, which is what a person means by "red to blue across the bar".
 * A cyclic phase would put the last stop one step short of the end and leave
 * the gradient looking clipped.
 */
export function phaseFor(i: number, count: number): number {
  return count < 2 ? 0 : i / (count - 1);
}

/**
 * The colour at a point along a run of stops.
 *
 * One stop is returned by identity rather than blended with itself. That is
 * load-bearing rather than an optimisation: `.chase(red)` reaches chaseImpl's
 * `c === 0` and `c === 1` short cuts only if the components are still the exact
 * literals, so a single stop has to come back as the same object it went in as.
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
 * The escape hatch for any curve the built-in spread does not give:
 * `bar.each(p => mix(red, blue, p * p))`. Both endpoints come back by identity,
 * so a blend that lands on a stop is that stop rather than a rebuilt copy.
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
 * Several haps in one arc reduce by taking the highest, which is the merge
 * tick() already applies to anything overlapping. No haps at all is dark,
 * which is what makes a rest in a mini string read as a gap.
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
 * The prefixes are derived from COLOR_NAMES rather than listed, so a twelfth
 * entry in the table above updates the tokens, the suggestions and the error
 * text in one edit. That is the rule this file already sets for itself.
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
 * Shaped after resolveSlots() in fixtures.ts, which is the token resolution
 * this codebase already ships: wrap the source once per component and rewrite
 * each hap as it comes past, rather than rebuilding the pattern. That is what
 * lets `wash.color(mini('r - g - b'))` work without mini() knowing anything
 * about colour, and it keeps a rest a rest.
 *
 * A number token is a grey, so `mini('1 - 1 -')` means the same shape in a
 * colour position as it already does in a level position.
 */
export function colorPattern(pat: ColorPatternLike, what: string): Color {
  const reported = new Set<string>();
  const wrap = (comp: 'r' | 'g' | 'b'): ColorComponent => ({
    queryArc(begin: number, end: number) {
      return pat.queryArc(begin, end).map((hap) => ({
        ...(hap as object),
        value: componentOf(hap.value, comp, begin, end, what, reported),
      }));
    },
  });

  // Resolve once here, so a typo throws while the scene is being evaluated and
  // the whole run rolls back. Left to query time it would report sixty times a
  // second into a console nobody has open, and the light would just be dark.
  // A token hidden behind an alternation is not visible in the first cycle and
  // still reports late; that is the limit of checking without running.
  try {
    for (const hap of pat.queryArc(0, 1)) {
      if (typeof hap.value === 'string') colorFromToken(hap.value, what);
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith(what)) throw err;
    // A source that throws on its own is not this function's to report.
  }

  return livingColor(wrap('r'), wrap('g'), wrap('b'));
}

function componentOf(
  v: unknown,
  comp: 'r' | 'g' | 'b',
  begin: number,
  end: number,
  what: string,
  reported: Set<string>,
): number {
  const known = toColorValue(v);
  if (known !== null) return componentLevel(known[comp], begin, end);
  // A bare number is a grey, the same rule in every position.
  if (typeof v === 'number') return clamp01(v);
  if (typeof v === 'string') {
    try {
      return componentLevel(colorFromToken(v, what)[comp], begin, end);
    } catch (err) {
      if (!reported.has(v)) {
        reported.add(v);
        console.error(`[gobo] ${(err as Error).message}`);
      }
      return 0;
    }
  }
  const tag = `type:${typeof v}`;
  if (!reported.has(tag)) {
    reported.add(tag);
    console.error(`[gobo] ${what}: cannot read a colour from ${typeof v}.`);
  }
  return 0;
}

/**
 * Read the run of colours a call was handed.
 *
 * One ordered ladder, first match wins, shared by everything that takes a
 * colour so the rules cannot drift apart between `.fill()` and `.color()`.
 *
 * The string refusal stays first. Moved any later, `.fill('red', 'green',
 * 'blue')` would be read as three arguments that are not colours and come back
 * with a worse message than the one this file was written to deliver.
 */
export function readColorStops(args: readonly unknown[], what: string): Color[] {
  const first = args[0];

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
  const nums = args.filter((a) => typeof a === 'number') as number[];
  if (nums.length >= 3) return [makeColor(clamp01(nums[0]), clamp01(nums[1]), clamp01(nums[2]))];

  // A pattern of colour tokens. One colour that changes over time, so every
  // position gets it and the run moves together rather than across space.
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
 * Refuses a palette rather than quietly taking its first stop, and names both
 * ways to get one, because a light that silently ignored the rest of a gradient
 * is the kind of wrong that looks like it worked.
 */
export function readColor(args: readonly unknown[], what: string): Color {
  const stops = readColorStops(args, what);
  if (stops.length === 1) return stops[0];
  throw new Error(
    `${what}: takes one colour, not ${stops.length}. Take one stop with warm[0], ` +
    `or put the palette in time with cat(...warm).slow(4).`,
  );
}

/** Read a run of `count` positions, spreading whatever stops were given across
 *  them. One stop repeats, by identity, so nothing that works changes. */
export function readColorRun(args: readonly unknown[], count: number, what: string): Color[] {
  const stops = readColorStops(args, what);
  return Array.from({ length: count }, (_, i) => sampleStops(stops, phaseFor(i, count)));
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/**
 * Reject option keys a call does not know.
 *
 * Not one options bag on the authoring surface checked its keys, and the
 * neighbouring bags spell the same idea differently, so the likeliest mistake
 * was passing the other one's key. `{ colums: 12 }` was a silent single row of
 * 48 pixels; `rainbowChase({ cycles: 2 })` silently ran at its default because
 * that bag calls it `speed`.
 *
 * The codebase already decided this class of failure is worth rejecting, for
 * channel writes and for group roles no member has. This is the same decision
 * for the last place that was still guessing.
 */
export function checkOptions(
  opts: Record<string, unknown> | undefined,
  allowed: readonly string[],
  what: string,
  /** Keys that are legal but not a scene's business: the sim wiring that
   *  fixture() and screen() pass to the strip they build. Accepted silently
   *  and left out of the message, which would otherwise advertise them. */
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
