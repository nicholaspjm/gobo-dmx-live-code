/**
 * Tests for the fixture-definition validator.
 *
 * This module is the CI gate for public fixture contributions
 * (`scripts/validate-fixtures.mjs` runs it over every file in `fixtures/`),
 * so the suite leans on boundary cases: for each documented limit there is a
 * pair of tests, one just inside and one just outside. Error strings are
 * asserted verbatim where they are stable — contributors read them in CI
 * output, so a reworded message is a change worth noticing.
 *
 * Two tests are marked `it.fails` — they assert behaviour the docs promise
 * but the validator does not implement. See the comments on each.
 */

import { describe, it, expect } from 'vitest';
import { validateFixture, FIXTURE_LIMITS, type ValidationResult } from './fixture-validator.js';
import { BUILT_IN_FIXTURES } from './fixtures.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

type Json = Record<string, unknown>;

/** A minimal-but-valid def. Every test mutates exactly one thing off this. */
function validDef(overrides: Json = {}): Json {
  return {
    name: 'Test PAR',
    manufacturer: 'Acme Lighting',
    type: 'rgb',
    channelCount: 3,
    channels: [
      { offset: 0, name: 'red', type: 'color' },
      { offset: 1, name: 'green', type: 'color' },
      { offset: 2, name: 'blue', type: 'color' },
    ],
    ...overrides,
  };
}

/** A def with a single channel of the caller's choosing. */
function defWithChannel(channel: Json, overrides: Json = {}): Json {
  return validDef({ channelCount: 1, channels: [channel], ...overrides });
}

/** A def whose only channel is a strip. */
function defWithStrip(strip: Json, channelCount: number): Json {
  return validDef({
    type: 'generic',
    channelCount,
    channels: [{ offset: 0, name: 'pixels', type: 'strip', ...strip }],
  });
}

/** Assert success and narrow the result. Failure surfaces the error message. */
function expectOk(result: ValidationResult): Extract<ValidationResult, { ok: true }> {
  if (!result.ok) {
    throw new Error(`expected validation to pass, got error: ${result.error}`);
  }
  return result;
}

/** Assert failure and hand back the error message for further assertions. */
function expectErr(result: ValidationResult): string {
  if (result.ok) {
    throw new Error(`expected validation to fail, but it passed with id "${result.id}"`);
  }
  expect(typeof result.error).toBe('string');
  expect(result.error.length).toBeGreaterThan(0);
  return result.error;
}

const repeat = (n: number, ch = 'a'): string => ch.repeat(n);

// ─── Happy paths ─────────────────────────────────────────────────────────────

describe('validateFixture — accepting valid definitions', () => {
  it('accepts a minimal one-channel fixture', () => {
    const result = validateFixture(
      'tiny-dimmer',
      defWithChannel({ offset: 0, name: 'dim', type: 'intensity' }, { type: 'dimmer' }),
    );
    const ok = expectOk(result);
    expect(ok.id).toBe('tiny-dimmer');
    expect(ok.def.channelCount).toBe(1);
    expect(ok.def.channels).toEqual([{ offset: 0, name: 'dim', type: 'intensity' }]);
  });

  it('accepts a realistic 38-channel pixel bar exercising every channel type', () => {
    const def = {
      name: 'Acme Pixel Bar 38ch',
      manufacturer: 'Acme Lighting',
      type: 'generic',
      channelCount: 38,
      channels: [
        { offset: 0, name: 'dim', type: 'intensity', description: 'Master dimmer' },
        { offset: 1, name: 'strobe', type: 'strobe', description: '0 = open' },
        { offset: 2, name: 'direction', type: 'position', description: 'Bar rotation' },
        { offset: 3, name: 'macro', type: 'control', description: 'Built-in macros' },
        { offset: 4, name: 'reserved', type: 'generic' },
        { offset: 5, name: 'amber', type: 'color', description: 'Amber emitter' },
        {
          offset: 6,
          name: 'pixels',
          type: 'strip',
          pixelCount: 8,
          pixelLayout: 'rgbw',
          description: '8 RGBW pixels',
        },
      ],
    };
    const ok = expectOk(validateFixture('acme-pixel-bar-38', def));
    expect(ok.def.channels).toHaveLength(7);
    // 8 pixels x 4 chs starting at offset 6 lands exactly on channelCount 38.
    expect(ok.def.channels[6]).toEqual({
      offset: 6,
      name: 'pixels',
      type: 'strip',
      description: '8 RGBW pixels',
      pixelCount: 8,
      pixelLayout: 'rgbw',
    });
  });

  it('accepts every documented fixture type', () => {
    for (const type of ['dimmer', 'rgb', 'rgba', 'rgbw', 'moving-head', 'strobe', 'generic']) {
      const ok = expectOk(validateFixture('t-' + type, validDef({ type })));
      expect(ok.def.type).toBe(type);
    }
  });

  it('accepts every documented channel type', () => {
    for (const type of ['intensity', 'color', 'position', 'strobe', 'control', 'generic']) {
      expectOk(validateFixture('c-' + type, defWithChannel({ offset: 0, name: 'x', type })));
    }
    // 'strip' needs pixelCount, so it gets its own construction.
    expectOk(validateFixture('c-strip', defWithStrip({ pixelCount: 1 }, 3)));
  });

  it('preserves channel order rather than sorting by offset', () => {
    const ok = expectOk(
      validateFixture(
        'unsorted',
        validDef({
          channels: [
            { offset: 2, name: 'blue', type: 'color' },
            { offset: 0, name: 'red', type: 'color' },
            { offset: 1, name: 'green', type: 'color' },
          ],
        }),
      ),
    );
    expect(ok.def.channels.map((c) => c.offset)).toEqual([2, 0, 1]);
  });

  it('omits an absent description rather than materialising it as undefined', () => {
    const ok = expectOk(
      validateFixture('no-desc', defWithChannel({ offset: 0, name: 'dim', type: 'intensity' })),
    );
    expect(Object.keys(ok.def.channels[0])).toEqual(['offset', 'name', 'type']);
  });

  it('keeps an empty-string description', () => {
    const ok = expectOk(
      validateFixture(
        'empty-desc',
        defWithChannel({ offset: 0, name: 'dim', type: 'intensity', description: '' }),
      ),
    );
    expect(ok.def.channels[0].description).toBe('');
  });

  it('returns a fresh def — mutating the result cannot reach the caller input', () => {
    const input = validDef();
    const ok = expectOk(validateFixture('fresh', input));
    expect(ok.def).not.toBe(input);
    expect(ok.def.channels).not.toBe(input.channels);
    expect(ok.def.channels[0]).not.toBe((input.channels as Json[])[0]);

    ok.def.name = 'mutated';
    ok.def.channels[0].offset = 99;
    expect(input.name).toBe('Test PAR');
    expect((input.channels as Json[])[0].offset).toBe(0);
  });
});

