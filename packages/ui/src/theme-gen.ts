/**
 * Themes computed from a few decisions instead of forty hand-picked hex values.
 *
 * The hand-drawn themes are picked colour by colour. That does not scale to
 * the families a tool like this is asked for (monochrome, high contrast,
 * colour-blind safe, a dim booth, a bright outdoor screen), and hand picking
 * is how one colour in forty slips under the contrast line.
 *
 * So a generated theme states its ground, its text, its accent and a plan for
 * hues, and each syntax colour is then found by holding its hue and saturation
 * and searching lightness until it reaches a contrast target against the
 * ground. Every colour here clears its target by construction, on a dark
 * ground or a light one, and the hue plan sets the theme's character.
 *
 * The targets come in three tiers, as the hand-drawn themes use them: the
 * loudest tokens (a fixture's name where it is declared, where light goes), the
 * ordinary ones, and the ones that recede (comments, punctuation, read-only
 * introspection). The lowest tier is still 4.5:1 or better.
 */

import type { ThemeBase } from './themes.js';

type SyntaxKey = Extract<keyof ThemeBase, `syn${string}`>;

/** How loud each syntax role is: 2 the loudest, 0 the quietest. */
const TIER: Record<SyntaxKey, 0 | 1 | 2> = {
  synFixtureDecl: 2, synFixtureRef: 1, synFactory: 1, synOutput: 2, synClock: 1,
  synPattern: 1, synPatternChain: 0, synColor: 1, synColorRed: 1, synColorGreen: 1,
  synColorBlue: 1, synColorWhite: 1, synColorAmber: 1, synColorOrange: 1, synColorYellow: 1,
  synColorCyan: 1, synColorPurple: 1, synColorMagenta: 1, synColorPink: 1, synIntensity: 1,
  synMove: 1, synPixel: 1, synViz: 0, synDmx: 0, synMeta: 0, synKeyword: 1, synNumber: 1,
  synString: 1, synComment: 0, synOperator: 0,
};

/** A hue in degrees and a saturation from 0 to 1. */
type Hue = readonly [number, number];

/**
 * The house plan: the hue each role has in the hand-drawn themes, so a
 * generated theme reads like the rest of gobo. Colour names are tinted their
 * own colour; the quiet roles are the low-saturation ones.
 */
export const STANDARD_HUES: Record<SyntaxKey, Hue> = {
  synFixtureDecl: [54, 0.75], synFixtureRef: [54, 0.45], synFactory: [298, 0.5], synOutput: [20, 0.85],
  synClock: [36, 0.8], synPattern: [176, 0.6], synPatternChain: [176, 0.25], synColor: [335, 0.2],
  synColorRed: [0, 0.55], synColorGreen: [135, 0.45], synColorBlue: [222, 0.55], synColorWhite: [215, 0.05],
  synColorAmber: [45, 0.45], synColorOrange: [18, 0.55], synColorYellow: [60, 0.45], synColorCyan: [182, 0.5],
  synColorPurple: [255, 0.5], synColorMagenta: [302, 0.4], synColorPink: [340, 0.5], synIntensity: [84, 0.6],
  synMove: [258, 0.45], synPixel: [198, 0.6], synViz: [270, 0.18], synDmx: [210, 0.15], synMeta: [30, 0.1],
  synKeyword: [298, 0.3], synNumber: [102, 0.4], synString: [155, 0.35], synComment: [30, 0.08],
  synOperator: [30, 0.06],
};

/**
 * Colour-blind safe: every role drawn from the Okabe-Ito set (orange, sky blue,
 * bluish green, yellow, blue, vermillion, reddish purple) and grey, the palette
 * made to stay distinct under every common colour vision deficiency. The quiet
 * roles are grey, so hue is never the only thing separating the loud ones.
 */
const OKABE = {
  orange: [37, 1] as Hue, sky: [202, 0.65] as Hue, green: [164, 1] as Hue, yellow: [55, 0.85] as Hue,
  blue: [202, 1] as Hue, vermillion: [24, 1] as Hue, purple: [326, 0.45] as Hue, grey: [0, 0] as Hue,
};
export const CVD_HUES: Record<SyntaxKey, Hue> = {
  synFixtureDecl: OKABE.yellow, synFixtureRef: OKABE.yellow, synFactory: OKABE.purple, synOutput: OKABE.vermillion,
  synClock: OKABE.orange, synPattern: OKABE.sky, synPatternChain: OKABE.grey, synColor: OKABE.grey,
  // A colour name is legible as itself; these tint towards the nearest safe hue.
  synColorRed: OKABE.vermillion, synColorGreen: OKABE.green, synColorBlue: OKABE.blue, synColorWhite: OKABE.grey,
  synColorAmber: OKABE.orange, synColorOrange: OKABE.orange, synColorYellow: OKABE.yellow, synColorCyan: OKABE.sky,
  synColorPurple: OKABE.purple, synColorMagenta: OKABE.purple, synColorPink: OKABE.purple, synIntensity: OKABE.orange,
  synMove: OKABE.purple, synPixel: OKABE.sky, synViz: OKABE.grey, synDmx: OKABE.grey, synMeta: OKABE.grey,
  synKeyword: OKABE.purple, synNumber: OKABE.green, synString: OKABE.green, synComment: OKABE.grey,
  synOperator: OKABE.grey,
};

/**
 * Tritan safe: blue and yellow are the pair tritanopia merges, so this keeps to
 * the red-to-cyan axis it separates well, and to lightness.
 */
