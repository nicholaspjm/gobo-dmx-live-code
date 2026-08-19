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
 * Read a colour from what a call was handed.
 *
 * Accepts a predefined colour, or three numbers. Refuses a quoted name with
 * the identifier to use instead, because a string colour is the form that
 * cannot be caught until the light is already wrong.
 */
export function readColor(args: readonly unknown[], what: string): Color {
  const first = args[0];

  if (typeof first === 'string') {
    const known = COLORS[first.trim().toLowerCase()];
    throw new Error(
      known
        ? `${what}: colours are written without quotes. Use ${first.trim().toLowerCase()} rather than '${first}'.`
        : `${what}: "${first}" is not a colour. Write one of ${COLOR_NAMES.join(', ')} without quotes, ` +
          `or give three numbers from 0 to 1.`,
    );
  }

  if (isColor(first)) return first;

  // Three components. The same spelling as .color(r, g, b) and .fill(r, g, b),
  // so a mix reads the same wherever it appears.
  const nums = args.filter((a) => typeof a === 'number') as number[];
  if (nums.length >= 3) return makeColor(clamp01(nums[0]), clamp01(nums[1]), clamp01(nums[2]));

  if (Array.isArray(first) && first.length >= 3 && first.every((n) => typeof n === 'number')) {
    return makeColor(clamp01(first[0]), clamp01(first[1]), clamp01(first[2]));
  }

  throw new Error(
    `${what}: needs a colour. Write one of ${COLOR_NAMES.join(', ')} without quotes, ` +
    `or three numbers from 0 to 1, as in ${what.replace(/\(\)$/, '')}(1, 0.4, 0).`,
  );
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
