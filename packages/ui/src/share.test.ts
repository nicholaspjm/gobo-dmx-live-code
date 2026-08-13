/**
 * Unit tests for the share-link codec.
 *
 * Two things are being pinned here. First, fidelity: a scene that goes into a
 * link must come back out byte-identical, including unicode, emoji and the
 * characters that are awkward in URLs (`#`, `%`, `&`, `+`). A codec that
 * mangles a backslash would corrupt source in a way nobody notices until the
 * scene is reopened.
 *
 * Second, hostility: the decoder's input is a stranger's URL, and the scene
 * it produces runs unsandboxed in the page. Every malformed path is
 * exercised explicitly and must return null rather than throw or return a
 * half-trusted object. A thrown error in the boot path would take the editor
 * down, and a partially-validated object would put attacker-chosen values
 * into the editor.
 *
 * These run on Node, which has CompressionStream natively, so the real codec
 * is exercised rather than a stub. `location` and `history` do not exist in
 * Node, so they are stubbed per-test. That is also how the fallback paths
 * (no CompressionStream, no DecompressionStream) get tested: by deleting the
 * global the way an older Safari would have it.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  encodeShareLink,
  decodeShareFromLocation,
  clearShareFromLocation,
} from './share.js';

// ─── globals stubbing ─────────────────────────────────────────────────────────

interface ReplaceStateCall {
  state: unknown;
  url: string;
}

const g = globalThis as unknown as {
  location?: unknown;
  history?: unknown;
  CompressionStream?: unknown;
  DecompressionStream?: unknown;
};

let replaceStateCalls: ReplaceStateCall[] = [];

/** Install a location stub carrying the parts share.ts actually reads. */
function setLocation(href: string): void {
  const url = new URL(href);
  g.location = {
    href: url.href,
    origin: url.origin,
    pathname: url.pathname,
    search: url.search,
    hash: url.hash,
  };
}

/** Replace just the hash on the current location stub. */
function setHash(hash: string): void {
  const loc = g.location as { href: string } | undefined;
  const base = loc ? new URL(loc.href) : new URL('https://example.test/app/');
  base.hash = '';
  setLocation(base.toString() + (hash.startsWith('#') ? hash : `#${hash}`));
}

beforeEach(() => {
  replaceStateCalls = [];
  setLocation('https://example.test/app/');
  g.history = {
    state: { marker: 'kept' },
    replaceState(state: unknown, _title: string, url: string) {
      replaceStateCalls.push({ state, url });
    },
  };
});

afterEach(() => {
  delete g.location;
  delete g.history;
});

