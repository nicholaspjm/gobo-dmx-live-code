/**
 * Share links — a whole scene encoded into the URL hash.
 *
 * WHY the payload lives in the URL: gobo is a static site. The hosted build
 * on GitHub Pages is nothing but files on a CDN — there is no backend, no
 * database, no accounts, nowhere to put a scene and hand back a short id.
 * Anything server-side would also mean the thing this project deliberately
 * avoids: your work leaving your browser. Putting the scene *in* the link
 * keeps the whole feature client-side, and a self-contained link never
 * expires, never 404s when someone stops paying for a host, and survives
 * being pasted into a text file for a year.
 *
 * The honest trade-off is size. The entire scene rides in the URL, so links
 * grow with the scene. Deflate gets typical live-coding source to roughly a
 * third of its length and base64 adds about a third back, so a 2 kB scene
 * lands near 900 characters of link — fine. But there is no free lunch:
 * browsers themselves handle very long URLs, while chat clients, QR codes,
 * mail gateways and some proxies start truncating somewhere around 2 kB.
 * A big set makes an unwieldy link, and a scene past MAX_JSON_BYTES is
 * refused by the decoder outright (see that constant). For anything large,
 * Save to file is the right tool — sharing is for passing a patch to
 * someone, not for archiving a show.
 *
 * SECURITY: this module decodes, it does not execute. Scene code runs
 * unsandboxed with full page privileges (see SECURITY.md and
 * packages/core/src/eval.ts), so a share link is a stranger's code aimed at
 * your origin, where it could read your saved work or repoint your DMX
 * output. A decoded scene must therefore be loaded stopped, behind a visible
 * notice, and run only on a deliberate keystroke. Enforcing that is the
 * caller's job; all this module promises is that it will never run the code
 * itself and never throw on hostile input. The returned `name` is likewise
 * untrusted text — render it as text, never as HTML.
 */

// Version prefixes. The hash is `#<version>=<base64url>`, so the decoder
// always knows which format it is holding and a future codec can be added
// without misreading old links.
const VERSION_DEFLATE = 's1';   // JSON → UTF-8 → deflate-raw → base64url
const VERSION_PLAIN = 's1u';    // JSON → UTF-8 → base64url  (no CompressionStream)

/**
 * Ceiling on the decoded JSON, in bytes. This is the anti-bomb limit: deflate
 * can expand roughly 1000:1, so a few hundred bytes of hostile payload could
 * otherwise ask us to allocate a gigabyte. Decompression is drained
 * incrementally and abandoned the moment it crosses this line.
 *
 * 512 kB is far beyond any real scene (the bundled examples are single-digit
 * kB) and far beyond what a pasteable URL can carry anyway. Note the ceiling
 * is enforced on decode only — encodeShareLink will happily build a link for
 * a larger buffer, and that link will not decode. That is the documented
 * limit of the format, not a bug to route around.
 */
const MAX_JSON_BYTES = 512 * 1024;

/**
 * Ceiling on the base64 text we are willing to even look at. A coarse guard
 * so a multi-megabyte hash is rejected before we allocate anything to decode
 * it; MAX_JSON_BYTES is the limit that actually matters.
 */
const MAX_PAYLOAD_CHARS = 2 * 1024 * 1024;

/**
 * Bytes backed by a plain ArrayBuffer. The stream APIs take `BufferSource`,
 * which deliberately excludes views over SharedArrayBuffer, and a bare
 * `Uint8Array` might be either. Everything here is freshly allocated or comes
 * from TextEncoder, so it is always the unshared kind — this alias just says
 * so rather than casting the difference away at each call site.
 */
type Bytes = Uint8Array<ArrayBuffer>;

// ─── base64url ───────────────────────────────────────────────────────────────

/** Encode bytes as base64url: URL-safe alphabet, padding stripped. */
function bytesToBase64Url(bytes: Uint8Array): string {
  // btoa() takes a binary string. Build it in chunks — spreading a large
  // typed array into one fromCharCode call blows the argument limit.
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Decode base64url back to bytes. Returns null for anything that is not
 *  valid base64url, rather than throwing — this input is attacker-supplied. */
function base64UrlToBytes(text: string): Bytes | null {
  // Reject foreign characters up front so atob() never sees them. This also
  // rejects '=' padding and any extra hash parameters, which is intended:
  // we only accept a hash that is exactly one of our payloads.
  if (!/^[A-Za-z0-9_-]+$/.test(text)) return null;
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  try {
    const binary = atob(padded);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  } catch {
    // Length not a valid base64 multiple, etc.
    return null;
  }
}

// ─── streams ─────────────────────────────────────────────────────────────────

// Typed as BufferSource, not Uint8Array, so the stream pairs cleanly with
// CompressionStream.writable (which lib.dom declares as WritableStream<BufferSource>).
function streamOf(bytes: Bytes): ReadableStream<BufferSource> {
  return new ReadableStream<BufferSource>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

/**
 * Read a byte stream to completion, giving up as soon as the total crosses
 * `cap`. Incremental by design: the point is to stop a decompression bomb
 * mid-inflate rather than to discover afterwards that we allocated too much.
 * Returns null on overflow or on any stream error (corrupt deflate data).
 */
async function drainStream(
  stream: ReadableStream<Uint8Array>,
  cap: number,
): Promise<Bytes | null> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > cap) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } catch {
    // Truncated or non-deflate payload — the transform rejects here.
    return null;
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.byteLength;
  }
  return out;
}

