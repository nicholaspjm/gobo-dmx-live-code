/**
 * Fixture-definition validator.
 *
 * Gate for anything coming from untrusted sources: the public-library
 * glob, user-dropped `.lumen-fixture.json` files, and CI checks on PRs
 * that add to `fixtures/*.json`. Built-in fixtures hard-coded in
 * BUILT_IN_FIXTURES are trusted by construction and skip this path.
 *
 * The validator is strict on purpose — unknown keys, out-of-range
 * values, and id collisions with built-ins are all rejected with a
 * specific error message rather than silently coerced. Downstream code
 * can rely on a validated def having the exact shape it claims.
 *
 * What we're defending against:
 *   - Denial of service via absurd sizes (50k-pixel strips, etc.)
 *   - Shadowing built-ins by submitting `generic-rgbw` with a bogus def
 *   - Malformed content that would confuse downstream code paths
 *   - Path-traversal / shell-unsafe characters in ids (important because
 *     the id becomes a filename when exported)
 *
 * What this is NOT defending against:
 *   - Arbitrary code execution — the def is pure JSON, never eval'd.
 *   - Rendered HTML injection — the library UI HTML-escapes all text.
 *   - Logic errors in an otherwise-valid def (e.g. wrong channel offset
 *     for a real-world fixture). That's a review concern, not a
 *     validation concern.
 */

import {
  BUILT_IN_FIXTURES,
  type FixtureDef,
  type ChannelDef,
} from './fixtures.js';

// ─── Limits ──────────────────────────────────────────────────────────────────

/** Exported so the library UI / CI script can display them in error banners. */
export const FIXTURE_LIMITS = {
  MAX_ID_LEN: 64,
  MAX_NAME_LEN: 128,
  MAX_MANUFACTURER_LEN: 64,
  MAX_CHANNEL_COUNT: 512,
  MAX_CHANNELS: 128,
  MAX_PIXEL_COUNT: 512,
  MAX_CHANNEL_NAME_LEN: 32,
  /** Total DMX channels used by all strip-type channels combined. */
  MAX_STRIP_TOTAL_CHANNELS: 512,
} as const;

/** Allowed fixture `type` values. Mirrors FixtureDef.type. */
const VALID_FIXTURE_TYPES = new Set([
  'dimmer', 'rgb', 'rgba', 'rgbw', 'moving-head', 'strobe', 'generic',
]);

/** Allowed channel `type` values. Mirrors ChannelDef.type. */
const VALID_CHANNEL_TYPES = new Set([
  'intensity', 'color', 'position', 'strobe', 'control', 'generic', 'strip',
]);

const VALID_PIXEL_LAYOUTS = new Set(['rgb', 'rgbw']);

/** Permitted id characters — kebab-case-ish, no uppercase, no paths, no dots. */
const VALID_ID_RE = /^[a-z0-9][a-z0-9-]*$/;

/** Permitted channel name — identifier-ish. Allowed lowercase or camelCase so
 *  existing fixtures (direction, pixelCount, etc.) round-trip. */
const VALID_CHANNEL_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_-]*$/;

const VALID_TOP_LEVEL_DEF_KEYS = new Set([
  'name', 'manufacturer', 'type', 'channelCount', 'channels',
]);

const VALID_CHANNEL_KEYS = new Set([
  'offset', 'name', 'type', 'description', 'pixelCount', 'pixelLayout',
]);

// ─── Result type ─────────────────────────────────────────────────────────────

export type ValidationResult =
  | { ok: true; id: string; def: FixtureDef }
  | { ok: false; error: string };

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

/** Guard against a contributor accidentally sneaking an extra top-level key
 *  that might match a future schema field. Strict parsing forces the issue
 *  to surface in review rather than being silently accepted. */
function rejectUnknownKeys(
  obj: Record<string, unknown>,
  allowed: Set<string>,
  where: string,
): string | null {
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) {
      return `Unknown field "${key}" in ${where}.`;
    }
  }
  return null;
}

// ─── Main validator ──────────────────────────────────────────────────────────

