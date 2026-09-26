/**
 * Patching from the fixtures tab: the lines it writes, the names it picks and
 * where it thinks the next free address is.
 */

import { describe, it, expect } from 'vitest';

import {
  baseName,
  namesInUse,
  nextFreeAddress,
  patchInsertLine,
  pickNames,
  planPatch,
  plural,
} from './patch-builder.js';

const SIZES: Record<string, number> = { rgb: 3, rgbw: 4, 'dim-rgbw': 5, 'par-rgbw-7ch': 7, strobe: 2 };
const sizeOf = (id: string): number | undefined => SIZES[id];

describe('the lines', () => {
  it('writes one named light for one', () => {
    const r = planPatch({ id: 'par-rgbw-7ch', channelCount: 7, name: 'par', count: 1, start: 1, universe: 0 }, new Set());
    expect(r).toEqual({ ok: true, plan: { code: "const par = fixture(1, 'par-rgbw-7ch')", names: ['par'], first: 1, last: 7 } });
  });

  it('numbers several, steps the address by the channel count, and groups them', () => {
    const r = planPatch({ id: 'par-rgbw-7ch', channelCount: 7, name: 'par', count: 3, start: 10, universe: 1 }, new Set());
    expect(r.ok && r.plan.code).toBe([
      "const par1 = fixture(10, 'par-rgbw-7ch', 1)",
      "const par2 = fixture(17, 'par-rgbw-7ch', 1)",
      "const par3 = fixture(24, 'par-rgbw-7ch', 1)",
      'const pars = group(par1, par2, par3)',
    ].join('\n'));
    expect(r.ok && r.plan.last).toBe(30);
  });

  it('refuses a patch that runs past 512, and says how far', () => {
    const r = planPatch({ id: 'par-rgbw-7ch', channelCount: 7, name: 'par', count: 4, start: 500, universe: 0 }, new Set());
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain('channel 527');
  });

  it('refuses a name that is not one word', () => {
    expect(planPatch({ id: 'rgb', channelCount: 3, name: 'front wash', count: 1, start: 1, universe: 0 }, new Set()).ok).toBe(false);
    expect(planPatch({ id: 'rgb', channelCount: 3, name: '1wash', count: 1, start: 1, universe: 0 }, new Set()).ok).toBe(false);
  });
});

describe('names', () => {
  it('guesses what a rigger would call it', () => {
    expect(baseName('par-rgbw-7ch')).toBe('par');
    expect(baseName('strobe-4ch')).toBe('strb');
    expect(baseName('strobe')).toBe('strb');
    expect(baseName('moving-head-wash-14ch')).toBe('head');
    expect(baseName('pixel-bar-rgbw-8')).toBe('bar');
    expect(baseName('dim-rgbw')).toBe('wash');
    expect(baseName('dim')).toBe('dimmer');
    expect(baseName('atomic-strobe-154ch')).toBe('strb');
    expect(baseName('something-else', 'generic')).toBe('light');
  });

  it('never reuses a name the scene already has', () => {
    expect(pickNames('par', 1, new Set(['par']))).toEqual({ lights: ['par1'], group: null });
    expect(pickNames('par', 2, new Set(['par1', 'pars']))).toEqual({ lights: ['par2', 'par3'], group: 'pars2' });
  });

  it('reads the names a document binds', () => {
    expect([...namesInUse("const wash = fixture(1, 'rgb')\nlet x = 1\nfunction verse() {}")])
      .toEqual(['wash', 'x', 'verse']);
  });

  it('makes a plural', () => {
    expect(plural('par')).toBe('pars');
    expect(plural('wash')).toBe('washes');
  });
});

describe('the next free address', () => {
  it('starts at 1 in an empty scene', () => {
    expect(nextFreeAddress('', 0, sizeOf)).toBe(1);
  });

  it('follows the last light on that universe, whatever order they are written in', () => {
    const doc = [
      "const b = fixture(20, 'rgbw')",
      "const a = fixture(1, 'dim-rgbw')",
      'const s = rgbStrip(40, 10)',
      "const u1 = fixture(1, 'strobe', 1)",
    ].join('\n');
    expect(nextFreeAddress(doc, 0, sizeOf)).toBe(70);
    expect(nextFreeAddress(doc, 1, sizeOf)).toBe(3);
  });

  it('skips lights whose address or kind it cannot read', () => {
    expect(nextFreeAddress("const a = fixture(n, 'rgb')\nconst b = fixture(5, 'unknown')", 0, sizeOf)).toBe(1);
  });
});

describe('where the lines go', () => {
  it('under the last light declared', () => {
    const doc = "// c\nconst wash = fixture(1, 'rgb').viz('color')   // front\nwash.dim(1)\n";
    expect(patchInsertLine(doc)).toBe(2);
  });

  it('under the comments, output and tempo lines when there are no lights yet', () => {
    expect(patchInsertLine("// a\nartnet('2.255.255.255')\nsetBPM(120)\nsine()\n")).toBe(3);
    expect(patchInsertLine('')).toBe(0);
  });
});
