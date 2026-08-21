/**
 * Completion ranking.
 *
 * Typing `ch` on a strip offered channelCount and channels before chase:
 * CodeMirror scores those prefix hits the same and falls back to alphabetical,
 * so the method actually named that sat third. The boost decides the order
 * within a tier; CodeMirror still decides what matches at all.
 *
 * The second half is about the pool rather than the tiers. After a dot the
 * pattern methods and the fixture methods are merged, and the pattern side is
 * the longer, so a light's own verbs were buried. They are ranked above the
 * rest now, which is only worth doing if `.slow()` on a light is still there
 * to be typed, so that is pinned here too.
 */

import { describe, it, expect } from 'vitest';
import { defineFixture } from '@gobo/core/fixtures';
import { methodsAfter, rankFor } from './autocomplete.js';

/** Labels in the order they would be offered, best first. */
function order(labels: string[], typed: string): string[] {
  return rankFor(labels.map((label) => ({ label })), typed)
    .map((o) => ({ label: o.label, boost: o.boost ?? 0 }))
    .sort((a, b) => b.boost - a.boost || a.label.localeCompare(b.label))
    .map((o) => o.label);
}

describe('rankFor', () => {
  it('puts the shortest prefix match first', () => {
    expect(order(['channelCount', 'channels', 'chase', 'chunk'], 'ch')[0]).toBe('chase');
  });

  it('still prefers the shorter name as the query grows', () => {
    expect(order(['channelCount', 'channels', 'chase'], 'cha')).toEqual(
      ['chase', 'channels', 'channelCount'],
    );
  });

  it('puts an exact match above every prefix match', () => {
    expect(order(['rgb', 'rgbStrip', 'rgbwStrip'], 'rgb')[0]).toBe('rgb');
  });

  it('leaves fuzzy matches below anything that starts with the query', () => {
    // `punchcard` and `startChannel` come through CodeMirror's fuzzy matcher on
    // "ch". They should still be offered, just not ahead of chase.
    const out = order(['punchcard', 'startChannel', 'chase'], 'ch');
    expect(out[0]).toBe('chase');
    expect(out).toContain('punchcard');
    expect(out).toContain('startChannel');
  });

  it('matches regardless of case', () => {
    expect(order(['rainbowChase', 'Chase'], 'cha')[0]).toBe('Chase');
  });

  it('leaves the list alone when nothing has been typed', () => {
    const opts = [{ label: 'b' }, { label: 'a' }];
    expect(rankFor(opts, '')).toBe(opts);
  });

  it('does not drop anything it did not rank', () => {
    const labels = ['chase', 'punchcard', 'silence'];
    expect(rankFor(labels.map((label) => ({ label })), 'ch')).toHaveLength(3);
  });
});

// ─── The pool after a dot ────────────────────────────────────────────────────

const WASH = "const wash = fixture(1, 'rgbw')";
const STRIP = 'const bar = rgbStrip(10, 16)';

/** Does CodeMirror's matcher keep this label? It wants the typed letters in
 *  order somewhere in the name, which is how `punchcard` survives "ch". */
function kept(label: string, q: string): boolean {
  let i = 0;
  for (const c of label.toLowerCase()) if (c === q[i]) i++;
  return i === q.length;
}

/** The popup as it would be shown: what CodeMirror's matcher kept, in boost
 *  order, ties alphabetical. Filtering first matters, because a light's verbs
 *  are ranked high and most of them do not match a query like "slo" at all. */
function offered(doc: string, receiver: string, typed: string): string[] {
  const q = typed.toLowerCase();
  return methodsAfter(doc, receiver, typed)
    .filter((o) => kept(o.label, q))
    .map((o) => ({ label: o.label, boost: o.boost ?? 0 }))
    .sort((a, b) => b.boost - a.boost || a.label.localeCompare(b.label))
    .map((o) => o.label);
}

const before = (out: string[], a: string, b: string): boolean => {
  expect(out).toContain(a);
  expect(out).toContain(b);
  return out.indexOf(a) < out.indexOf(b);
};

describe('methodsAfter', () => {
  it('puts a declared light\'s own verbs above the pattern chain', () => {
    // Stated as a difference, because the same pair in the other order is what
    // the plain tiers give: `nothing` is not a light, so nothing is lifted.
    expect(before(offered(WASH, 'wash', ''), 'white', 'range')).toBe(true);
    expect(before(offered(WASH, 'nothing', ''), 'range', 'white')).toBe(true);
  });

  it('offers the pattern chain rather than dropping it', () => {
    // Same names on a light and on anything else. Only the order differs.
    const names = (receiver: string) =>
      methodsAfter(WASH, receiver, 'sl').map((o) => o.label).sort();
    expect(names('wash')).toEqual(names('somePattern'));
    expect(names('wash')).toContain('slow');
  });

  it('still reaches .slow() first once it is what has been typed', () => {
    // The whole point of ranking rather than filtering: a light's verbs are
    // ranked high and none of them survives a query like "slo", so what is
    // left is the chain method that was asked for.
    expect(offered(WASH, 'wash', 'slo')[0]).toBe('slow');
  });

  it('lifts only the verbs this light actually has', () => {
    const out = offered(WASH, 'wash', 'c');
    // .chase and .column belong to a strip, and a four-channel PAR is not one.
    // They keep their ordinary rank, below a pattern method that matches as
    // well: lifting the fixture pool wholesale would put both above .chunk.
    expect(out[0]).toBe('color');
    expect(before(out, 'chunk', 'column')).toBe(true);
  });

  it('reads a strip\'s verbs off its own declaration', () => {
    // .rainbowChase is a strip verb. On name length alone .range wins by a
    // wide margin, which is what it does on any other receiver.
    expect(before(offered(STRIP, 'bar', 'r'), 'rainbowChase', 'range')).toBe(true);
    expect(before(offered(STRIP, 'nothing', 'r'), 'range', 'rainbowChase')).toBe(true);
  });

  it('ranks a fixture nobody can resolve as a fixture anyway', () => {
    // The id is not loaded, so which channels it has cannot be read. That it
    // is a light can, so the fixture pool still goes first.
    const out = offered("const head = fixture(1, 'no-such-fixture')", 'head', 'p');
    expect(before(out, 'pixelGrid', 'ply')).toBe(true);
  });

  it('leaves a receiver that is not a light to the plain tiers', () => {
    const out = methodsAfter(WASH, 'somePattern', 'ch');
    expect(out.every((o) => (o.boost ?? 0) >= 0)).toBe(true);
    expect(offered(WASH, 'somePattern', 'ch')[0]).toBe('chase');
  });

  it('follows a strip inside a fixture', () => {
    // `bar.pixels.` is the strip, not the fixture: the receiver is everything
    // before the last dot, and the fixture lists its members' commands under
    // their own name. Without that, .fast and .fill tie on length and the
    // pattern method takes it.
    defineFixture('test-pixel-bar', {
      name: 'Test Pixel Bar',
      manufacturer: 'Generic',
      type: 'generic',
      channelCount: 13,
      channels: [
        { offset: 0, name: 'dim', type: 'intensity' },
        { offset: 1, name: 'pixels', type: 'strip', pixelCount: 4, pixelLayout: 'rgb' },
      ],
    });
    const doc = "const bar = fixture(1, 'test-pixel-bar')";
    expect(before(offered(doc, 'bar.pixels', 'f'), 'fill', 'fast')).toBe(true);
    expect(before(offered(doc, 'bar', 'f'), 'fast', 'fill')).toBe(true);
  });
});
