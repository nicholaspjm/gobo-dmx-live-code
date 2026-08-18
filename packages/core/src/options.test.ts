/**
 * Options bags used to swallow every key they did not recognise, so the
 * likeliest mistake — reaching for the neighbouring call's spelling — was the
 * one thing nothing reported. A misspelt `columns` was a silent single row.
 */

import { describe, it, expect } from 'vitest';
import { checkOptions } from './colors.js';
import { rgbStrip, rgbwStrip, monoStrip, setStripEffectWaveforms } from './fixtures.js';
import { COLORS } from './colors.js';
import { clearDefs } from './dmx.js';

describe('checkOptions', () => {
  it('says nothing when every key is known', () => {
    expect(() => checkOptions({ columns: 4 }, ['columns', 'origin'], 'rgbStrip()')).not.toThrow();
    expect(() => checkOptions(undefined, ['columns'], 'rgbStrip()')).not.toThrow();
  });

  it('names the call, the key and what is accepted', () => {
    expect(() => checkOptions({ nope: 1 }, ['columns', 'origin'], 'rgbStrip()'))
      .toThrow(/rgbStrip\(\): no option named "nope"\. Accepts: columns, origin\./);
  });

  it('suggests the key one typo away', () => {
    expect(() => checkOptions({ colums: 12 }, ['columns'], 'rgbStrip()'))
      .toThrow(/Did you mean columns \(not colums\)\?/);
  });

  it('catches a wrong-case key as a near miss', () => {
    expect(() => checkOptions({ Columns: 12 }, ['columns'], 'rgbStrip()'))
      .toThrow(/Did you mean columns/);
  });

  it('reports every unknown key at once', () => {
    expect(() => checkOptions({ a: 1, b: 2 }, ['columns'], 'screen()'))
      .toThrow(/no options named "a", "b"/);
  });

  it('accepts internal keys without advertising them', () => {
    const e = (() => {
      try { checkOptions({ simLabel: 'x', bad: 1 }, ['columns'], 'rgbStrip()', ['simLabel']); }
      catch (err) { return (err as Error).message; }
      return '';
    })();
    expect(e).toContain('"bad"');
    expect(e).not.toContain('simLabel');
  });
});

describe('the bags on the authoring surface', () => {
  it('rejects a misspelt strip option instead of laying out one row', () => {
    expect(() => rgbStrip(1, 48, 0, { colums: 12 } as never))
      .toThrow(/rgbStrip\(\).*columns/s);
    expect(() => rgbwStrip(1, 8, 0, { orgin: 'top-right' } as never)).toThrow(/rgbwStrip\(\)/);
    expect(() => monoStrip(1, 8, 0, { pixelCount: 8 } as never)).toThrow(/monoStrip\(\)/);
  });

  it('still accepts what fixture() passes its embedded strip', () => {
    expect(() => rgbStrip(1, 4, 0, { columns: 2, simLabel: 'wash · pixels', skipSim: true } as never))
      .not.toThrow();
  });

  it("rejects the other chase's option names", () => {
    // The two chases spell the same three knobs differently, which is exactly
    // the mistake this check exists to catch.
    clearDefs();
    setStripEffectWaveforms((() => ({ queryArc: () => [], early() { return this; }, slow() { return this; }, range() { return this; }, mul() { return this; } })) as never, (() => ({})) as never);
    const strip = rgbStrip(1, 4, 0, { skipSim: true });
    expect(() => strip.chase(COLORS.red, { speed: 2 } as never)).toThrow(/\.chase\(\).*speed/s);
    expect(() => strip.rainbowChase({ cycles: 2 } as never)).toThrow(/\.rainbowChase\(\).*cycles/s);
  });
});
