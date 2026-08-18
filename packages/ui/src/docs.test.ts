/**
 * Docs search matching.
 *
 * The rule under test is narrow but keeps mattering: a word in a description
 * counts as a hit only when it is that word. Plain substring containment made
 * "red" match "required", "coloured" and "restored", so a search for a colour
 * returned the spiral viz and the serpentine wiring note.
 */

import { describe, it, expect } from 'vitest';
import { proseMatcher } from './docs.js';

/** Does the query match this text as prose? */
function hits(q: string, text: string): boolean {
  const re = proseMatcher(q);
  if (!re) return false;
  re.lastIndex = 0;
  return re.test(text);
}

describe('proseMatcher', () => {
  it('matches the word itself', () => {
    expect(hits('red', 'the red channel')).toBe(true);
    expect(hits('red', 'red at the start')).toBe(true);
    expect(hits('red', 'ending in red')).toBe(true);
  });

  it('does not match a word that merely contains it', () => {
    expect(hits('red', 'a required argument')).toBe(false);
    expect(hits('red', 'a coloured pixel')).toBe(false);
    expect(hits('red', 'positions are restored')).toBe(false);
    expect(hits('off', 'the channel offset')).toBe(false);
    expect(hits('dim', 'two dimensions')).toBe(false);
  });

  it('allows a plural or past tense so prose still reads naturally', () => {
    expect(hits('pattern', 'layering patterns')).toBe(true);
    expect(hits('layer', 'they are layered')).toBe(true);
    expect(hits('slot', 'the slots on a wheel')).toBe(true);
  });

  it('matches a multi-word query', () => {
    expect(hits('pixel grid', 'a pixel grid of cells')).toBe(true);
    expect(hits('pixel grid', 'a grid of pixels')).toBe(false);
  });

  it('ignores punctuation the user typed around the word', () => {
    expect(hits('.slow', 'runs slow')).toBe(true);
  });

  it('has nothing to match when the query is only punctuation', () => {
    expect(proseMatcher('.')).toBeNull();
    expect(proseMatcher('(')).toBeNull();
  });

  it('treats regex characters as literal text', () => {
    // A query is typed, not authored, so "c++" must not compile as a quantifier.
    expect(() => proseMatcher('c++')).not.toThrow();
    expect(hits('a+b', 'a+b in the text')).toBe(true);
  });
});