const TRITAN = { red: [355, 0.7] as Hue, teal: [185, 0.7] as Hue, pink: [330, 0.5] as Hue, grey: [0, 0] as Hue };
export const TRITAN_HUES: Record<SyntaxKey, Hue> = Object.fromEntries(
  (Object.keys(TIER) as SyntaxKey[]).map((k) => {
    const [h] = STANDARD_HUES[k];
    if (TIER[k] === 0 || k === 'synColorWhite' || k === 'synColor') return [k, TRITAN.grey];
    // Warm hues to red, cool to teal, the purples to pink.
    const hue = h >= 250 && h < 345 ? TRITAN.pink : h >= 100 && h < 250 ? TRITAN.teal : TRITAN.red;
    return [k, hue];
  }),
) as Record<SyntaxKey, Hue>;

/**
 * No blue light: every hue folded into the warm half (red to yellow-green), for
 * working late or in a dark room. Roles stay apart by lightness and by where in
 * that half they land.
 */
export const WARM_HUES: Record<SyntaxKey, Hue> = Object.fromEntries(
  (Object.keys(TIER) as SyntaxKey[]).map((k) => {
    const [h, s] = STANDARD_HUES[k];
    return [k, [Math.round((h / 360) * 75), Math.min(1, s + 0.1)] as Hue];
  }),
) as Record<SyntaxKey, Hue>;

/** One hue for everything, at `saturation`: a monochrome theme. */
export function monoHues(hue: number, saturation: number): Record<SyntaxKey, Hue> {
  return Object.fromEntries((Object.keys(TIER) as SyntaxKey[]).map((k) => [k, [hue, saturation] as Hue])) as Record<SyntaxKey, Hue>;
}

export interface GenSpec {
  bg: string;
  text: string;
  accent: string;
  /** The second accent; derived from the accent when left out. */
  accent2?: string;
  hues: Record<SyntaxKey, Hue>;
  /** The contrast the quietest role reaches. 4.9 by default, 7 for AAA. */
  minContrast?: number;
  /** How far each tier above the quietest steps up. */
  tierStep?: number;
  /** Scales every saturation, for a softer or a louder theme. */
  saturation?: number;
  /** The muted text colour; derived when left out. */
  textMuted?: string;
  error?: string;
}

// ─── colour arithmetic ───────────────────────────────────────────────────────

function rgbOf(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function hexOf(r: number, g: number, b: number): string {
  const c = (v: number): string => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** WCAG relative luminance. */
export function luminance(hex: string): number {
  const lin = (v: number): number => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = rgbOf(hex);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio between two opaque colours. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function hsl(h: number, s: number, l: number): string {
  const k = (n: number): number => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number): number => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return hexOf(f(0) * 255, f(8) * 255, f(4) * 255);
}

/**
 * The hue at the lightness that meets `target` against `bg`, as close to the
 * ground as it can be while doing so: the quietest colour that still passes.
 * Lighter on a dark ground, darker on a light one.
 */
export function tuned(hue: Hue, bg: string, target: number): string {
  const dark = luminance(bg) < 0.18;
  let lo = dark ? 0 : 0;
  let hi = 1;
  // Lightness where contrast crosses the target, by bisection. On a dark
  // ground contrast rises with lightness; on a light one it falls.
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    const passes = contrast(hsl(hue[0], hue[1], mid), bg) >= target;
    if (dark ? passes : !passes) hi = mid;
    else lo = mid;
  }
  const l = dark ? hi : lo;
  const out = hsl(hue[0], hue[1], l);
  // A target past what the hue can reach (a saturated blue on black at 15:1)
  // falls back to the end of the scale, which is the most it has.
  return contrast(out, bg) >= target ? out : dark ? '#ffffff' : '#000000';
}

/** `over` on `base` at `alpha`, opaque. */
function mix(base: string, over: string, alpha: number): string {
  const a = rgbOf(base);
  const b = rgbOf(over);
  return hexOf(a[0] + (b[0] - a[0]) * alpha, a[1] + (b[1] - a[1]) * alpha, a[2] + (b[2] - a[2]) * alpha);
}

/** A generated theme: the base values a hand-drawn one states, all worked out. */
export function generateTheme(spec: GenSpec): ThemeBase {
  const min = spec.minContrast ?? 4.9;
  const step = spec.tierStep ?? 1.1;
  const satScale = spec.saturation ?? 1;
  const syntax = Object.fromEntries(
    (Object.keys(TIER) as SyntaxKey[]).map((k) => {
      const [h, s] = spec.hues[k];
      return [k, tuned([h, Math.min(1, s * satScale)], spec.bg, min + TIER[k] * step)];
    }),
  ) as Record<SyntaxKey, string>;
  const accent2 = spec.accent2 ?? mix(spec.accent, spec.text, 0.35);
  return {
    bg: spec.bg,
    text: spec.text,
    // Muted text is read (labels, hints), so it is held to the same floor.
    textMuted: spec.textMuted ?? tuned(spec.hues.synComment, spec.bg, Math.max(4.6, min - 0.2)),
    accent: spec.accent,
    accent2,
    sage: syntax.synString,
    error: spec.error ?? tuned([2, 0.7], spec.bg, Math.max(4.6, min)),
    selection: `${mix(spec.bg, spec.text, 0.12)}80`,
    cursor: spec.accent,
    selectionBg: mix(spec.bg, spec.accent, 0.28),
    ...syntax,
  };
}