// ─── Result shape ────────────────────────────────────────────────────────────

describe('validateFixture — result shape', () => {
  it('returns exactly { ok, id, def } on success', () => {
    const result = validateFixture('shape-ok', validDef());
    expect(Object.keys(result).sort()).toEqual(['def', 'id', 'ok']);
    expect(result.ok).toBe(true);
  });

  it('returns exactly { ok, error } on failure — never a partial def', () => {
    const result = validateFixture('BAD ID', validDef());
    expect(Object.keys(result).sort()).toEqual(['error', 'ok']);
    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty('def');
    expect(result).not.toHaveProperty('id');
  });

  it('returns a def containing exactly the five schema fields', () => {
    const ok = expectOk(validateFixture('shape-def', validDef()));
    expect(Object.keys(ok.def).sort()).toEqual([
      'channelCount',
      'channels',
      'manufacturer',
      'name',
      'type',
    ]);
  });

  it('echoes the id back verbatim', () => {
    const ok = expectOk(validateFixture('echo-me-123', validDef()));
    expect(ok.id).toBe('echo-me-123');
  });
});

// ─── Exported limits ─────────────────────────────────────────────────────────

describe('FIXTURE_LIMITS', () => {
  it('matches the limits published in fixtures/README.md', () => {
    expect(FIXTURE_LIMITS).toEqual({
      MAX_ID_LEN: 64,
      MAX_NAME_LEN: 128,
      MAX_MANUFACTURER_LEN: 64,
      MAX_CHANNEL_COUNT: 512,
      MAX_CHANNELS: 128,
      MAX_PIXEL_COUNT: 512,
      MAX_CHANNEL_NAME_LEN: 32,
      MAX_STRIP_TOTAL_CHANNELS: 512,
    });
  });
});

// ─── id ──────────────────────────────────────────────────────────────────────

