/**
 * A quoted string is a pattern.
 *
 * In strudel "1 - 1 -" is mini-notation wherever a pattern is taken, which is
 * the first thing anyone writes there. gobo asked for mini('1 - 1 -') and
 * refused a bare string outright, so a strudel habit was an error on the first
 * line. Now a string handed to anything that takes a level or a colour reads as
 * mini-notation: wash.dim('1 - 1 -'), wash.color('<red blue>').
 *
 * The parser is strudel's own, handed over by eval.ts once it has loaded, so
 * this module stays free of strudel and the channel code can use it.
 */

import type { PatternLike } from './dmx.js';

let _parse: ((source: string) => PatternLike) | null = null;

/** Called by eval.ts with mini() once the pattern engine is ready. */
export function setStringPatternParser(parse: ((source: string) => PatternLike) | null): void {
  _parse = parse;
}

/**
 * The pattern a string spells, or null when there is no parser (the engine is
 * not loaded, as in a headless test). Throws, naming the call, when the string
 * is not mini-notation at all.
 */
export function stringPattern(source: string, what: string): PatternLike | null {
  if (_parse === null) return null;
  try {
    return _parse(source);
  } catch (err) {
    const reason = err instanceof Error ? err.message.split('\n')[0] : String(err);
    throw new Error(`${what}: "${source}" is not a pattern: ${reason}`);
  }
}
