/**
 * Reading a scene's own declarations back out of the text.
 *
 * The editor has no access to what eval built, so everything the hover,
 * autocomplete and colouring know about a user's `wash` comes from parsing the
 * line that made it. These tests pin the parsing, including the half-typed
 * states that are the normal condition of a buffer being edited.
 */

import { describe, it, expect } from 'vitest';
import { defineFixture } from '@gobo/core/fixtures';
import {
  findLights,
  findLight,
  lightNames,
  describeLight,
  formatChannelMap,
} from './declared-lights.js';

describe('findLights', () => {
  it('finds every constructor that makes something addressable', () => {
    const doc = [
      "const a = fixture(1, 'rgb')",
      'const b = rgbStrip(10, 4)',
      'const c = rgbwStrip(30, 4)',
      'const d = monoStrip(60, 8)',
      'const e = screen(9, { columns: 3 })',
      'const f = group(a, b)',
    ].join('\n');
    expect(findLights(doc).map((l) => [l.name, l.kind])).toEqual([
      ['a', 'fixture'],
      ['b', 'rgbStrip'],
      ['c', 'rgbwStrip'],
      ['d', 'monoStrip'],
      ['e', 'screen'],
      ['f', 'group'],
    ]);
  });

  it('does not read rgbwStrip as rgbStrip', () => {
    // Alternation is first-match, so the order the constructors are listed in
    // decides this. Getting it wrong makes an RGBW strip claim 3 channels a
    // pixel and misreport every address after the first.
    const [decl] = findLights('const s = rgbwStrip(1, 4)');
    expect(decl.kind).toBe('rgbwStrip');
  });

  it('accepts let and var', () => {
    const doc = "let a = fixture(1, 'rgb')\nvar b = fixture(5, 'rgb')";
    expect(lightNames(doc)).toEqual(new Set(['a', 'b']));
  });

  it('splits arguments at top level only', () => {
    const [decl] = findLights("const s = rgbStrip(1, 12, 0, { columns: 4, origin: 'top-right' })");
    expect(decl.args).toEqual(['1', '12', '0', "{ columns: 4, origin: 'top-right' }"]);
  });

  it('keeps a comma inside a string out of the split', () => {
    const [decl] = findLights("const a = fixture(1, 'a,b')");
    expect(decl.args).toEqual(['1', "'a,b'"]);
  });

  it('reads a call with no arguments as having none', () => {
    const [decl] = findLights('const s = screen()');
    expect(decl.args).toEqual([]);
  });

  it('skips a call whose parens have not been closed yet', () => {
    // The normal state of a line being typed. A half-read argument list would
    // otherwise describe a fixture nobody has finished declaring.
    expect(findLights('const a = fixture(1,')).toEqual([]);
  });

  it('records where the bound name starts', () => {
    const doc = "  const wash = fixture(1, 'rgb')";
    expect(findLights(doc)[0].nameFrom).toBe(doc.indexOf('wash'));
  });

  it('resolves a name bound twice to the later binding', () => {
    const doc = "const a = fixture(1, 'rgb')\nconst a = fixture(9, 'rgbw')";
    expect(findLight(doc, 'a')?.args).toEqual(['9', "'rgbw'"]);
  });

  it('ignores a call that is not bound to a name', () => {
    expect(findLights("fixture(1, 'rgb').red(1)")).toEqual([]);
  });
});

describe('describeLight', () => {
  const only = (doc: string) => describeLight(findLights(doc)[0]);

  it('reports a fixture by name and channel span', () => {
    const info = only("const wash = fixture(1, 'rgb')");
    expect(info.signature).toBe("fixture(1, 'rgb')");
    expect(info.summary).toBe('RGB PAR · 3 channels · 1 to 3');
    expect(info.commands).toContain('red(v)');
    expect(info.commands).toContain('off()');
    expect(info.note).toBeUndefined();
  });

  it('mentions a universe only when it is not the default', () => {
    expect(only("const a = fixture(1, 'rgb', 0)").summary).not.toContain('universe');
    expect(only("const a = fixture(1, 'rgb', 2)").summary).toContain('universe 2');
  });

  it('names the slots a wheel channel has', () => {
    defineFixture('test-wheel', {
      name: 'Wheel', manufacturer: 'x', type: 'moving-head', channelCount: 1,
      channels: [{
        offset: 0, name: 'color', type: 'color',
        slots: [{ name: 'open', value: 0 }, { name: 'red', from: 10, to: 19 }],
      }],
    });
    expect(only("const h = fixture(1, 'test-wheel')").commands)
      .toContain("color('open' | 'red')");
  });

  it('says what to do when the id is not loaded', () => {
    const info = only("const a = fixture(1, 'no-such-fixture')");
    expect(info.commands).toEqual([]);
    expect(info.note).toContain('defineFixture');
  });

  it('says so when the id is not a literal', () => {
    const info = only('const a = fixture(1, chosenId)');
    expect(info.note).toContain('not a plain string');
  });

  it('does not offer a strip an off() it does not have', () => {
    // Fixtures have one, strips do not. A tooltip that lists a method the
    // object lacks is worse than one that lists none.
    expect(describeLight(findLights('const s = rgbStrip(1, 4)')[0]).commands)
      .not.toContain('off()');
    expect(describeLight(findLights("const a = fixture(1, 'rgb')")[0]).commands)
      .toContain('off()');
  });

  it('counts strip channels by layout', () => {
    expect(only('const s = rgbStrip(1, 12)').summary).toContain('36 channels · 1 to 36');
    expect(only('const s = rgbwStrip(1, 12)').summary).toContain('48 channels · 1 to 48');
    expect(only('const s = monoStrip(1, 12)').summary).toContain('12 channels · 1 to 12');
  });

  it('describes a declared grid', () => {
    expect(only('const s = rgbStrip(1, 48, 0, { columns: 12 })').summary)
      .toContain('12 across, 4 down');
  });

  it('treats a bare screen as one wash and says it has no address', () => {
    const info = only('const room = screen()');
    expect(info.summary).toContain('One colour wash');
    expect(info.summary).toContain('No DMX address');
  });

  it('counts group members', () => {
    expect(only('const rig = group(a, b, c)').summary).toContain('3 members');
    expect(only('const rig = group(a)').summary).toContain('1 member under');
  });

  it('falls back to a plain description when the count is an expression', () => {
    expect(only('const s = rgbStrip(start, count)').summary).toBe('An RGB strip.');
  });
});

