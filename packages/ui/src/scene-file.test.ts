/**
 * Tests for scene file save / open.
 *
 * The suite covers the two pure halves — parseSceneText() and the filename
 * sanitiser — because they are where the decisions live. downloadScene() and
 * openSceneFile() are thin DOM wrappers over them and the default test
 * environment is node, so they are exercised only through the format they
 * agree on (an envelope built here matches the one downloadScene writes).
 *
 * The load-bearing case is the third one down: JSON that is NOT an envelope
 * must open as code. A scene is JavaScript, and rejecting a file because it
 * happens to parse as JSON would lock the user out of their own set.
 */

import { describe, it, expect } from 'vitest';
import { parseSceneText, sceneFilename, type SceneFile } from './scene-file.js';

/** An envelope in exactly the shape downloadScene() writes. */
function envelope(overrides: Record<string, unknown> = {}): string {
  const base: SceneFile = {
    goboScene: 1,
    name: 'ultratronics 11',
    code: "artnet('2.0.0.100')\nsetBPM(108)\n",
    savedAt: '2026-08-13T19:04:11.912Z',
  };
  return JSON.stringify({ ...base, ...overrides }, null, 2);
}

/** Build a string containing a raw control character without writing an
 *  escape sequence into this file. */
function ctrl(code: number): string {
  return String.fromCharCode(code);
}

// ─── Envelopes ───────────────────────────────────────────────────────────────

describe('parseSceneText — .gobo envelopes', () => {
  it('reads a valid envelope, preferring its name over the filename', () => {
    const result = parseSceneText(envelope(), 'downloaded (3).gobo');
    expect(result).toEqual({
      ok: true,
      name: 'ultratronics 11',
      code: "artnet('2.0.0.100')\nsetBPM(108)\n",
    });
  });

  it('preserves the code byte-for-byte, including trailing newlines', () => {
    const code = 'line one\n\n  indented\n\n';
    const result = parseSceneText(envelope({ code }), 'x.gobo');
    expect(result.ok && result.code).toBe(code);
  });

  it('accepts an envelope regardless of the file extension', () => {
    // Content decides, not the extension — a renamed .gobo still opens.
    const result = parseSceneText(envelope(), 'set.js');
    expect(result.ok && result.name).toBe('ultratronics 11');
  });

  it('accepts an empty code string (an empty scene is still a scene)', () => {
    const result = parseSceneText(envelope({ code: '' }), 'blank.gobo');
    expect(result).toEqual({ ok: true, name: 'ultratronics 11', code: '' });
  });

  it('falls back to the filename when the envelope name is missing', () => {
    const result = parseSceneText(envelope({ name: undefined }), 'warehouse set.gobo');
    expect(result.ok && result.name).toBe('warehouse set');
  });

  it('falls back to the filename when the envelope name is not a string', () => {
    // A bad name is not worth losing the code over.
    const result = parseSceneText(envelope({ name: 42 }), 'warehouse set.gobo');
    expect(result.ok && result.name).toBe('warehouse set');
  });

  it('falls back to the filename when the envelope name is only whitespace', () => {
    const result = parseSceneText(envelope({ name: '   ' }), 'warehouse set.gobo');
    expect(result.ok && result.name).toBe('warehouse set');
  });
});

// ─── Raw code ────────────────────────────────────────────────────────────────