describe('fixture id', () => {
  it('rejects a non-string id', () => {
    for (const id of [42, null, undefined, true, ['a'], { a: 1 }]) {
      expect(expectErr(validateFixture(id, validDef()))).toBe('Fixture id must be a string.');
    }
  });

  it('rejects an empty id', () => {
    expect(expectErr(validateFixture('', validDef()))).toBe('Fixture id is empty.');
  });

  it('accepts an id of exactly 64 chars', () => {
    const id = repeat(FIXTURE_LIMITS.MAX_ID_LEN);
    expect(id).toHaveLength(64);
    expectOk(validateFixture(id, validDef()));
  });

  it('rejects an id of 65 chars', () => {
    const id = repeat(FIXTURE_LIMITS.MAX_ID_LEN + 1);
    expect(expectErr(validateFixture(id, validDef()))).toBe('Fixture id longer than 64 chars.');
  });

  it('checks id length before charset — an over-long bad-charset id reports length', () => {
    expect(expectErr(validateFixture(repeat(65, 'A'), validDef()))).toBe(
      'Fixture id longer than 64 chars.',
    );
  });

  it('accepts lowercase letters, digits and interior hyphens', () => {
    for (const id of ['a', '9', 'my-fixture', 'par-64-rgbw', '0-9', 'trailing-']) {
      expectOk(validateFixture(id, validDef()));
    }
  });

  it('rejects any character outside [a-z0-9-]', () => {
    const bad = [
      'Upper',
      'has space',
      'has_underscore',
      'has.dot',
      'has/slash',
      'has\\backslash',
      '../escape',
      'emoji-✨',
      'tab\there',
      'new\nline',
      'semi;colon',
      'star*',
    ];
    for (const id of bad) {
      expect(expectErr(validateFixture(id, validDef()))).toContain('[a-z0-9][a-z0-9-]*');
    }
  });

  it('rejects a leading hyphen (id must start with a letter or digit)', () => {
    expect(expectErr(validateFixture('-leading', validDef()))).toContain('[a-z0-9][a-z0-9-]*');
  });

  it('rejects collision with every built-in fixture id', () => {
    for (const id of Object.keys(BUILT_IN_FIXTURES)) {
      expect(expectErr(validateFixture(id, validDef()))).toBe(
        `Fixture id "${id}" collides with a built-in — pick a different name.`,
      );
    }
  });

  it('checks the id before looking at the def at all', () => {
    // Both are invalid; the id error wins.
    expect(expectErr(validateFixture('Bad Id', { nonsense: true }))).toContain(
      '[a-z0-9][a-z0-9-]*',
    );
  });

  it('checks built-in collision before validating the def', () => {
    expect(expectErr(validateFixture('rgbw', 'not even an object'))).toContain(
      'collides with a built-in',
    );
  });

  /**
   * Known quirk, pinned deliberately. The collision test is `id in
   * BUILT_IN_FIXTURES`, which walks the prototype chain, so the lone
   * all-lowercase Object.prototype member is reported as a built-in
   * collision. It fails closed (rejects), and "constructor" is a poor
   * fixture id anyway — but the message is misleading, and this test
   * exists so a future switch to Object.hasOwn is a conscious change.
   */
  it('rejects the id "constructor" as a built-in collision (prototype-chain quirk)', () => {
    expect(expectErr(validateFixture('constructor', validDef()))).toContain(
      'collides with a built-in',
    );
  });

  it('accepts lowercased near-misses of prototype members', () => {
    for (const id of ['tostring', 'valueof', 'hasownproperty']) {
      expectOk(validateFixture(id, validDef()));
    }
  });

  /**
   * KNOWN GAP — expected to fail.
   *
   * fixtures/README.md states: "Built-in fixture ids (`generic-dimmer`,
   * `generic-rgbw`, `moving-head-basic`, etc.) can't be reused — the
   * validator will reject a PR that tries."
   *
   * `moving-head-basic` is a real key of BUILT_IN_FIXTURES and is rejected.
   * `generic-dimmer` / `generic-rgbw` / `strobe-basic` and the rest of
   * FIXTURE_ALIASES are NOT — the validator only consults
   * BUILT_IN_FIXTURES, and FIXTURE_ALIASES is module-private to
   * fixtures.ts. A contributed fixture using one of those ids passes CI
   * but is unreachable at runtime, because resolveFixture() maps the
   * alias to the built-in before ever consulting the custom registry.
   *
   * Fix belongs in fixture-validator.ts (export the alias map from
   * fixtures.ts and check it too). Delete `.fails` once it lands.
   */
  it.fails('rejects collision with a legacy fixture alias', () => {
    for (const id of ['generic-dimmer', 'generic-rgb', 'generic-rgbw', 'strobe-basic']) {
      expectErr(validateFixture(id, validDef()));
    }
  });
});

// ─── def shape ───────────────────────────────────────────────────────────────

describe('def container', () => {
  it('rejects a def that is not a plain object', () => {
    for (const def of [null, undefined, 42, 'string', true, ['a']]) {
      expect(expectErr(validateFixture('some-id', def))).toBe('Fixture def must be a JSON object.');
    }
  });

  it('rejects an empty def with the first missing required field', () => {
    expect(expectErr(validateFixture('some-id', {}))).toBe('Fixture name is required.');
  });
});

// ─── name ────────────────────────────────────────────────────────────────────

describe('fixture name', () => {
  it('rejects a missing, empty, or non-string name', () => {
    for (const name of [undefined, '', 42, null, [], {}]) {
      expect(expectErr(validateFixture('n', validDef({ name })))).toBe('Fixture name is required.');
    }
  });

  it('accepts a name of exactly 128 chars', () => {
    expectOk(validateFixture('n', validDef({ name: repeat(FIXTURE_LIMITS.MAX_NAME_LEN) })));
  });

  it('rejects a name of 129 chars', () => {
    expect(
      expectErr(validateFixture('n', validDef({ name: repeat(FIXTURE_LIMITS.MAX_NAME_LEN + 1) }))),
    ).toBe('Fixture name longer than 128 chars.');
  });

  it('places no charset restriction on the name', () => {
    expectOk(validateFixture('n', validDef({ name: 'Chauvet COLORado 2 Solo — <b>&amp;</b>' })));
  });
});

// ─── manufacturer ────────────────────────────────────────────────────────────