describe('the channel map', () => {
  const only = (doc: string) => describeLight(findLights(doc)[0]);

  // Shaped like the 154-channel wash in fixtures/: two scalar channels and two
  // strips of different layouts. That fixture is the reason the map exists, and
  // a copy of its shape is used here so the test does not depend on a
  // definition someone else maintains.
  defineFixture('test-wash-154ch', {
    name: 'Test Wash', manufacturer: 'x', type: 'generic', channelCount: 154,
    channels: [
      { offset: 0, name: 'dim', type: 'intensity' },
      { offset: 1, name: 'strobe', type: 'strobe' },
      {
        offset: 2, name: 'pixels', type: 'strip',
        pixelCount: 48, pixelLayout: 'rgb', columns: 12,
      },
      { offset: 146, name: 'strip', type: 'strip', pixelCount: 8, pixelLayout: 'mono' },
    ],
  });

  const wash = () => only("const wash = fixture(1, 'test-wash-154ch')");

  it('puts each channel at the address it was patched to', () => {
    expect(wash().channels.map((r) => [r.address, r.name, r.type])).toEqual([
      [1, 'dim', 'intensity'],
      [2, 'strobe', 'strobe'],
      [3, 'pixels', 'strip'],
      [147, 'strip', 'strip'],
    ]);
  });

  it('gives a strip one row over the whole span it claims', () => {
    const [, , pixels, strip] = wash().channels;
    expect(pixels.span).toBe(48 * 3);
    expect(pixels.strip).toEqual({ pixels: 48, layout: 'rgb', columns: 12 });
    expect(strip.span).toBe(8);
    expect(strip.strip).toEqual({ pixels: 8, layout: 'mono' });
  });

  it('prints a 154-channel fixture as four lines', () => {
    // The rule the whole thing turns on: a 48-pixel strip is one row, not 48.
    // A map that scrolls past the screen is one nobody reads.
    expect(formatChannelMap(wash().channels)).toEqual([
      '      1  dim     intensity',
      '      2  strobe  strobe',
      '  3-146  pixels  strip · 48 rgb pixels · 12 across, 4 down',
      '147-154  strip   strip · 8 mono cells',
    ]);
  });

  it('marks the positions as relative when the address is an expression', () => {
    const info = only("const wash = fixture(base, 'test-wash-154ch')");
    expect(info.channels.map((r) => r.address)).toEqual([null, null, null, null]);
    expect(formatChannelMap(info.channels)).toEqual([
      '      +1  dim     intensity',
      '      +2  strobe  strobe',
      '  +3-146  pixels  strip · 48 rgb pixels · 12 across, 4 down',
      '+147-154  strip   strip · 8 mono cells',
    ]);
  });

  it('reads the map in address order whatever order the definition lists', () => {
    defineFixture('test-unsorted', {
      name: 'Unsorted', manufacturer: 'x', type: 'rgb', channelCount: 3,
      channels: [
        { offset: 2, name: 'blue', type: 'color' },
        { offset: 0, name: 'red', type: 'color' },
        { offset: 1, name: 'green', type: 'color' },
      ],
    });
    expect(only("const p = fixture(5, 'test-unsorted')").channels.map((r) => r.address))
      .toEqual([5, 6, 7]);
  });

  it('cuts a long map short rather than growing past the window', () => {
    defineFixture('test-twenty', {
      name: 'Twenty', manufacturer: 'x', type: 'generic', channelCount: 20,
      channels: Array.from({ length: 20 }, (_, i) => ({
        offset: i, name: `ch${i + 1}`, type: 'generic' as const,
      })),
    });
    const info = only("const d = fixture(1, 'test-twenty')");
    // The map itself keeps every channel; only the printed form is cut, so a
    // panel with room for all of them is not held to the tooltip's limit.
    expect(info.channels).toHaveLength(20);
    const lines = formatChannelMap(info.channels);
    expect(lines).toHaveLength(17);
    expect(lines[16]).toContain('… 4 more channels');
  });

  it('adds to the summary and the command list rather than replacing them', () => {
    const info = wash();
    expect(info.summary).toBe('Test Wash · 154 channels · 1 to 154');
    expect(info.commands).toContain('dim(v)');
    expect(info.commands).toContain('pixels.fill(r,g,b)');
  });

  it('has no map for an id the scene has not run yet', () => {
    // defineFixture registers at run time, so before the first run there is no
    // definition to read a map out of. The note says so and stands alone.
    const info = only("const w = fixture(1, 'not-defined-yet')");
    expect(info.channels).toEqual([]);
    expect(info.note).toContain('defineFixture');
  });

  it('has no map for a strip, which declares its layout in the call', () => {
    expect(only('const s = rgbStrip(1, 12, 0, { columns: 4 })').channels).toEqual([]);
    expect(only('const room = screen(9)').channels).toEqual([]);
    expect(only('const rig = group(a, b)').channels).toEqual([]);
  });
});