/**
 * Compress with the browser's native CompressionStream. Returns null when the
 * API is missing (older Safari) or refuses the format, so the caller can fall
 * back to an uncompressed payload. The `typeof` guard is deliberate: a bare
 * reference to an undeclared global throws a ReferenceError, and nothing in
 * this module may throw at load time.
 */
async function deflateRaw(bytes: Bytes): Promise<Bytes | null> {
  if (typeof CompressionStream !== 'function') return null;
  try {
    const stream = streamOf(bytes).pipeThrough(new CompressionStream('deflate-raw'));
    // Compressed output should never exceed the input by more than a hair;
    // the generous cap is only here so a pathological encoder cannot spin.
    return await drainStream(stream, MAX_JSON_BYTES * 2);
  } catch {
    return null;
  }
}

/** Inverse of deflateRaw, capped at MAX_JSON_BYTES. Null on any failure. */
async function inflateRaw(bytes: Bytes): Promise<Bytes | null> {
  if (typeof DecompressionStream !== 'function') return null;
  try {
    const stream = streamOf(bytes).pipeThrough(new DecompressionStream('deflate-raw'));
    return await drainStream(stream, MAX_JSON_BYTES);
  } catch {
    return null;
  }
}

// ─── encode ──────────────────────────────────────────────────────────────────

/**
 * Build an absolute, self-contained share URL for a scene.
 *
 * The URL is derived from the current location, so it carries whatever base
 * path the app is served under — this works on GitHub Pages at `/gobo/` and
 * on a localhost dev server alike, with no configured origin to get wrong.
 * Any existing hash is replaced, never appended to.
 */
export async function encodeShareLink(code: string, name: string): Promise<string> {
  const json = JSON.stringify({ name, code });
  const bytes = new TextEncoder().encode(json);

  const compressed = await deflateRaw(bytes);
  const version = compressed ? VERSION_DEFLATE : VERSION_PLAIN;
  const payload = bytesToBase64Url(compressed ?? bytes);

  const url = new URL(globalThis.location.href);
  url.hash = `${version}=${payload}`;
  return url.toString();
}

// ─── decode ──────────────────────────────────────────────────────────────────

/**
 * Read a scene out of the current URL hash, or null if there isn't one.
 *
 * Every failure path returns null rather than throwing: this input arrives
 * from a stranger's link, so a malformed, truncated, oversized, wrong-version
 * or non-JSON payload is an expected case, not an exception. The caller sees
 * "no share link here" and carries on with the user's own buffer.
 */
export async function decodeShareFromLocation(): Promise<{ code: string; name: string } | null> {
  const rawHash = globalThis.location?.hash;
  if (!rawHash) return null;

  const hash = rawHash.startsWith('#') ? rawHash.slice(1) : rawHash;
  const eq = hash.indexOf('=');
  if (eq <= 0) return null; // no version token, or an empty one

  const version = hash.slice(0, eq);
  const payload = hash.slice(eq + 1);
  if (payload.length === 0 || payload.length > MAX_PAYLOAD_CHARS) return null;
  if (version !== VERSION_DEFLATE && version !== VERSION_PLAIN) return null;

  const bytes = base64UrlToBytes(payload);
  if (!bytes) return null;

  let jsonBytes: Bytes | null;
  if (version === VERSION_DEFLATE) {
    jsonBytes = await inflateRaw(bytes);
  } else {
    // Uncompressed payloads are capped too — the base64 is only a 4/3
    // expansion, so MAX_PAYLOAD_CHARS alone would let a 1.5 MB scene through.
    jsonBytes = bytes.byteLength > MAX_JSON_BYTES ? null : bytes;
  }
  if (!jsonBytes) return null;

  let json: string;
  try {
    // fatal: true so mangled bytes fail loudly here instead of becoming a
    // string full of replacement characters that then fails JSON.parse.
    json = new TextDecoder('utf-8', { fatal: true }).decode(jsonBytes);
  } catch {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }

  // Validate the shape before trusting it. An attacker controls this object,
  // so anything that isn't a plain record of two strings is rejected — a
  // number where `code` should be would otherwise reach the editor.
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const { code, name } = parsed as { code?: unknown; name?: unknown };
  if (typeof code !== 'string' || typeof name !== 'string') return null;

  return { code, name };
}

// ─── cleanup ─────────────────────────────────────────────────────────────────

/**
 * Strip the share payload from the address bar once it has been consumed.
 *
 * Uses history.replaceState so the page does not reload — a reload would
 * throw away the scene we just loaded — and so no history entry is added.
 * That last part matters: pushing an entry (or assigning location.hash) would
 * leave Back pointing at the same URL with the payload still on it, which
 * either does nothing visible or re-prompts the user forever.
 */
export function clearShareFromLocation(): void {
  const loc = globalThis.location;
  const hist = globalThis.history;
  if (!loc) return;
  if (typeof hist?.replaceState !== 'function') return; // no safe way to do this; leave the URL alone

  try {
    // pathname + search, with the hash simply omitted. Passing '' or '#'
    // would keep a bare '#' hanging off the URL in some browsers.
    hist.replaceState(hist.state, '', `${loc.pathname}${loc.search}`);
  } catch {
    // Some embedded/sandboxed contexts refuse replaceState for a URL they
    // consider cross-origin. Cosmetic only — the scene is already loaded.
  }
}