describe('fixture manufacturer', () => {
  it('rejects a missing, empty, or non-string manufacturer', () => {
    for (const manufacturer of [undefined, '', 42, null, [], {}]) {
      expect(expectErr(validateFixture('m', validDef({ manufacturer })))).toBe(
        'Fixture manufacturer is required.',
      );
    }
  });

  it('accepts a manufacturer of exactly 64 chars', () => {
    expectOk(
      validateFixture('m', validDef({ manufacturer: repeat(FIXTURE_LIMITS.MAX_MANUFACTURER_LEN) })),
    );
  });

  it('rejects a manufacturer of 65 chars', () => {
    expect(
      expectErr(
        validateFixture(
          'm',
          validDef({ manufacturer: repeat(FIXTURE_LIMITS.MAX_MANUFACTURER_LEN + 1) }),
        ),
      ),
    ).toBe('Manufacturer longer than 64 chars.');
  });
});

// ─── type ────────────────────────────────────────────────────────────────────

describe('fixture type', () => {
  const expected =
    'Fixture type must be one of: dimmer, rgb, rgba, rgbw, moving-head, strobe, generic.';

  it('rejects an unknown type string', () => {
    expect(expectErr(validateFixture('t', validDef({ type: 'laser' })))).toBe(expected);
  });

  it('rejects a missing type', () => {
    expect(expectErr(validateFixture('t', validDef({ type: undefined })))).toBe(expected);
  });

  it('rejects a non-string type', () => {
    for (const type of [1, null, ['rgb'], { type: 'rgb' }, true]) {
      expect(expectErr(validateFixture('t', validDef({ type })))).toBe(expected);
    }
  });

  it('is case-sensitive', () => {
    expect(expectErr(validateFixture('t', validDef({ type: 'RGB' })))).toBe(expected);
  });

  it('rejects a channel-type value used as a fixture type', () => {
    expect(expectErr(validateFixture('t', validDef({ type: 'intensity' })))).toBe(expected);
  });
});

// ─── channelCount ────────────────────────────────────────────────────────────

describe('channelCount', () => {
  const expected = 'channelCount must be an integer in [1, 512].';

  it('accepts 1 (lower bound)', () => {
    expectOk(
      validateFixture('cc', defWithChannel({ offset: 0, name: 'dim', type: 'intensity' })),
    );
  });

  it('rejects 0 (just below the lower bound)', () => {
    expect(expectErr(validateFixture('cc', validDef({ channelCount: 0 })))).toBe(expected);
  });

  it('accepts 512 (upper bound)', () => {
    expectOk(validateFixture('cc', validDef({ channelCount: 512 })));
  });

  it('rejects 513 (just above the upper bound)', () => {
    expect(expectErr(validateFixture('cc', validDef({ channelCount: 513 })))).toBe(expected);
  });

  it('rejects negative, fractional, and non-finite counts', () => {
    for (const channelCount of [-1, -0.5, 3.5, NaN, Infinity, -Infinity]) {
      expect(expectErr(validateFixture('cc', validDef({ channelCount })))).toBe(expected);
    }
  });

  it('rejects a numeric string — no coercion', () => {
    expect(expectErr(validateFixture('cc', validDef({ channelCount: '3' })))).toBe(expected);
  });

  it('rejects a missing or null channelCount', () => {
    for (const channelCount of [undefined, null]) {
      expect(expectErr(validateFixture('cc', validDef({ channelCount })))).toBe(expected);
    }
  });
});

// ─── channels array ──────────────────────────────────────────────────────────

describe('channels array', () => {
  it('rejects a non-array channels value', () => {
    for (const channels of [undefined, null, {}, 'red,green', 3]) {
      expect(expectErr(validateFixture('ch', validDef({ channels })))).toBe(
        'Fixture channels must be an array.',
      );
    }
  });

  it('rejects an empty channels array', () => {
    expect(expectErr(validateFixture('ch', validDef({ channels: [] })))).toBe(
      'Fixture must have at least one channel.',
    );
  });

  it('accepts exactly 128 channel entries (upper bound)', () => {
    const channels = Array.from({ length: FIXTURE_LIMITS.MAX_CHANNELS }, (_, i) => ({
      offset: i,
      name: `c${i}`,
      type: 'generic',
    }));
    const ok = expectOk(
      validateFixture('ch', validDef({ channelCount: 128, channels, type: 'generic' })),
    );
    expect(ok.def.channels).toHaveLength(128);
  });

  it('rejects 129 channel entries (just above the upper bound)', () => {
    const channels = Array.from({ length: FIXTURE_LIMITS.MAX_CHANNELS + 1 }, (_, i) => ({
      offset: i,
      name: `c${i}`,
      type: 'generic',
    }));
    expect(
      expectErr(validateFixture('ch', validDef({ channelCount: 512, channels, type: 'generic' }))),
    ).toBe('Too many channel entries (max 128).');
  });

  it('rejects a channel entry that is not an object', () => {
    for (const bad of [null, 'red', 42, ['offset']]) {
      expect(expectErr(validateFixture('ch', validDef({ channels: [bad] })))).toBe(
        'Channel #0 is not an object.',
      );
    }
  });

  it('reports the index of the offending channel', () => {
    expect(
      expectErr(
        validateFixture(
          'ch',
          validDef({
            channels: [
              { offset: 0, name: 'red', type: 'color' },
              { offset: 1, name: 'green', type: 'color' },
              null,
            ],
          }),
        ),
      ),
    ).toBe('Channel #2 is not an object.');
  });
});