describe('parseSceneText — raw code', () => {
  it('treats a plain .js file as code and names it from the filename', () => {
    const code = "const spot = fixture(1, 'rgbw')\nspot.white(sine())\n";
    expect(parseSceneText(code, 'my set.js')).toEqual({
      ok: true,
      name: 'my set',
      code,
    });
  });

  it('treats JSON that is not an envelope as code, not as an error', () => {
    // No goboScene key, so this is just a file whose contents happen to be
    // valid JSON. `{"a": 1}` is a legal (if dull) program.
    const code = '{"a": 1, "b": [2, 3]}';
    expect(parseSceneText(code, 'notes.txt')).toEqual({
      ok: true,
      name: 'notes',
      code,
    });
  });

  it('treats a JSON array as code', () => {
    const code = '[1, 2, 3]';
    expect(parseSceneText(code, 'nums.js')).toEqual({ ok: true, name: 'nums', code });
  });

  it('treats a bare JSON scalar as code', () => {
    // JSON.parse('42') succeeds and returns a number — it must not be
    // mistaken for a document shape.
    expect(parseSceneText('42', 'answer.js')).toEqual({ ok: true, name: 'answer', code: '42' });
    expect(parseSceneText('"hi"', 'greet.js')).toEqual({ ok: true, name: 'greet', code: '"hi"' });
    expect(parseSceneText('null', 'nil.js')).toEqual({ ok: true, name: 'nil', code: 'null' });
  });

  it('treats a fixture export as code rather than claiming it is a scene', () => {
    // Wrong envelope type: no goboScene key, so it falls through to code.
    // Better than a false "damaged scene file" — the user can see what it is.
    const code = JSON.stringify({ goboFixture: 1, id: 'bar', def: {} });
    expect(parseSceneText(code, 'bar.gobo-fixture.json').ok).toBe(true);
  });

  it('keeps leading whitespace and comments intact', () => {
    const code = '\n// header comment\n\nsetBPM(120)\n';
    expect(parseSceneText(code, 'set.js')).toEqual({ ok: true, name: 'set', code });
  });
});

// ─── Rejections ──────────────────────────────────────────────────────────────

describe('parseSceneText — rejections', () => {
  it('rejects an empty file', () => {
    const result = parseSceneText('', 'empty.gobo');
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toMatch(/empty/i);
  });

  it('rejects a whitespace-only file', () => {
    expect(parseSceneText('   \n\t\n  ', 'blank.js').ok).toBe(false);
  });

  it('rejects an envelope from a newer version', () => {
    const result = parseSceneText(envelope({ goboScene: 2 }), 'future.gobo');
    expect(result.ok).toBe(false);
    // The message names both versions so the user knows which way to move.
    expect(!result.ok && result.reason).toContain('version 2');
    expect(!result.ok && result.reason).toContain('version 1');
  });

  it('rejects an envelope whose version is not a number', () => {
    const result = parseSceneText(envelope({ goboScene: '1' }), 'odd.gobo');
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toMatch(/version/i);
  });

  it('rejects an envelope whose version is null', () => {
    expect(parseSceneText(envelope({ goboScene: null }), 'odd.gobo').ok).toBe(false);
  });

  it('rejects an envelope with a non-string code', () => {
    const result = parseSceneText(envelope({ code: { lines: [] } }), 'broken.gobo');
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toMatch(/code/i);
  });

  it('rejects an envelope with no code field at all', () => {
    const result = parseSceneText(envelope({ code: undefined }), 'broken.gobo');
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toMatch(/code/i);
  });

  it('never throws, whatever it is handed', () => {
    const inputs = [
      '{',
      '{"goboScene":}',
      '\u0000',
      'undefined',
      '{"goboScene": 1}',
      String(undefined),
    ];
    for (const input of inputs) {
      expect(() => parseSceneText(input, '')).not.toThrow();
    }
    // Callers are typed, but a stray non-string must not explode either.
    expect(() => parseSceneText(undefined as unknown as string, 'x.gobo')).not.toThrow();
    expect(() => parseSceneText('code', undefined as unknown as string)).not.toThrow();
  });
});

// ─── Name derivation from filename ───────────────────────────────────────────

