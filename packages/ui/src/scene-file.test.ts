/**
 * Tests for scene file save / open.
 *
 * A saved scene is now the code itself, in a `.js` file. The first suite
 * pins that literally: the bytes handed to the browser must be the buffer
 * and nothing else, so the file stays readable, diffable and highlightable
 * outside gobo. Anything wrapped around it (an envelope, a header, a
 * normalised trailing newline) breaks that quietly, in a file the user only
 * opens weeks later.
 *
 * The rest covers the two pure halves: parseSceneText() and the filename
 * sanitiser. Two cases there are load-bearing:
 *
 *   - JSON that is NOT an envelope must open as code. A scene is JavaScript,
 *     and rejecting a file because it happens to parse as JSON would lock the
 *     user out of their own set.
 *   - Name → filename → name must settle. The name lives only in the
 *     filename now, so a sanitiser and an un-sanitiser that disagree would
 *     rename the user's scene further on every save/open cycle.
 *
 * downloadScene() is a DOM wrapper and the default test environment is node,
 * so its three globals (document, the anchor, URL object-URLs) are stubbed
 * below. What it writes is the format, and the format is worth a test.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  downloadScene,
  parseSceneText,
  sceneFilename,
  type LegacySceneFile,
} from './scene-file.js';

/** An envelope in the shape builds up to 0.2.0 wrote. Nothing writes this
 *  any more; these files still have to open. */