// ─── helpers for hand-building payloads ──────────────────────────────────────

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function deflateRaw(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new ReadableStream<BufferSource>({
    start(c) {
      c.enqueue(bytes);
      c.close();
    },
  }).pipeThrough(new CompressionStream('deflate-raw'));

  const reader = stream.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

/** Build a `#s1=` hash around arbitrary bytes (not necessarily valid JSON). */
async function compressedHash(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return `s1=${bytesToBase64Url(await deflateRaw(bytes))}`;
}

/** Build a `#s1=` hash around a JSON string. */
async function compressedHashOfText(text: string): Promise<string> {
  return compressedHash(new TextEncoder().encode(text));
}

/** Build a `#s1u=` (uncompressed fallback) hash around a JSON string. */
function plainHashOfText(text: string): string {
  return `s1u=${bytesToBase64Url(new TextEncoder().encode(text))}`;
}

/** Encode a scene, then point the location stub at the resulting link. */
async function roundTrip(
  code: string,
  name: string,
): Promise<{ code: string; name: string } | null> {
  const link = await encodeShareLink(code, name);
  setLocation(link);
  return decodeShareFromLocation();
}

// ─── round-trip fidelity ──────────────────────────────────────────────────────

describe('round-trip fidelity', () => {
  it('preserves plain ascii scene code', async () => {
    const code = 'dim(1, sine.range(0, 255));\nrgb(2, "red");\n';
    expect(await roundTrip(code, 'basic')).toEqual({ code, name: 'basic' });
  });

  it('preserves unicode and emoji, including surrogate pairs', async () => {
    const code = '// スポット照明, naïve café\nconst 灯 = 1; // 💡🎛️🔦 flag: 🏳️‍🌈\n';
    const name = 'ライブ 💡';
    expect(await roundTrip(code, name)).toEqual({ code, name });
  });

  it('preserves characters that are awkward in URLs', async () => {
    // Every one of these means something to a URL parser: the hash
    // terminator, percent-escapes, query separators, the space-as-plus
    // convention, path separators, plus quoting and escapes.
    const code = '#hash %41 %% &a=b ?q +plus /slash\\back "dq" \'sq\' `tick` <tag> {}|^[]~;,\n\t';
    const name = 'a#b%c&d=e?f+g/h';
    expect(await roundTrip(code, name)).toEqual({ code, name });
  });

  it('preserves an empty scene and an empty name', async () => {
    expect(await roundTrip('', '')).toEqual({ code: '', name: '' });
  });

  it('preserves newline styles exactly', async () => {
    const code = 'a\r\nb\nc\rd\n\n';
    expect(await roundTrip(code, 'eol')).toEqual({ code, name: 'eol' });
  });

  it('preserves a very long scene', async () => {
    // ~200k chars of varied (poorly-compressible-ish) source.
    let code = '';
    for (let i = 0; i < 4000; i++) {
      code += `dim(${i % 512}, sine.range(${i}, ${i * 3}).fast(${i % 17})); // 灯 ${i}\n`;
    }
    expect(code.length).toBeGreaterThan(150_000);
    const out = await roundTrip(code, 'long');
    expect(out).not.toBeNull();
    expect(out?.code).toBe(code);
    expect(out?.code.length).toBe(code.length);
  });

  it('compresses: a repetitive scene yields a link far shorter than the source', async () => {
    const code = 'dim(1, sine.range(0, 255));\n'.repeat(2000);
    const link = await encodeShareLink(code, 'repetitive');
    expect(link.length).toBeLessThan(code.length / 10);
  });
});

// ─── link shape ───────────────────────────────────────────────────────────────

describe('link shape', () => {
  it('returns an absolute URL that keeps the current base path', async () => {
    // GitHub Pages serves the app from a subpath; the link has to carry it.
    setLocation('https://someone.github.io/gobo/');
    const link = await encodeShareLink('dim(1, 255);', 'x');
    expect(link.startsWith('https://someone.github.io/gobo/#')).toBe(true);
  });

  it('works from a localhost dev server', async () => {
    setLocation('http://localhost:5173/');
    const link = await encodeShareLink('dim(1, 255);', 'x');
    expect(link.startsWith('http://localhost:5173/#')).toBe(true);
  });

  it('preserves an existing query string', async () => {
    setLocation('https://example.test/app/?debug=1');
    const link = await encodeShareLink('dim(1, 255);', 'x');
    expect(new URL(link).search).toBe('?debug=1');
  });

  it('replaces an existing hash rather than appending to it', async () => {
    setLocation('https://example.test/app/#s1=stale');
    const link = await encodeShareLink('dim(1, 255);', 'x');
    expect(link.split('#').length).toBe(2);
    expect(link).not.toContain('stale');
  });

  it('uses the versioned s1 prefix and a URL-safe payload', async () => {
    const link = await encodeShareLink('dim(1, 255);', 'x');
    const hash = new URL(link).hash;
    expect(hash.startsWith('#s1=')).toBe(true);
    // No padding, no '+' or '/', so the link survives being pasted anywhere.
    expect(hash.slice('#s1='.length)).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

// ─── size cap ─────────────────────────────────────────────────────────────────

describe('size cap', () => {
  it('refuses a decompression bomb instead of inflating it', async () => {
    // 4 MB of zero bytes deflates to a few kB: cheap to send, expensive to
    // expand.
    const bomb = new Uint8Array(4 * 1024 * 1024);
    const hash = await compressedHash(bomb);
    expect(hash.length).toBeLessThan(50_000); // cheap to send, as advertised
    setHash(hash);
    expect(await decodeShareFromLocation()).toBeNull();
  });

  it('refuses valid JSON whose decompressed size exceeds the cap', async () => {
    const json = JSON.stringify({ name: 'huge', code: 'a'.repeat(600 * 1024) });
    setHash(await compressedHashOfText(json));
    expect(await decodeShareFromLocation()).toBeNull();
  });

  it('accepts a large scene that stays under the cap', async () => {
    const code = 'b'.repeat(400 * 1024);
    const json = JSON.stringify({ name: 'big', code });
    setHash(await compressedHashOfText(json));
    const out = await decodeShareFromLocation();
    expect(out?.code.length).toBe(code.length);
  });

  it('applies the cap to uncompressed payloads too', async () => {
    const json = JSON.stringify({ name: 'huge', code: 'a'.repeat(600 * 1024) });
    setHash(plainHashOfText(json));
    expect(await decodeShareFromLocation()).toBeNull();
  });

  it('refuses an absurdly long hash before decoding it', async () => {
    setHash(`s1=${'A'.repeat(3 * 1024 * 1024)}`);
    expect(await decodeShareFromLocation()).toBeNull();
  });
});

// ─── malformed input ──────────────────────────────────────────────────────────

describe('malformed input returns null', () => {
  it('no location at all', async () => {
    delete g.location;
    expect(await decodeShareFromLocation()).toBeNull();
  });

  it('no hash', async () => {
    setLocation('https://example.test/app/');
    expect(await decodeShareFromLocation()).toBeNull();
  });

  it('a bare hash', async () => {
    g.location = { href: 'https://example.test/app/#', hash: '#' };
    expect(await decodeShareFromLocation()).toBeNull();
  });

  it("someone else's hash", async () => {
    setHash('section-lighting');
    expect(await decodeShareFromLocation()).toBeNull();
  });

  it('a version token with no separator', async () => {
    setHash('s1');
    expect(await decodeShareFromLocation()).toBeNull();
  });

  it('an empty version token', async () => {
    setHash('=abcd');
    expect(await decodeShareFromLocation()).toBeNull();
  });

  it('an unknown version prefix', async () => {
    const payload = (await compressedHashOfText('{"name":"a","code":"b"}')).slice('s1='.length);
    setHash(`s9=${payload}`);
    expect(await decodeShareFromLocation()).toBeNull();
  });

  it('a known prefix with an empty payload', async () => {
    setHash('s1=');
    expect(await decodeShareFromLocation()).toBeNull();
  });

  it('characters outside the base64url alphabet', async () => {
    setHash('s1=not!valid$base64');
    expect(await decodeShareFromLocation()).toBeNull();
  });

  it('extra hash parameters appended to a good payload', async () => {
    const good = await compressedHashOfText('{"name":"a","code":"b"}');
    setHash(`${good}&other=1`);
    expect(await decodeShareFromLocation()).toBeNull();
  });

  it('a base64 length that cannot exist', async () => {
    setHash('s1=A'); // a lone base64 char is not a whole byte
    expect(await decodeShareFromLocation()).toBeNull();
  });

  it('valid base64 that is not deflate data', async () => {
    setHash(`s1=${bytesToBase64Url(new TextEncoder().encode('this is not compressed'))}`);
    expect(await decodeShareFromLocation()).toBeNull();
  });

  it('a truncated payload', async () => {
    const link = await encodeShareLink('dim(1, sine.range(0, 255));\n'.repeat(200), 'trunc');
    const payload = new URL(link).hash.slice('#s1='.length);
    setHash(`s1=${payload.slice(0, Math.floor(payload.length * 0.6))}`);
    expect(await decodeShareFromLocation()).toBeNull();
  });

  it('bytes that are not valid UTF-8', async () => {
    setHash(await compressedHash(new Uint8Array([0xff, 0xfe, 0x80, 0x81])));
    expect(await decodeShareFromLocation()).toBeNull();
  });

  it('valid UTF-8 that is not JSON', async () => {
    setHash(await compressedHashOfText('dim(1, 255); // just source, not JSON'));
    expect(await decodeShareFromLocation()).toBeNull();
  });

  it('truncated JSON', async () => {
    setHash(await compressedHashOfText('{"name":"a","code":"b'));
    expect(await decodeShareFromLocation()).toBeNull();
  });

  it('JSON that is not an object', async () => {
    for (const json of ['null', '42', '"a string"', 'true', '[]', '["code"]']) {
      setHash(await compressedHashOfText(json));
      expect(await decodeShareFromLocation(), json).toBeNull();
    }
  });

  it('an object missing code or name', async () => {
    for (const json of ['{}', '{"name":"a"}', '{"code":"b"}']) {
      setHash(await compressedHashOfText(json));
      expect(await decodeShareFromLocation(), json).toBeNull();
    }
  });

  it('code or name of the wrong type', async () => {
    const cases = [
      '{"name":"a","code":42}',
      '{"name":"a","code":null}',
      '{"name":"a","code":["x"]}',
      '{"name":"a","code":{"toString":"x"}}',
      '{"name":42,"code":"b"}',
      '{"name":null,"code":"b"}',
      '{"name":{},"code":"b"}',
    ];
    for (const json of cases) {
      setHash(await compressedHashOfText(json));
      expect(await decodeShareFromLocation(), json).toBeNull();
    }
  });

  it('ignores bytes appended after the end of the deflate stream', async () => {
    // A raw deflate stream is self-terminating, so DecompressionStream stops
    // at the final block and never looks at trailing bytes. Appended garbage
    // is never decompressed and never reaches the scene.
    const good = await deflateRaw(new TextEncoder().encode('{"name":"a","code":"b"}'));
    const padded = new Uint8Array(good.length + 8);
    padded.set(good, 0);
    padded.set([1, 2, 3, 4, 5, 6, 7, 8], good.length);
    setHash(`s1=${bytesToBase64Url(padded)}`);
    expect(await decodeShareFromLocation()).toEqual({ code: 'b', name: 'a' });
  });

  it('ignores extra fields on an otherwise valid object', async () => {
    setHash(await compressedHashOfText('{"name":"a","code":"b","autorun":true,"x":1}'));
    expect(await decodeShareFromLocation()).toEqual({ code: 'b', name: 'a' });
  });

  it('never throws, whatever the hash contains', async () => {
    const nasty = [
      's1=%%%',
      's1==',
      's1=====',
      '=',
      '==',
      's1u=',
      's1u=!!!',
      's1=' + ' ',
      'S1=abcd', // version match is case-sensitive
      's1 =abcd',
      's1=abcd efgh',
    ];
    for (const hash of nasty) {
      g.location = { href: 'https://example.test/app/', hash: `#${hash}` };
      await expect(decodeShareFromLocation()).resolves.toBeNull();
    }
  });
});

// ─── uncompressed fallback ────────────────────────────────────────────────────

describe('uncompressed fallback', () => {
  it('decodes an s1u payload', async () => {
    setHash(plainHashOfText('{"name":"plain","code":"dim(1, 255);"}'));
    expect(await decodeShareFromLocation()).toEqual({ code: 'dim(1, 255);', name: 'plain' });
  });

  it('decodes an s1u payload containing unicode', async () => {
    const scene = { name: '灯 💡', code: '// naïve café 🎛️\ndim(1, 255);' };
    setHash(plainHashOfText(JSON.stringify(scene)));
    expect(await decodeShareFromLocation()).toEqual({ code: scene.code, name: scene.name });
  });

  it('does not need DecompressionStream', async () => {
    const saved = g.DecompressionStream;
    delete g.DecompressionStream;
    try {
      setHash(plainHashOfText('{"name":"plain","code":"x"}'));
      expect(await decodeShareFromLocation()).toEqual({ code: 'x', name: 'plain' });
    } finally {
      g.DecompressionStream = saved;
    }
  });

  it('encodes under the s1u prefix when CompressionStream is missing', async () => {
    // Standing in for older Safari, which shipped without the API.
    const saved = g.CompressionStream;
    delete g.CompressionStream;
    let link: string;
    try {
      link = await encodeShareLink('dim(1, 255); // 💡', 'safari');
    } finally {
      g.CompressionStream = saved;
    }
    expect(new URL(link).hash.startsWith('#s1u=')).toBe(true);

    // And the link still opens in a browser that does have the API.
    setLocation(link);
    expect(await decodeShareFromLocation()).toEqual({
      code: 'dim(1, 255); // 💡',
      name: 'safari',
    });
  });

  it('rejects a compressed payload when DecompressionStream is missing, without throwing', async () => {
    const hash = await compressedHashOfText('{"name":"a","code":"b"}');
    const saved = g.DecompressionStream;
    delete g.DecompressionStream;
    try {
      setHash(hash);
      await expect(decodeShareFromLocation()).resolves.toBeNull();
    } finally {
      g.DecompressionStream = saved;
    }
  });
});

// ─── clearing the hash ────────────────────────────────────────────────────────

describe('clearShareFromLocation', () => {
  it('replaces the URL with one that has no hash', () => {
    setLocation('https://example.test/gobo/#s1=abcd');
    clearShareFromLocation();
    expect(replaceStateCalls).toHaveLength(1);
    expect(replaceStateCalls[0].url).toBe('/gobo/');
    expect(replaceStateCalls[0].url).not.toContain('#');
  });

  it('keeps the query string', () => {
    setLocation('https://example.test/gobo/?debug=1#s1=abcd');
    clearShareFromLocation();
    expect(replaceStateCalls[0].url).toBe('/gobo/?debug=1');
  });

  it('carries the existing history state through', () => {
    clearShareFromLocation();
    expect(replaceStateCalls[0].state).toEqual({ marker: 'kept' });
  });

  it('does not push a history entry', () => {
    // The only history call made is replaceState. pushState would leave Back
    // pointing at the payload URL and re-trigger the share prompt forever.
    const calls: string[] = [];
    g.history = {
      state: null,
      replaceState: () => calls.push('replaceState'),
      pushState: () => calls.push('pushState'),
    };
    clearShareFromLocation();
    expect(calls).toEqual(['replaceState']);
  });

  it('is a no-op when history is unavailable', () => {
    delete g.history;
    expect(() => clearShareFromLocation()).not.toThrow();
  });

  it('is a no-op when location is unavailable', () => {
    delete g.location;
    expect(() => clearShareFromLocation()).not.toThrow();
  });

  it('swallows a replaceState that the browser refuses', () => {
    g.history = {
      state: null,
      replaceState: () => {
        throw new Error('SecurityError');
      },
    };
    expect(() => clearShareFromLocation()).not.toThrow();
  });
});
