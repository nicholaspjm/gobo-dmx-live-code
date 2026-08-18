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

/** A colour, as an r/g/b mix with each component 0 to 1. */
export interface Color {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

const COLOR_BRAND = Symbol.for('gobo.color');

/** Build a colour from three components, each 0 to 1. */
export function makeColor(r: number, g: number, b: number): Color {
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