// ─── channel offset ──────────────────────────────────────────────────────────

describe('channel offset', () => {
  it('accepts offset 0 (lower bound)', () => {
    expectOk(validateFixture('o', defWithChannel({ offset: 0, name: 'dim', type: 'intensity' })));
  });

  it('rejects a negative offset', () => {
    expect(
      expectErr(
        validateFixture('o', defWithChannel({ offset: -1, name: 'dim', type: 'intensity' })),
      ),
    ).toBe('Channel #0: offset must be a non-negative integer.');
  });

  it('rejects a fractional, non-finite, string, or missing offset', () => {
    for (const offset of [0.5, NaN, Infinity, '0', null, undefined, true]) {
      expect(
        expectErr(
          validateFixture('o', defWithChannel({ offset, name: 'dim', type: 'intensity' })),
        ),
      ).toBe('Channel #0: offset must be a non-negative integer.');
    }
  });

  it('accepts an offset of channelCount - 1 (highest legal offset)', () => {
    expectOk(
      validateFixture(
        'o',
        validDef({ channelCount: 4, channels: [{ offset: 3, name: 'dim', type: 'intensity' }] }),
      ),
    );
  });

  it('rejects an offset equal to channelCount (one past the end)', () => {
    expect(
      expectErr(
        validateFixture(
          'o',
          validDef({ channelCount: 4, channels: [{ offset: 4, name: 'dim', type: 'intensity' }] }),
        ),
      ),
    ).toBe('Channel #0: offset 4 is out of range for channelCount 4.');
  });

  it('rejects an offset far beyond channelCount', () => {
    expect(
      expectErr(
        validateFixture(
          'o',
          validDef({ channelCount: 4, channels: [{ offset: 511, name: 'dim', type: 'intensity' }] }),
        ),
      ),
    ).toBe('Channel #0: offset 511 is out of range for channelCount 4.');
  });

  it('rejects a duplicate offset', () => {
    expect(
      expectErr(
        validateFixture(
          'o',
          validDef({
            channels: [
              { offset: 0, name: 'red', type: 'color' },
              { offset: 0, name: 'green', type: 'color' },
            ],
          }),
        ),
      ),
    ).toBe('Channel #1: offset 0 is used twice.');
  });
});

// ─── channel name ────────────────────────────────────────────────────────────

describe('channel name', () => {
  const expected = 'Channel #0: name must match [a-zA-Z_][a-zA-Z0-9_-]*.';

  it('accepts lowercase, camelCase, underscore-led, hyphenated and digit-bearing names', () => {
    for (const name of ['red', 'panFine', '_spare', 'color-wheel', 'gobo2', 'A']) {
      expectOk(validateFixture('cn', defWithChannel({ offset: 0, name, type: 'generic' })));
    }
  });

  it('rejects a name starting with a digit or hyphen', () => {
    for (const name of ['1red', '-red']) {
      expect(
        expectErr(validateFixture('cn', defWithChannel({ offset: 0, name, type: 'generic' }))),
      ).toBe(expected);
    }
  });

  it('rejects an empty, non-string, or missing name', () => {
    for (const name of ['', 42, null, undefined, ['red'], {}]) {
      expect(
        expectErr(validateFixture('cn', defWithChannel({ offset: 0, name, type: 'generic' }))),
      ).toBe(expected);
    }
  });

  it('rejects names containing spaces, dots or other punctuation', () => {
    for (const name of ['red channel', 'red.channel', 'red$', 'red/green', 'redé']) {
      expect(
        expectErr(validateFixture('cn', defWithChannel({ offset: 0, name, type: 'generic' }))),
      ).toBe(expected);
    }
  });

  it('accepts a channel name of exactly 32 chars', () => {
    expectOk(
      validateFixture(
        'cn',
        defWithChannel({
          offset: 0,
          name: repeat(FIXTURE_LIMITS.MAX_CHANNEL_NAME_LEN),
          type: 'generic',
        }),
      ),
    );
  });

  it('rejects a channel name of 33 chars', () => {
    expect(
      expectErr(
        validateFixture(
          'cn',
          defWithChannel({
            offset: 0,
            name: repeat(FIXTURE_LIMITS.MAX_CHANNEL_NAME_LEN + 1),
            type: 'generic',
          }),
        ),
      ),
    ).toBe('Channel #0: name longer than 32 chars.');
  });

  it('rejects a duplicate channel name', () => {
    expect(
      expectErr(
        validateFixture(
          'cn',
          validDef({
            channels: [
              { offset: 0, name: 'red', type: 'color' },
              { offset: 1, name: 'red', type: 'color' },
            ],
          }),
        ),
      ),
    ).toBe('Channel #1: name "red" is used twice.');
  });

  it('treats channel names case-sensitively for the duplicate check', () => {
    expectOk(
      validateFixture(
        'cn',
        validDef({
          channels: [
            { offset: 0, name: 'red', type: 'color' },
            { offset: 1, name: 'Red', type: 'color' },
          ],
          channelCount: 2,
        }),
      ),
    );
  });
});

