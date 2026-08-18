import { describe, it, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';

import { clearDefs, getUniverseBuffer } from './dmx.js';
import { defineFixture, fixture, monoStrip, rgbStrip } from './fixtures.js';
import { screen, clearScreens } from './screen.js';

const raw = JSON.parse(
  readFileSync(
    'C:/Users/Admin/Documents/dmx-live-code/fixtures/atomic-strobe-154ch.json',
    'utf8',
  ),
);

beforeEach(() => {
  clearDefs();
  clearScreens();
  getUniverseBuffer(0).fill(0);
});

function msg(fn: () => void): string {
  try {
    fn();
    return '(no throw)';
  } catch (e) {
    return (e as Error).message;
  }
}

describe('geometry error labels', () => {
  it('prints them', () => {
    defineFixture(raw.id, raw.def);
    const atomic: any = fixture(1, raw.id);
    // eslint-disable-next-line no-console
    const log = (k: string, v: string) => console.log('PROBE', k, '->', v);

    log('mono .pixel(9,1)', msg(() => atomic.strip.pixel(9, 1)));
    log("mono .pixel(3,'x')", msg(() => atomic.strip.pixel(3, 'x')));
    log('mono .pixelXY(9,0,1)', msg(() => atomic.strip.pixelXY(9, 0, 1)));
    log('mono .row(2,1)', msg(() => atomic.strip.row(2, 1)));
    log("mono .row(0,'x')", msg(() => atomic.strip.row(0, 'x')));
    log('rgb .pixelXY(12,0,1,0,0)', msg(() => atomic.pixels.pixelXY(12, 0, 1, 0, 0)));
    log('rgb .pixel(48,1,0,0)', msg(() => atomic.pixels.pixel(48, 1, 0, 0)));
    log("rgb .pixel(3,'x')", msg(() => atomic.pixels.pixel(3, 'x')));
    log('rgb .column(20,1,0,0)', msg(() => atomic.pixels.column(20, 1, 0, 0)));
    log('screen(48,{columns:7})', msg(() => screen(48, { columns: 7 })));
    log('screen pixelXY oob', msg(() => screen(12, { columns: 4 }).pixelXY(9, 0, 1, 0, 0)));
    log('bare rgbStrip cols', msg(() => rgbStrip(1, 10, 0, { columns: 3 })));
    log('bare monoStrip pixelXY', msg(() => monoStrip(1, 8, 0, { columns: 4 }).pixelXY(9, 0, 1)));
  });
});