function legacyEnvelope(overrides: Record<string, unknown> = {}): string {
  const base: LegacySceneFile = {
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

// ─── Download ────────────────────────────────────────────────────────────────

/** The parts of an anchor downloadScene touches. */
interface FakeAnchor {
  href: string;
  download: string;
  clicks: number;
  click(): void;
  remove(): void;
}

/** What the last downloadScene() call handed to the browser. */
let anchors: FakeAnchor[];
let blobs: Blob[];

// Node has real URL.createObjectURL, so these are saved and put back rather
// than assumed absent. The deferred revoke inside downloadScene fires a
// second later, by which time the real implementation is back; revoking an
// id it never issued is a no-op, so nothing escapes into the next test.
const urlHost = URL as unknown as {
  createObjectURL(blob: Blob): string;
  revokeObjectURL(url: string): void;
};
const realCreateObjectURL = urlHost.createObjectURL;
const realRevokeObjectURL = urlHost.revokeObjectURL;

beforeEach(() => {
  anchors = [];
  blobs = [];
  urlHost.createObjectURL = (blob: Blob): string => {
    blobs.push(blob);
    return `blob:gobo-test-${blobs.length - 1}`;
  };
  urlHost.revokeObjectURL = (): void => {};
  vi.stubGlobal('document', {
    createElement: (): FakeAnchor => {
      const a: FakeAnchor = {
        href: '',
        download: '',
        clicks: 0,
        click(): void { this.clicks++; },
        remove: (): void => {},
      };
      anchors.push(a);
      return a;
    },
    body: { appendChild: (): void => {} },
  });
});

afterEach(() => {
  urlHost.createObjectURL = realCreateObjectURL;
  urlHost.revokeObjectURL = realRevokeObjectURL;
  vi.unstubAllGlobals();
});

describe('downloadScene', () => {
  it('writes the code verbatim, with nothing wrapped around it', async () => {
    // Awkward on purpose: quotes, backslashes, blank lines, non-ASCII and a
    // trailing newline are all things a JSON envelope would have escaped or a
    // serialiser might have "tidied".
    const code = 'const spot = fixture(1, "rgbw")\n\n// café ☆ 50\\50\nspot.white(sine())\n';
    downloadScene('my set', code);
    expect(blobs).toHaveLength(1);
    const text = await blobs[0].text();
    expect(text).toBe(code);
  });

  it('writes no envelope keys at all', async () => {
    downloadScene('my set', 'setBPM(120)');
    const text = await blobs[0].text();
    expect(text).toBe('setBPM(120)');
    expect(text).not.toContain('goboScene');
    expect(text).not.toContain('savedAt');
  });

  it('names the file after the scene, with a .js extension', () => {
    downloadScene('my set', 'setBPM(120)');
    expect(anchors[0].download).toBe('my set.js');
  });

  it('sanitises the filename but not the code', async () => {
    const code = 'a/b\\c';   // path separators in the CODE are just code
    downloadScene('50/50 mix', code);
    expect(anchors[0].download).toBe('50 50 mix.js');
    expect(await blobs[0].text()).toBe(code);
  });

  it('writes an empty buffer as an empty file', async () => {
    downloadScene('blank', '');
    expect(await blobs[0].text()).toBe('');
  });

  it('declares the file as JavaScript', () => {
    downloadScene('my set', 'setBPM(120)');
    // The type is what decides whether an editor or a gist treats the file as
    // source rather than as an octet-stream to be downloaded again.
    expect(blobs[0].type).toContain('javascript');
  });

  it('points the anchor at the blob and clicks it once', () => {
    downloadScene('my set', 'setBPM(120)');
    expect(anchors[0].href).toBe('blob:gobo-test-0');
    // Twice would give the user two copies of the same file.
    expect(anchors[0].clicks).toBe(1);
  });
});

// ─── Legacy envelopes ────────────────────────────────────────────────────────

describe('parseSceneText: legacy .gobo envelopes', () => {
  it('reads a valid envelope, preferring its name over the filename', () => {
    const result = parseSceneText(legacyEnvelope(), 'downloaded (3).gobo');
    expect(result).toEqual({
      ok: true,
      name: 'ultratronics 11',
      code: "artnet('2.0.0.100')\nsetBPM(108)\n",
    });
  });

  it('preserves the code byte-for-byte, including trailing newlines', () => {
    const code = 'line one\n\n  indented\n\n';
    const result = parseSceneText(legacyEnvelope({ code }), 'x.gobo');
    expect(result.ok && result.code).toBe(code);
  });

  it('accepts an envelope regardless of the file extension', () => {
    // Detection keys on the goboScene key, not on the extension, so a
    // renamed .gobo still opens and a .js file holding an old envelope
    // still restores its name.
    const result = parseSceneText(legacyEnvelope(), 'set.js');
    expect(result.ok && result.name).toBe('ultratronics 11');
  });

  it('accepts an empty code string (an empty scene is still a scene)', () => {
    const result = parseSceneText(legacyEnvelope({ code: '' }), 'blank.gobo');
    expect(result).toEqual({ ok: true, name: 'ultratronics 11', code: '' });
  });

  it('falls back to the filename when the envelope name is missing', () => {
    const result = parseSceneText(legacyEnvelope({ name: undefined }), 'warehouse set.gobo');
    expect(result.ok && result.name).toBe('warehouse set');
  });

  it('falls back to the filename when the envelope name is not a string', () => {
    // A bad name is not worth losing the code over.
    const result = parseSceneText(legacyEnvelope({ name: 42 }), 'warehouse set.gobo');
    expect(result.ok && result.name).toBe('warehouse set');
  });

  it('falls back to the filename when the envelope name is only whitespace', () => {
    const result = parseSceneText(legacyEnvelope({ name: '   ' }), 'warehouse set.gobo');
    expect(result.ok && result.name).toBe('warehouse set');
  });
});

// ─── Raw code ────────────────────────────────────────────────────────────────

describe('parseSceneText: raw code', () => {
  it('treats a plain .js file as code and names it from the filename', () => {
    const code = "const spot = fixture(1, 'rgbw')\nspot.white(sine())\n";
    expect(parseSceneText(code, 'my set.js')).toEqual({
      ok: true,
      name: 'my set',
      code,
    });
  });

  it('treats JSON that is not an envelope as code, not as an error', () => {
    // No goboScene key, so this is a file whose contents happen to be valid
    // JSON. `{"a": 1}` is a legal program.
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
    // JSON.parse('42') succeeds and returns a number, which must not be
    // mistaken for a document shape.
    expect(parseSceneText('42', 'answer.js')).toEqual({ ok: true, name: 'answer', code: '42' });
    expect(parseSceneText('"hi"', 'greet.js')).toEqual({ ok: true, name: 'greet', code: '"hi"' });
    expect(parseSceneText('null', 'nil.js')).toEqual({ ok: true, name: 'nil', code: 'null' });
  });

  it('treats a fixture export as code rather than claiming it is a scene', () => {
    // Wrong envelope type: no goboScene key, so it falls through to code.
    // Better than a false "damaged scene file"; the user can see what it is.
    const code = JSON.stringify({ goboFixture: 1, id: 'bar', def: {} });
    expect(parseSceneText(code, 'bar.gobo-fixture.json').ok).toBe(true);
  });

  it('keeps leading whitespace and comments intact', () => {
    const code = '\n// header comment\n\nsetBPM(120)\n';
    expect(parseSceneText(code, 'set.js')).toEqual({ ok: true, name: 'set', code });
  });
});

// ─── Rejections ──────────────────────────────────────────────────────────────

describe('parseSceneText: rejections', () => {
  it('rejects an empty file', () => {
    const result = parseSceneText('', 'empty.js');
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toMatch(/empty/i);
  });

  it('rejects a whitespace-only file', () => {
    expect(parseSceneText('   \n\t\n  ', 'blank.js').ok).toBe(false);
  });

  it('rejects an envelope claiming a version that never existed', () => {
    const result = parseSceneText(legacyEnvelope({ goboScene: 2 }), 'future.gobo');
    expect(result.ok).toBe(false);
    // The message names both versions so the user can see which file this is.
    expect(!result.ok && result.reason).toContain('version 2');
    expect(!result.ok && result.reason).toContain('version 1');
  });

  it('rejects an envelope whose version is not a number', () => {
    const result = parseSceneText(legacyEnvelope({ goboScene: '1' }), 'odd.gobo');
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toMatch(/version/i);
  });

  it('rejects an envelope whose version is null', () => {
    expect(parseSceneText(legacyEnvelope({ goboScene: null }), 'odd.gobo').ok).toBe(false);
  });

  it('rejects an envelope with a non-string code', () => {
    const result = parseSceneText(legacyEnvelope({ code: { lines: [] } }), 'broken.gobo');
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toMatch(/code/i);
  });

  it('rejects an envelope with no code field at all', () => {
    const result = parseSceneText(legacyEnvelope({ code: undefined }), 'broken.gobo');
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
    expect(() => parseSceneText(undefined as unknown as string, 'x.js')).not.toThrow();
    expect(() => parseSceneText('code', undefined as unknown as string)).not.toThrow();
  });
});

// ─── Name derivation from filename ───────────────────────────────────────────

describe('parseSceneText: name from filename', () => {
  const nameOf = (filename: string): string => {
    const result = parseSceneText('setBPM(120)', filename);
    return result.ok ? result.name : `<rejected: ${result.reason}>`;
  };

  it('strips a known extension', () => {
    expect(nameOf('warehouse.js')).toBe('warehouse');
    expect(nameOf('warehouse.gobo')).toBe('warehouse');
    expect(nameOf('warehouse.txt')).toBe('warehouse');
  });

  it('matches the extension case-insensitively', () => {
    expect(nameOf('Warehouse.JS')).toBe('Warehouse');
    expect(nameOf('Warehouse.GOBO')).toBe('Warehouse');
  });

  it('strips only the last extension, and only a known one', () => {
    expect(nameOf('set.v2.js')).toBe('set.v2');
    // A name with dots of its own keeps every one of them.
    expect(nameOf('act 2.5 final.js')).toBe('act 2.5 final');
    // Not a known extension, so it is part of the name.
    expect(nameOf('ultratronics 11.2')).toBe('ultratronics 11.2');
  });

  it('keeps only the last path segment', () => {
    expect(nameOf('C:\\Users\\Admin\\Documents\\my set.js')).toBe('my set');
    expect(nameOf('/home/user/shows/my set.js')).toBe('my set');
  });

  it('keeps odd but harmless characters', () => {
    expect(nameOf('50-50 (final!) #2.js')).toBe('50-50 (final!) #2');
    expect(nameOf('café ☆ 2026.js')).toBe('café ☆ 2026');
  });

  it('collapses whitespace runs and trims', () => {
    expect(nameOf('  spaced    out  .js')).toBe('spaced out');
  });

  it('removes control characters', () => {
    expect(nameOf(`bell${ctrl(7)}name.js`)).toBe('bell name');
  });

  it('caps an absurdly long name', () => {
    expect(nameOf(`${'x'.repeat(500)}.js`).length).toBeLessThanOrEqual(80);
  });

  it('falls back when the filename yields nothing usable', () => {
    expect(nameOf('.js')).toBe('untitled');
    expect(nameOf('')).toBe('untitled');
    expect(nameOf('   ')).toBe('untitled');
  });
});

// ─── Filename sanitiser ──────────────────────────────────────────────────────

describe('sceneFilename', () => {
  it('appends the .js extension', () => {
    expect(sceneFilename('warehouse')).toBe('warehouse.js');
  });

  it('keeps spaces and ordinary punctuation', () => {
    expect(sceneFilename('ultratronics 11 (final)')).toBe('ultratronics 11 (final).js');
  });

  it('keeps dots inside the name', () => {
    expect(sceneFilename('act 2.5 final')).toBe('act 2.5 final.js');
  });

  it('strips path separators so a name cannot steer where the file lands', () => {
    expect(sceneFilename('../../etc/passwd')).toBe('.. .. etc passwd.js');
    expect(sceneFilename('a\\b')).toBe('a b.js');
  });

  it('strips characters Windows forbids', () => {
    expect(sceneFilename('50:50 <mix> "v2" | ?*')).toBe('50 50 mix v2.js');
  });

  it('strips control characters', () => {
    expect(sceneFilename(`tab${ctrl(9)}newline${ctrl(10)}x`)).toBe('tab newline x.js');
  });

  it('collapses whitespace runs and trims', () => {
    expect(sceneFilename('  a    b  ')).toBe('a b.js');
  });

  it('drops a trailing dot or space, which Windows silently eats', () => {
    expect(sceneFilename('version 1.')).toBe('version 1.js');
    expect(sceneFilename('version 1...  ')).toBe('version 1.js');
  });

  it('caps the length, leaving room for the extension', () => {
    const out = sceneFilename('x'.repeat(500));
    expect(out.endsWith('.js')).toBe(true);
    expect(out.length).toBe(64 + '.js'.length);
  });

  it('does not leave a trailing dot after truncation', () => {
    // Cap lands exactly on the dot: it must not survive as "….js".
    const name = `${'x'.repeat(63)}.tail`;
    expect(sceneFilename(name)).toBe(`${'x'.repeat(63)}.js`);
  });

  it('escapes Windows reserved device names', () => {
    expect(sceneFilename('con')).toBe('con-scene.js');
    expect(sceneFilename('COM1')).toBe('COM1-scene.js');
    expect(sceneFilename('NUL')).toBe('NUL-scene.js');
    // Only the exact name is reserved.
    expect(sceneFilename('console')).toBe('console.js');
  });

  it('falls back when nothing usable survives', () => {
    expect(sceneFilename('')).toBe('scene.js');
    expect(sceneFilename('   ')).toBe('scene.js');
    expect(sceneFilename('///')).toBe('scene.js');
    expect(sceneFilename('...')).toBe('scene.js');
  });
});

// ─── Round trip ──────────────────────────────────────────────────────────────
// The name lives only in the filename now, so save → open → save is the
// contract that keeps a scene called what the user called it.

describe('save / open round trip', () => {
  /** Save a name, then read it back the way openSceneFile() would. */
  const roundTrip = (name: string): { filename: string; name: string } => {
    const filename = sceneFilename(name);
    const result = parseSceneText('setBPM(120)', filename);
    return { filename, name: result.ok ? result.name : `<rejected: ${result.reason}>` };
  };

  it('returns an ordinary name unchanged', () => {
    expect(roundTrip('my set')).toEqual({ filename: 'my set.js', name: 'my set' });
  });

  it('returns a name containing dots unchanged', () => {
    // The extension stripper takes the .js and stops. "act 2" would be a
    // silent rename of the user's scene.
    expect(roundTrip('act 2.5 final')).toEqual({
      filename: 'act 2.5 final.js',
      name: 'act 2.5 final',
    });
  });

  it('returns a name that ends in a known extension unchanged', () => {
    expect(roundTrip('notes.txt')).toEqual({ filename: 'notes.txt.js', name: 'notes.txt' });
  });

  it('keeps non-ASCII names intact', () => {
    expect(roundTrip('café ☆ 2026')).toEqual({ filename: 'café ☆ 2026.js', name: 'café ☆ 2026' });
  });

  it('settles after one save, however awkward the name', () => {
    // The sanitiser may rename a scene ONCE, because "50/50" cannot be a
    // filename. What must not happen is a name that keeps changing: the
    // second cycle has to produce the same file as the first, or a scene
    // drifts further from its name on every save.
    const awkward = [
      '50/50 mix',
      'con',
      'version 1.',
      '  spaced    out  ',
      `bell${ctrl(7)}name`,
      'x'.repeat(500),
      '...',
      '',
      'act 2.5 final',
      'notes.txt',
    ];
    for (const name of awkward) {
      const first = roundTrip(name);
      const second = roundTrip(first.name);
      expect(second.filename).toBe(first.filename);
      expect(second.name).toBe(first.name);
    }
  });

  it('renames "50/50 mix" visibly, and only once', () => {
    // Pinned by name rather than only in the loop above: this is the case a
    // user hits, and the new name is the one they will see in their
    // downloads folder and in the topbar when they reopen it.
    expect(roundTrip('50/50 mix')).toEqual({ filename: '50 50 mix.js', name: '50 50 mix' });
  });
});