// ─── channel type ────────────────────────────────────────────────────────────

describe('channel type', () => {
  const expected =
    'Channel #0: type must be one of intensity, color, position, strobe, control, generic, strip.';

  it('rejects an unknown channel type', () => {
    expect(
      expectErr(validateFixture('ct', defWithChannel({ offset: 0, name: 'x', type: 'colour' }))),
    ).toBe(expected);
  });

  it('rejects a missing or non-string channel type', () => {
    for (const type of [undefined, null, 3, ['color'], true]) {
      expect(
        expectErr(validateFixture('ct', defWithChannel({ offset: 0, name: 'x', type }))),
      ).toBe(expected);
    }
  });

  it('is case-sensitive', () => {
    expect(
      expectErr(validateFixture('ct', defWithChannel({ offset: 0, name: 'x', type: 'Color' }))),
    ).toBe(expected);
  });

  it('rejects a fixture-type value used as a channel type', () => {
    expect(
      expectErr(validateFixture('ct', defWithChannel({ offset: 0, name: 'x', type: 'rgbw' }))),
    ).toBe(expected);
  });
});

// ─── channel description ─────────────────────────────────────────────────────

describe('channel description', () => {
  it('is optional', () => {
    expectOk(validateFixture('d', defWithChannel({ offset: 0, name: 'x', type: 'generic' })));
  });

  it('rejects a non-string description', () => {
    for (const description of [42, null, ['a'], {}, true]) {
      expect(
        expectErr(
          validateFixture('d', defWithChannel({ offset: 0, name: 'x', type: 'generic', description })),
        ),
      ).toBe('Channel #0: description must be a string.');
    }
  });
});

// ─── strip channels ──────────────────────────────────────────────────────────

