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
import { findLights, findLight, lightNames, describeLight } from './declared-lights.js';

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
