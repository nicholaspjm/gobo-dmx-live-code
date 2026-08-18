/**
 * Completion ranking.
 *
 * Typing `ch` on a strip offered channelCount and channels before chase:
 * CodeMirror scores those prefix hits the same and falls back to alphabetical,
 * so the method actually named that sat third. The boost decides the order
 * within a tier; CodeMirror still decides what matches at all.
 */

import { describe, it, expect } from 'vitest';
import { rankFor } from './autocomplete.js';

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
