/**
 * The screen as a light.
 *
 * A fixture with no DMX address: `screen()` claims a region of the page and
 * drives it from the same patterns as everything else. It exists because the
 * rig is usually somewhere else. Writing a cue on a laptop with no hardware
 * attached, checking a chase reads the way you meant, showing someone what a
 * scene does: all of that needed a light in the room, and now it does not.
 *
 * It is a real fixture, not a preview. The same setters, the same patterns,
 * the same grid. A scene written against the screen runs on a wash by
 * changing which line built it.
 *
 * Values live in an ordinary DMX universe, so nothing about the engine or the
 * scheduler is special-cased: the screen picks a universe well above anything
 * a real rig uses and renders whatever lands there. That also means a screen
 * fixture can be grouped with real ones and driven by one `each()`.
 */

import { getUniverseBuffer } from './dmx.js';
import { checkOptions } from './colors.js';
import { rgbStrip, type StripInstance } from './fixtures.js';

/**
 * Universe the screen renders from.
 *
 * Deliberately far above the range a rig would use, so a scene that also
 * drives real fixtures never collides with it. Art-Net tops out at 32767 and
 * sACN at 63999; nothing sane addresses this one.
 */
export const SCREEN_UNIVERSE = 30000;

/** A screen light that has been declared by the running scene. */
export interface ScreenPanel {
  /** Where its pixels start in the screen universe. */
  readonly startChannel: number;
  readonly width: number;
  readonly height: number;
  readonly pixelCount: number;
  /** Label shown on the panel, so several are tellable apart. */
  readonly label: string;
}

// Panels declared by the scene currently being evaluated. Rebuilt on every
// run, the same as the sim and viz registries, so removing a screen() line
// removes the panel.
let _panels: ScreenPanel[] = [];

// Next free channel in the screen universe. Reset with the registry.
let _nextChannel = 1;

/** Forget every declared panel. Called at the start of each evaluation. */
export function clearScreens(): void {
  _panels = [];
  _nextChannel = 1;
}

/** The panels the current scene declared, in the order it declared them. */
export function getScreens(): readonly ScreenPanel[] {
  return _panels;
}

/**
 * A light made of screen rather than lamps.
 *
 * With no arguments it is a single colour wash, which is the common case: one
 * rectangle that takes a colour. Give it a pixel count and it becomes a strip;
 * give it `columns` as well and it becomes a grid, addressable with pixelXY
 * and eachXY exactly like a physical pixel wash.
 *
 * Takes `columns` but not `origin` or `serpentine`: those describe how a strip
 * is physically wired, and a screen has no wiring. Its pixel 0 is the top left
 * because that is where it is drawn.
 *
 * @param pixels  how many cells (default 1, a plain wash)
 * @param opts    columns for a grid, and a label for the panel
 *
 * @example
 *   const room = screen()                        // one big colour wash
 *   room.fill(sine().slow(4), 0, cosine().slow(4))
 *
 *   const wall = screen(48, { columns: 12 })     // a 12 x 4 video wall
 *   wall.eachXY((x, y, w) => sine().early(x / w).slow(4))
 */
export function screen(
  pixels = 1,
  opts: { label?: string; columns?: number } = {},
): StripInstance {
  checkOptions(opts as Record<string, unknown>, ['label', 'columns'], 'screen()');
  if (!Number.isInteger(pixels) || pixels < 1) {
    throw new Error(`screen: pixel count must be an integer >= 1 (got ${pixels})`);
  }
  const channelsNeeded = pixels * 3;
  if (_nextChannel + channelsNeeded - 1 > 512) {
    throw new Error(
      `screen: ${pixels} pixels do not fit alongside the screens already declared. ` +
      `A universe holds 512 channels and a screen pixel takes 3, so about 170 in total.`,
    );
  }

  const startChannel = _nextChannel;
  _nextChannel += channelsNeeded;

  const strip = rgbStrip(startChannel, pixels, SCREEN_UNIVERSE, {
    columns: opts.columns,
    // Kept out of the hardware sim panel: it draws itself, and a second ghost
    // of it among the real fixtures would suggest there is hardware here.
    skipSim: true,
  });

  _panels.push({
    startChannel,
    width: strip.width,
    height: strip.height,
    pixelCount: pixels,
    label: opts.label ?? (pixels === 1 ? 'screen' : `screen ×${pixels}`),
  });

  return strip;
}

/**
 * Read a panel's current colours, one `[r, g, b]` per cell in picture order.
 *
 * The renderer calls this every frame. It reads the universe buffer directly
 * rather than the pattern, so what is drawn is exactly what a real fixture on
 * those channels would receive, clamping and all.
 */
export function readScreen(panel: ScreenPanel): Array<[number, number, number]> {
  const buf = getUniverseBuffer(SCREEN_UNIVERSE);
  const out: Array<[number, number, number]> = [];
  const base = panel.startChannel - 1;
  for (let i = 0; i < panel.pixelCount; i++) {
    const p = base + i * 3;
    out.push([buf[p] ?? 0, buf[p + 1] ?? 0, buf[p + 2] ?? 0]);
  }
  return out;
}