describe('strip channels', () => {
  const rangeErr = 'Channel #0: strip pixelCount must be an integer in [1, 512].';

  it('accepts pixelCount 1 (lower bound)', () => {
    const ok = expectOk(validateFixture('s', defWithStrip({ pixelCount: 1 }, 3)));
    expect(ok.def.channels[0].pixelCount).toBe(1);
  });

  it('rejects pixelCount 0 (just below the lower bound)', () => {
    expect(expectErr(validateFixture('s', defWithStrip({ pixelCount: 0 }, 3)))).toBe(rangeErr);
  });

  it('rejects a negative, fractional, non-finite, string or missing pixelCount', () => {
    for (const pixelCount of [-1, 4.5, NaN, Infinity, '8', null, undefined]) {
      expect(expectErr(validateFixture('s', defWithStrip({ pixelCount }, 512)))).toBe(rangeErr);
    }
  });

  it('rejects pixelCount 513 (just above the upper bound) at the pixelCount check', () => {
    expect(
      expectErr(validateFixture('s', defWithStrip({ pixelCount: FIXTURE_LIMITS.MAX_PIXEL_COUNT + 1 }, 512))),
    ).toBe(rangeErr);
  });

  it('lets pixelCount 512 past the range check — it fails later on extent, not range', () => {
    // 512 px x 3 chs = 1536 > any legal channelCount, so this can never
    // actually pass. The point is *which* error fires: proving 512 is
    // inside the pixelCount bound and 513 is outside it.
    const error = expectErr(
      validateFixture('s', defWithStrip({ pixelCount: FIXTURE_LIMITS.MAX_PIXEL_COUNT }, 512)),
    );
    expect(error).not.toBe(rangeErr);
    expect(error).toBe(
      'Channel #0: strip would extend to offset 1535 past channelCount 512.',
    );
  });

  it('defaults pixelLayout to rgb when absent and normalises it onto the output', () => {
    const ok = expectOk(validateFixture('s', defWithStrip({ pixelCount: 4 }, 12)));
    expect(ok.def.channels[0].pixelLayout).toBe('rgb');
  });

  it('accepts an explicit rgb or rgbw layout', () => {
    expect(
      expectOk(validateFixture('s', defWithStrip({ pixelCount: 4, pixelLayout: 'rgb' }, 12)))
        .def.channels[0].pixelLayout,
    ).toBe('rgb');
    expect(
      expectOk(validateFixture('s', defWithStrip({ pixelCount: 4, pixelLayout: 'rgbw' }, 16)))
        .def.channels[0].pixelLayout,
    ).toBe('rgbw');
  });

  it('rejects an unknown pixelLayout', () => {
    for (const pixelLayout of ['grb', 'rgbww', 'RGB', 5, ['rgb']]) {
      expect(
        expectErr(validateFixture('s', defWithStrip({ pixelCount: 4, pixelLayout }, 512))),
      ).toBe('Channel #0: pixelLayout must be one of rgb, rgbw.');
    }
  });

  it('accepts a strip that ends exactly on the last channel', () => {
    // 8 px x 3 chs = 24, starting at offset 0, channelCount 24.
    expectOk(validateFixture('s', defWithStrip({ pixelCount: 8 }, 24)));
  });

  it('rejects a strip that overruns channelCount by one', () => {
    expect(expectErr(validateFixture('s', defWithStrip({ pixelCount: 8 }, 23)))).toBe(
      'Channel #0: strip would extend to offset 23 past channelCount 23.',
    );
  });

  it('accounts for the strip offset when computing the extent', () => {
    const at1 = validDef({
      type: 'generic',
      channelCount: 25,
      channels: [{ offset: 1, name: 'pixels', type: 'strip', pixelCount: 8 }],
    });
    expectOk(validateFixture('s', at1));

    const at2 = validDef({
      type: 'generic',
      channelCount: 25,
      channels: [{ offset: 2, name: 'pixels', type: 'strip', pixelCount: 8 }],
    });
    expect(expectErr(validateFixture('s', at2))).toBe(
      'Channel #0: strip would extend to offset 25 past channelCount 25.',
    );
  });

  it('uses 4 channels per pixel for an rgbw layout', () => {
    expectOk(validateFixture('s', defWithStrip({ pixelCount: 8, pixelLayout: 'rgbw' }, 32)));
    expect(
      expectErr(validateFixture('s', defWithStrip({ pixelCount: 8, pixelLayout: 'rgbw' }, 31))),
    ).toBe('Channel #0: strip would extend to offset 31 past channelCount 31.');
  });

  it('accepts a combined strip total of exactly 512 channels (upper bound)', () => {
    // 4 rgbw strips x 32 px x 4 chs = 128 each -> 512 total.
    const channels = [0, 1, 2, 3].map((i) => ({
      offset: i,
      name: `strip${i}`,
      type: 'strip',
      pixelCount: 32,
      pixelLayout: 'rgbw',
    }));
    expectOk(validateFixture('s', validDef({ type: 'generic', channelCount: 512, channels })));
  });

  it('rejects a combined strip total of 513 channels (just above the upper bound)', () => {
    // 3 rgb strips x 57 px x 3 chs = 171 each -> 513 total. Each strip on
    // its own fits inside channelCount 512; only the sum breaks the limit.
    const channels = [0, 1, 2].map((i) => ({
      offset: i,
      name: `strip${i}`,
      type: 'strip',
      pixelCount: 57,
    }));
    expect(
      expectErr(validateFixture('s', validDef({ type: 'generic', channelCount: 512, channels }))),
    ).toBe('Strip channels total 513 exceeds max 512.');
  });

  it('rejects pixelCount on a non-strip channel', () => {
    expect(
      expectErr(
        validateFixture(
          's',
          defWithChannel({ offset: 0, name: 'dim', type: 'intensity', pixelCount: 4 }),
        ),
      ),
    ).toBe("Channel #0: pixelCount only valid on type 'strip'.");
  });

  it('rejects pixelLayout on a non-strip channel', () => {
    expect(
      expectErr(
        validateFixture(
          's',
          defWithChannel({ offset: 0, name: 'dim', type: 'intensity', pixelLayout: 'rgb' }),
        ),
      ),
    ).toBe("Channel #0: pixelLayout only valid on type 'strip'.");
  });

  it('reports pixelCount before pixelLayout when a non-strip channel carries both', () => {
    expect(
      expectErr(
        validateFixture(
          's',
          defWithChannel({
            offset: 0,
            name: 'dim',
            type: 'intensity',
            pixelCount: 4,
            pixelLayout: 'rgb',
          }),
        ),
      ),
    ).toBe("Channel #0: pixelCount only valid on type 'strip'.");
  });

  it('rejects a strip channel with no pixelCount at all', () => {
    expect(
      expectErr(validateFixture('s', defWithChannel({ offset: 0, name: 'pixels', type: 'strip' }))),
    ).toBe(rangeErr);
  });

  /**
   * KNOWN GAP — expected to fail.
   *
   * `const layout = pixelLayout ?? 'rgb'` uses nullish coalescing, so an
   * explicit JSON `null` is silently coerced to 'rgb' rather than
   * rejected. Every other wrong-type value in this module is rejected,
   * and the module docstring promises out-of-range values are "rejected
   * with a specific error message rather than silently coerced" — so
   * null is the one hole. `pixelLayout: undefined` legitimately means
   * "absent"; `null` does not.
   *
   * Fix belongs in fixture-validator.ts (test for `undefined` explicitly,
   * or run the VALID_PIXEL_LAYOUTS check before defaulting). Delete
   * `.fails` once it lands.
   */
  it.fails('rejects an explicit null pixelLayout instead of defaulting it to rgb', () => {
    expectErr(validateFixture('s', defWithStrip({ pixelCount: 4, pixelLayout: null }, 12)));
  });
});

// ─── unknown fields ──────────────────────────────────────────────────────────