/**
 * Validate a fixture id + def pair. Returns a tagged result with either
 * the cleaned `{ id, def }` (ok === true) or a specific `error` message.
 */
export function validateFixture(id: unknown, rawDef: unknown): ValidationResult {
  // ── id ──────────────────────────────────────────────────────────────
  if (typeof id !== 'string') {
    return { ok: false, error: 'Fixture id must be a string.' };
  }
  if (id.length === 0) return { ok: false, error: 'Fixture id is empty.' };
  if (id.length > FIXTURE_LIMITS.MAX_ID_LEN) {
    return { ok: false, error: `Fixture id longer than ${FIXTURE_LIMITS.MAX_ID_LEN} chars.` };
  }
  if (!VALID_ID_RE.test(id)) {
    return {
      ok: false,
      error:
        'Fixture id must match [a-z0-9][a-z0-9-]* (lowercase letters, digits, and hyphens, starting with a letter or digit).',
    };
  }
  if (id in BUILT_IN_FIXTURES) {
    return {
      ok: false,
      error: `Fixture id "${id}" collides with a built-in — pick a different name.`,
    };
  }

  // ── def shape ───────────────────────────────────────────────────────
  if (!isPlainObject(rawDef)) {
    return { ok: false, error: 'Fixture def must be a JSON object.' };
  }
  const unknownKeyErr = rejectUnknownKeys(rawDef, VALID_TOP_LEVEL_DEF_KEYS, 'fixture def');
  if (unknownKeyErr) return { ok: false, error: unknownKeyErr };

  const { name, manufacturer, type, channelCount, channels } = rawDef;

  if (typeof name !== 'string' || name.length === 0) {
    return { ok: false, error: 'Fixture name is required.' };
  }
  if (name.length > FIXTURE_LIMITS.MAX_NAME_LEN) {
    return { ok: false, error: `Fixture name longer than ${FIXTURE_LIMITS.MAX_NAME_LEN} chars.` };
  }

  if (typeof manufacturer !== 'string' || manufacturer.length === 0) {
    return { ok: false, error: 'Fixture manufacturer is required.' };
  }
  if (manufacturer.length > FIXTURE_LIMITS.MAX_MANUFACTURER_LEN) {
    return {
      ok: false,
      error: `Manufacturer longer than ${FIXTURE_LIMITS.MAX_MANUFACTURER_LEN} chars.`,
    };
  }

  if (typeof type !== 'string' || !VALID_FIXTURE_TYPES.has(type)) {
    return {
      ok: false,
      error: `Fixture type must be one of: ${[...VALID_FIXTURE_TYPES].join(', ')}.`,
    };
  }

  if (
    typeof channelCount !== 'number' ||
    !Number.isInteger(channelCount) ||
    channelCount < 1 ||
    channelCount > FIXTURE_LIMITS.MAX_CHANNEL_COUNT
  ) {
    return {
      ok: false,
      error: `channelCount must be an integer in [1, ${FIXTURE_LIMITS.MAX_CHANNEL_COUNT}].`,
    };
  }

  if (!Array.isArray(channels)) {
    return { ok: false, error: 'Fixture channels must be an array.' };
  }
  if (channels.length === 0) {
    return { ok: false, error: 'Fixture must have at least one channel.' };
  }
  if (channels.length > FIXTURE_LIMITS.MAX_CHANNELS) {
    return {
      ok: false,
      error: `Too many channel entries (max ${FIXTURE_LIMITS.MAX_CHANNELS}).`,
    };
  }

  // ── channels ────────────────────────────────────────────────────────
  const seenOffsets = new Set<number>();
  const seenNames = new Set<string>();
  let stripChannelsTotal = 0;
  const validatedChannels: ChannelDef[] = [];

  for (let i = 0; i < channels.length; i++) {
    const ch = channels[i];
    if (!isPlainObject(ch)) {
      return { ok: false, error: `Channel #${i} is not an object.` };
    }
    const unknown = rejectUnknownKeys(ch, VALID_CHANNEL_KEYS, `channel #${i}`);
    if (unknown) return { ok: false, error: unknown };

    const { offset, name: cName, type: cType, description, pixelCount, pixelLayout } = ch;

    if (typeof offset !== 'number' || !Number.isInteger(offset) || offset < 0) {
      return { ok: false, error: `Channel #${i}: offset must be a non-negative integer.` };
    }
    if (offset >= channelCount) {
      return {
        ok: false,
        error: `Channel #${i}: offset ${offset} is out of range for channelCount ${channelCount}.`,
      };
    }
    if (seenOffsets.has(offset)) {
      return { ok: false, error: `Channel #${i}: offset ${offset} is used twice.` };
    }
    seenOffsets.add(offset);

    if (typeof cName !== 'string' || !VALID_CHANNEL_NAME_RE.test(cName)) {
      return {
        ok: false,
        error: `Channel #${i}: name must match [a-zA-Z_][a-zA-Z0-9_-]*.`,
      };
    }
    if (cName.length > FIXTURE_LIMITS.MAX_CHANNEL_NAME_LEN) {
      return {
        ok: false,
        error: `Channel #${i}: name longer than ${FIXTURE_LIMITS.MAX_CHANNEL_NAME_LEN} chars.`,
      };
    }
    if (seenNames.has(cName)) {
      return { ok: false, error: `Channel #${i}: name "${cName}" is used twice.` };
    }
    seenNames.add(cName);

    if (typeof cType !== 'string' || !VALID_CHANNEL_TYPES.has(cType)) {
      return {
        ok: false,
        error: `Channel #${i}: type must be one of ${[...VALID_CHANNEL_TYPES].join(', ')}.`,
      };
    }

    if (description !== undefined && typeof description !== 'string') {
      return { ok: false, error: `Channel #${i}: description must be a string.` };
    }

    // Strip-specific validation
    const clean: ChannelDef = {
      offset,
      name: cName,
      type: cType as ChannelDef['type'],
    };
    if (description !== undefined) clean.description = description;

    if (cType === 'strip') {
      if (
        typeof pixelCount !== 'number' ||
        !Number.isInteger(pixelCount) ||
        pixelCount < 1 ||
        pixelCount > FIXTURE_LIMITS.MAX_PIXEL_COUNT
      ) {
        return {
          ok: false,
          error: `Channel #${i}: strip pixelCount must be an integer in [1, ${FIXTURE_LIMITS.MAX_PIXEL_COUNT}].`,
        };
      }
      clean.pixelCount = pixelCount;

      const layout = pixelLayout ?? 'rgb';
      if (typeof layout !== 'string' || !VALID_PIXEL_LAYOUTS.has(layout)) {
        return {
          ok: false,
          error: `Channel #${i}: pixelLayout must be one of ${[...VALID_PIXEL_LAYOUTS].join(', ')}.`,
        };
      }
      clean.pixelLayout = layout as 'rgb' | 'rgbw';

      const perPixel = layout === 'rgbw' ? 4 : 3;
      const stripChs = pixelCount * perPixel;
      stripChannelsTotal += stripChs;
      if (offset + stripChs > channelCount) {
        return {
          ok: false,
          error: `Channel #${i}: strip would extend to offset ${offset + stripChs - 1} past channelCount ${channelCount}.`,
        };
      }
    } else {
      if (pixelCount !== undefined) {
        return { ok: false, error: `Channel #${i}: pixelCount only valid on type 'strip'.` };
      }
      if (pixelLayout !== undefined) {
        return { ok: false, error: `Channel #${i}: pixelLayout only valid on type 'strip'.` };
      }
    }

    validatedChannels.push(clean);
  }

  if (stripChannelsTotal > FIXTURE_LIMITS.MAX_STRIP_TOTAL_CHANNELS) {
    return {
      ok: false,
      error: `Strip channels total ${stripChannelsTotal} exceeds max ${FIXTURE_LIMITS.MAX_STRIP_TOTAL_CHANNELS}.`,
    };
  }

  // ── ok ──────────────────────────────────────────────────────────────
  const def: FixtureDef = {
    name,
    manufacturer,
    type: type as FixtureDef['type'],
    channelCount,
    channels: validatedChannels,
  };
  return { ok: true, id, def };
}