describe('parseSceneText — name from filename', () => {
  const nameOf = (filename: string): string => {
    const result = parseSceneText('setBPM(120)', filename);
    return result.ok ? result.name : `<rejected: ${result.reason}>`;
  };

  it('strips a known extension', () => {
    expect(nameOf('warehouse.gobo')).toBe('warehouse');
    expect(nameOf('warehouse.js')).toBe('warehouse');
    expect(nameOf('warehouse.txt')).toBe('warehouse');
  });

  it('matches the extension case-insensitively', () => {
    expect(nameOf('Warehouse.GOBO')).toBe('Warehouse');
  });

  it('strips only the last extension, and only a known one', () => {
    expect(nameOf('set.v2.gobo')).toBe('set.v2');
    // Not a known extension, so it is part of the name.
    expect(nameOf('ultratronics 11.2')).toBe('ultratronics 11.2');
  });

  it('keeps only the last path segment', () => {
    expect(nameOf('C:\\Users\\Admin\\Documents\\my set.gobo')).toBe('my set');
    expect(nameOf('/home/user/shows/my set.gobo')).toBe('my set');
  });

  it('keeps odd but harmless characters', () => {
    expect(nameOf('50-50 (final!) #2.gobo')).toBe('50-50 (final!) #2');
    expect(nameOf('café ☆ 2026.gobo')).toBe('café ☆ 2026');
  });

  it('collapses whitespace runs and trims', () => {
    expect(nameOf('  spaced    out  .js')).toBe('spaced out');
  });

  it('removes control characters', () => {
    expect(nameOf(`bell${ctrl(7)}name.gobo`)).toBe('bell name');
  });

  it('caps an absurdly long name', () => {
    expect(nameOf(`${'x'.repeat(500)}.gobo`).length).toBeLessThanOrEqual(80);
  });

  it('falls back when the filename yields nothing usable', () => {
    expect(nameOf('.gobo')).toBe('untitled');
    expect(nameOf('')).toBe('untitled');
    expect(nameOf('   ')).toBe('untitled');
  });
});

// ─── Filename sanitiser ──────────────────────────────────────────────────────

describe('sceneFilename', () => {
  it('appends the .gobo extension', () => {
    expect(sceneFilename('warehouse')).toBe('warehouse.gobo');
  });

  it('keeps spaces and ordinary punctuation', () => {
    expect(sceneFilename('ultratronics 11 (final)')).toBe('ultratronics 11 (final).gobo');
  });

  it('strips path separators so a name cannot steer where the file lands', () => {
    expect(sceneFilename('../../etc/passwd')).toBe('.. .. etc passwd.gobo');
    expect(sceneFilename('a\\b')).toBe('a b.gobo');
  });

  it('strips characters Windows forbids', () => {
    expect(sceneFilename('50:50 <mix> "v2" | ?*')).toBe('50 50 mix v2.gobo');
  });

  it('strips control characters', () => {
    expect(sceneFilename(`tab${ctrl(9)}newline${ctrl(10)}x`)).toBe('tab newline x.gobo');
  });

  it('collapses whitespace runs and trims', () => {
    expect(sceneFilename('  a    b  ')).toBe('a b.gobo');
  });

  it('drops a trailing dot or space, which Windows silently eats', () => {
    expect(sceneFilename('version 1.')).toBe('version 1.gobo');
    expect(sceneFilename('version 1...  ')).toBe('version 1.gobo');
  });

  it('caps the length, leaving room for the extension', () => {
    const out = sceneFilename('x'.repeat(500));
    expect(out.endsWith('.gobo')).toBe(true);
    expect(out.length).toBe(64 + '.gobo'.length);
  });

  it('does not leave a trailing dot after truncation', () => {
    // Cap lands exactly on the dot: it must not survive as "….gobo".
    const name = `${'x'.repeat(63)}.tail`;
    expect(sceneFilename(name)).toBe(`${'x'.repeat(63)}.gobo`);
  });

  it('escapes Windows reserved device names', () => {
    expect(sceneFilename('con')).toBe('con-scene.gobo');
    expect(sceneFilename('COM1')).toBe('COM1-scene.gobo');
    expect(sceneFilename('NUL')).toBe('NUL-scene.gobo');
    // Only the exact name is reserved.
    expect(sceneFilename('console')).toBe('console.gobo');
  });

  it('falls back when nothing usable survives', () => {
    expect(sceneFilename('')).toBe('scene.gobo');
    expect(sceneFilename('   ')).toBe('scene.gobo');
    expect(sceneFilename('///')).toBe('scene.gobo');
    expect(sceneFilename('...')).toBe('scene.gobo');
  });

  it('produces a filename that round-trips back to a usable scene name', () => {
    // What we write must be openable again without the name degrading
    // further — save, reopen, save should be stable.
    const filename = sceneFilename('50/50 mix');
    const result = parseSceneText('setBPM(120)', filename);
    expect(result.ok && result.name).toBe('50 50 mix');
    expect(sceneFilename(result.ok ? result.name : '')).toBe(filename);
  });
});