describe('unknown fields', () => {
  it('rejects an unknown top-level def field', () => {
    for (const key of ['id', 'version', 'notes', 'mode', 'channelcount']) {
      expect(expectErr(validateFixture('u', validDef({ [key]: 'whatever' })))).toBe(
        `Unknown field "${key}" in fixture def.`,
      );
    }
  });

  it('rejects the whole envelope pasted in as the def', () => {
    // A contributor passing the file contents rather than `parsed.def`.
    const envelope = { lumenFixture: 1, id: 'my-par', def: validDef() };
    expect(expectErr(validateFixture('u', envelope))).toBe(
      'Unknown field "lumenFixture" in fixture def.',
    );
  });

  it('rejects an unknown channel field', () => {
    for (const key of ['min', 'max', 'default', 'invert', 'Offset']) {
      expect(
        expectErr(
          validateFixture(
            'u',
            defWithChannel({ offset: 0, name: 'dim', type: 'intensity', [key]: 1 }),
          ),
        ),
      ).toBe(`Unknown field "${key}" in channel #0.`);
    }
  });

  it('names the offending channel index for an unknown channel field', () => {
    expect(
      expectErr(
        validateFixture(
          'u',
          validDef({
            channels: [
              { offset: 0, name: 'red', type: 'color' },
              { offset: 1, name: 'green', type: 'color', curve: 'linear' },
            ],
          }),
        ),
      ),
    ).toBe('Unknown field "curve" in channel #1.');
  });

  it('rejects an unknown field even when its value is undefined', () => {
    expect(expectErr(validateFixture('u', validDef({ extra: undefined })))).toBe(
      'Unknown field "extra" in fixture def.',
    );
  });

  it('rejects an own __proto__ key smuggled in via JSON.parse', () => {
    const def = JSON.parse('{"__proto__": {"polluted": true}}');
    expect(expectErr(validateFixture('u', def))).toBe('Unknown field "__proto__" in fixture def.');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('checks unknown top-level keys before any field validation', () => {
    // Both wrong; the unknown-key error wins.
    expect(expectErr(validateFixture('u', { rogue: 1 }))).toBe(
      'Unknown field "rogue" in fixture def.',
    );
  });

  it('checks unknown channel keys before the offset check', () => {
    expect(
      expectErr(
        validateFixture('u', defWithChannel({ offset: -5, name: 'dim', type: 'intensity', rogue: 1 })),
      ),
    ).toBe('Unknown field "rogue" in channel #0.');
  });
});

// ─── schema version envelope ─────────────────────────────────────────────────

describe('schema version (lumenFixture)', () => {
  /**
   * The `lumenFixture` version field lives on the file envelope, not on
   * the def — scripts/validate-fixtures.mjs checks `parsed.lumenFixture
   * !== 1` and only then calls validateFixture(parsed.id, parsed.def).
   * These tests pin that split so nobody moves the check by accident.
   */

  it('is not the validator concern — a def with no version still validates', () => {
    expectOk(validateFixture('v', validDef()));
  });

  it('rejects a correct version value carried inside the def', () => {
    expect(expectErr(validateFixture('v', validDef({ lumenFixture: 1 })))).toBe(
      'Unknown field "lumenFixture" in fixture def.',
    );
  });

  it('rejects a wrong version value carried inside the def', () => {
    for (const lumenFixture of [0, 2, 99]) {
      expect(expectErr(validateFixture('v', validDef({ lumenFixture })))).toBe(
        'Unknown field "lumenFixture" in fixture def.',
      );
    }
  });

  it('rejects a wrong-typed version value carried inside the def', () => {
    for (const lumenFixture of ['1', null, true, {}, []]) {
      expect(expectErr(validateFixture('v', validDef({ lumenFixture })))).toBe(
        'Unknown field "lumenFixture" in fixture def.',
      );
    }
  });
});

// ─── documented non-goals ────────────────────────────────────────────────────

describe('documented non-goals', () => {
  /**
   * The module docstring scopes these out explicitly: "Logic errors in an
   * otherwise-valid def (e.g. wrong channel offset for a real-world
   * fixture). That's a review concern, not a validation concern."
   * Pinned so a future tightening is a deliberate decision rather than a
   * surprise to contributors whose fixtures suddenly stop validating.
   */

  it('does not detect a scalar channel sitting inside a strip span', () => {
    // The strip claims offsets 0-8; 'dim' at 4 overlaps it. Only the
    // strip's *starting* offset participates in the duplicate check.
    expectOk(
      validateFixture(
        'overlap',
        validDef({
          type: 'generic',
          channelCount: 10,
          channels: [
            { offset: 0, name: 'pixels', type: 'strip', pixelCount: 3 },
            { offset: 4, name: 'dim', type: 'intensity' },
          ],
        }),
      ),
    );
  });

  it('does not require channels to cover every channel in channelCount', () => {
    expectOk(
      validateFixture(
        'sparse',
        validDef({ channelCount: 512, channels: [{ offset: 0, name: 'dim', type: 'intensity' }] }),
      ),
    );
  });

  it('does not require the fixture type to match the channels present', () => {
    // Declared 'rgbw' with only a dimmer channel — semantically wrong,
    // structurally valid.
    expectOk(
      validateFixture(
        'mismatched',
        validDef({
          type: 'rgbw',
          channelCount: 1,
          channels: [{ offset: 0, name: 'dim', type: 'intensity' }],
        }),
      ),
    );
  });
});
