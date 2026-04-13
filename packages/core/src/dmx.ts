/**
 * DMX state manager.
 *
 * Holds per-universe channel buffers (512 channels, 0-indexed internally).
 * DMX functions accept a plain number OR any strudel-like Pattern object
 * (anything with queryArc(begin, end) → Array<{value: unknown}>).
 *
 * Number values:
 *   - 0 ≤ v ≤ 1   → treated as float, multiplied to 0-255
 *   - 1 < v ≤ 255 → treated as raw DMX integer
 *
 * Pattern values are queried at each tick; their value is expected to be 0–1.
 */

export interface PatternLike {
  queryArc(begin: number, end: number): Array<{ value: unknown }>;
}

export type PatternOrValue = number | PatternLike;

function isPattern(v: unknown): v is PatternLike {
  return typeof (v as PatternLike)?.queryArc === 'function';
}

// universe number (1-based) → 512-byte buffer
const _universes = new Map<number, Uint8Array>();

// Registered channel definitions: "uni:ch" → def
interface ChannelDef {
  universe: number;
  channel: number;
  value: PatternOrValue;
}
const _defs = new Map<string, ChannelDef>();

function getUniverse(n: number): Uint8Array {
  if (!_universes.has(n)) _universes.set(n, new Uint8Array(512));
  return _universes.get(n)!;
}

function key(universe: number, channel: number): string {
  return `${universe}:${channel}`;
}

// ─── Public DMX API ──────────────────────────────────────────────────────────

/** Set a channel on universe 1. channel is 1-indexed (1–512). */
export function ch(channel: number, value: PatternOrValue): void {
  uni(1, channel, value);
}

/** Set a channel on a specific universe. */
export function uni(universe: number, channel: number, value: PatternOrValue): void {
  _defs.set(key(universe, channel), { universe, channel, value });
}

/** Alias for ch() — set a dimmer channel. */
export function dim(channel: number, value: PatternOrValue): void {
  ch(channel, value);
}

/** Set RGB channels starting at startChannel (channels startChannel, +1, +2). */
export function rgb(
  startChannel: number,
  r: PatternOrValue,
  g: PatternOrValue,
  b: PatternOrValue,
): void {
  ch(startChannel, r);
  ch(startChannel + 1, g);
  ch(startChannel + 2, b);
}

// ─── Internal ─────────────────────────────────────────────────────────────────

/** Called by eval.ts before running new user code to wipe all defs. */
export function clearDefs(): void {
  _defs.clear();
  for (const buf of _universes.values()) buf.fill(0);
}

/** Called by the scheduler on each tick to resolve patterns → channel values. */
export function tick(cyclePos: number): void {
  // Zero all universe buffers
  for (const buf of _universes.values()) buf.fill(0);

  for (const def of _defs.values()) {
    const chIdx = def.channel - 1; // 1-indexed → 0-indexed
    if (chIdx < 0 || chIdx >= 512) continue;

    let floatVal: number;

    if (typeof def.value === 'number') {
      floatVal = def.value > 1 ? def.value / 255 : def.value;
    } else if (isPattern(def.value)) {
      // Query a thin arc so we get the instantaneous value
      const haps = def.value.queryArc(cyclePos, cyclePos + 0.0001);
      if (haps.length === 0) {
        floatVal = 0;
      } else {
        const v = haps[0].value;
        floatVal = typeof v === 'number' ? v : 0;
      }
    } else {
      floatVal = 0;
    }

    const buf = getUniverse(def.universe);
    buf[chIdx] = Math.round(Math.max(0, Math.min(1, floatVal)) * 255);
  }
}

export function getUniverseBuffer(universe: number): Uint8Array {
  return getUniverse(universe);
}

export function getAllUniverses(): Map<number, Uint8Array> {
  return _universes;
}

/** Returns a snapshot of universe 1 as a plain number array (for the visualizer). */
export function getUniverse1Snapshot(): number[] {
  return Array.from(getUniverse(1));
}
