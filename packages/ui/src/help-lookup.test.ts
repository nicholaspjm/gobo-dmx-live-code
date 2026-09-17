/**
 * Hover resolves a name by where it is written.
 *
 * Six labels are two things at once: `red` is a colour value and a channel
 * setter, and so are green, blue, white, strobe and flash. The index was a
 * single Map keyed by label, which keeps whichever entry comes last in the
 * file — the setter, every time. So hovering the `red` in `wash.color(red)`,
 * the commonest way the word is written, explained `.red(value | pattern)`.
 *
 * A dot before the word separates every one of those pairs.
 */

import { describe, it, expect } from 'vitest';

import { findHelp, HELP_ENTRIES } from './help-data.js';

describe('findHelp', () => {
  it('reads a bare colour name as the colour', () => {
    const entry = findHelp('red', false);
    expect(entry?.signature).toBe('red: Color');
  });

  it('reads a dotted colour name as the channel setter', () => {
    const entry = findHelp('red', true);
    expect(entry?.signature).toContain('.red(');
  });

  it('separates every label that is deliberately two things', () => {
    for (const label of ['red', 'green', 'blue', 'white', 'strobe', 'flash']) {
      const bare = findHelp(label, false);
      const dotted = findHelp(label, true);
      expect(bare, `bare ${label}`).toBeDefined();
      expect(dotted, `dotted ${label}`).toBeDefined();
      expect(bare!.signature, label).not.toBe(dotted!.signature);
      expect(dotted!.signature, label).toContain('.');
    }
  });

  it('falls back when a name exists in only one form', () => {
    // `fixture` is a command and nothing else, so it resolves either way
    // rather than coming back empty because a dot happened to precede it.
    expect(findHelp('fixture', false)).toBeDefined();
    expect(findHelp('fixture', true)).toBeDefined();
  });

  it('has no unintended duplicate labels left', () => {
    // The six above are deliberate and are told apart by context. Any other
    // repeat is one entry silently shadowing another, which is how `linger`
    // came to be documented twice and offered twice by autocomplete.
    const DELIBERATE = new Set(['red', 'green', 'blue', 'white', 'strobe', 'flash']);
    const seen = new Map<string, number>();
    for (const e of HELP_ENTRIES) seen.set(e.label, (seen.get(e.label) ?? 0) + 1);
    const unexpected = [...seen].filter(([label, n]) => n > 1 && !DELIBERATE.has(label));
    expect(unexpected).toEqual([]);
  });
});
