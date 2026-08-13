/**
 * Scene files — save the working buffer to disk, read one back.
 *
 * The editor holds a single working buffer that autosaves to the browser.
 * That covers "don't lose my set on a refresh", but it is still one origin,
 * one machine, one cleared-cache away from gone. A file is the durable copy:
 * the user owns it, backs it up, emails it, keeps it next to the show.
 *
 * Wire format (a `.gobo` file is JSON):
 *   {
 *     "goboScene": 1,                          // schema version, bump if reshaped
 *     "name": "ultratronics 11",               // scene name, restored on open
 *     "code": "artnet('2.0.0.100')...",        // the entire editor buffer
 *     "savedAt": "2026-08-13T19:04:11.912Z"    // ISO 8601, informational only
 *   }
 *
 * Versioned and envelope-shaped for the same reason the fixture export is
 * (see packages/core/src/fixture-library.ts): a file written today has to
 * still open in a build that has since grown per-scene BPM, tags, or a
 * fixture manifest, and a file from a *newer* build has to fail with an
 * explanation instead of loading half a scene.
 *
 * Opening is deliberately forgiving in one direction only. A `.js` or `.txt`
 * file with no envelope is accepted as raw code — people paste sets into
 * scratch files and expect to open them — but anything that claims to be an
 * envelope is held to the schema. The decision is made on CONTENT, not on the
 * extension, so a `.gobo` file someone renamed still opens and a `.js` file
 * that happens to contain a saved envelope still restores its name.
 */

/** On-disk shape of a saved scene. */
export interface SceneFile {
  goboScene: 1;
  name: string;
  code: string;
  savedAt: string;
}

/** Current schema version. Only files carrying exactly this open. */
const SCENE_FILE_VERSION = 1;

const FILE_EXTENSION = '.gobo';

/** Extensions offered in the picker. `.js` / `.txt` are here because raw-code
 *  files are a supported input, not because we trust the extension. */
const ACCEPTED_EXTENSIONS = '.gobo,.js,.txt';

/**
 * Extensions stripped when deriving a scene name from a filename. Kept to a
 * known list rather than "everything after the last dot" so a scene genuinely
 * called `ultratronics 11.2` keeps its name.
 */
const KNOWN_EXTENSIONS = /\.(gobo|js|mjs|txt|json)$/i;

/**
 * Path separators plus the printable characters Windows forbids in a
 * filename. Replaced with a space rather than deleted so `a/b` reads as
 * `a b` instead of collapsing to `ab`. Control codes are handled separately
 * by stripControlChars().
 */
const ILLEGAL_FILENAME_CHARS = /[<>:"/\\|?*]/g;

/** Windows refuses these as filenames whatever the extension. */
const RESERVED_FILENAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** Filenames are capped well under the ~255-byte limit so there is room for
 *  the extension plus whatever " (1)" suffix the browser adds on collision. */
const MAX_FILENAME_BASE = 64;

/** Scene names are shown in the topbar, so a pasted essay gets trimmed. */
const MAX_SCENE_NAME = 80;

const FALLBACK_FILENAME = 'scene';
const FALLBACK_SCENE_NAME = 'untitled';

// ─── Save ────────────────────────────────────────────────────────────────────

/**
 * Build a `.gobo` file from the buffer and hand it to the browser's
 * downloader. Fire-and-forget: there is no way to observe whether the user
 * kept the file, so callers should treat the call itself as the save point.
 */
export function downloadScene(name: string, code: string): void {
  const file: SceneFile = {
    goboScene: SCENE_FILE_VERSION,
    name: cleanSceneName(name) || FALLBACK_SCENE_NAME,
    code,
    savedAt: new Date().toISOString(),
  };
  const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = sceneFilename(name);
  // Appended before clicking: a detached anchor's click is ignored by Firefox.
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoking synchronously can cancel the download before the browser has
  // finished reading the blob, so defer past the point where it has started.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Turn a scene name into a filename that is legal on Windows, macOS and
 * Linux: no path separators (a name containing `/` must not be able to steer
 * where the file lands), none of the characters Windows rejects, no control
 * codes, no trailing dot or space, not a reserved device name, and not
 * absurdly long. Falls back to a generic name when nothing usable survives.
 *
 * Exported for tests — the UI should call downloadScene().
 */
export function sceneFilename(name: string): string {
  let base = stripControlChars(String(name ?? ''))
    .replace(ILLEGAL_FILENAME_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (base.length > MAX_FILENAME_BASE) base = base.slice(0, MAX_FILENAME_BASE).trim();

  // Windows silently drops a trailing dot or space, which turns "v1." into a
  // name that doesn't match what the user typed. Trim after the length cap so
  // a truncation that lands on a dot is caught too.
  base = base.replace(/[. ]+$/, '');

  // `con.gobo` is unopenable on Windows — the OS resolves it to the console
  // device. Suffixing is friendlier than falling back to a generic name.
  if (RESERVED_FILENAMES.test(base)) base = `${base}-scene`;

  if (!base) base = FALLBACK_FILENAME;

  return base + FILE_EXTENSION;
}

// ─── Open ────────────────────────────────────────────────────────────────────

export type ParsedScene =
  | { ok: true; name: string; code: string }
  | { ok: false; reason: string };

/**
 * Parse the text of an opened file. Never throws — every failure comes back
 * as `{ ok: false, reason }` with a sentence the UI can show verbatim.
 *
 * Accepts either a `.gobo` envelope or raw code, decided by content:
 *
 *   - Parses as a JSON object carrying a `goboScene` key → treated as an
 *     envelope and validated. A wrong version or a missing/non-string `code`
 *     is an error, because the file is claiming to be something it isn't and
 *     silently loading it as source would drop a wall of JSON into the editor.
 *   - Anything else → the whole text is the code, and the name is derived
 *     from the filename. This includes JSON that is *not* an envelope: a
 *     scene is JavaScript, and `{ a: 1 }` is a legal (if dull) program.
 */
export function parseSceneText(text: string, filename: string): ParsedScene {
  if (typeof text !== 'string' || text.trim() === '') {
    return { ok: false, reason: 'That file is empty.' };
  }

  const read = readEnvelope(text);
  if (read.kind === 'invalid') return { ok: false, reason: read.reason };
  if (read.kind === 'envelope') {
    // A missing or non-string name is not worth rejecting the file over —
    // the filename is a perfectly good name and the code is what matters.
    return {
      ok: true,
      name: cleanSceneName(read.name) || sceneNameFromFilename(filename),
      code: read.code,
    };
  }
  return { ok: true, name: sceneNameFromFilename(filename), code: text };
}

/**
 * Show a file picker and read the chosen scene. Resolves `null` when the
 * user cancels.
 *
 * REJECTS (rather than resolving null) when a file was chosen but isn't a
 * scene we can open — the rejection message is the reason from
 * parseSceneText, ready to show. Callers must try/catch: `null` means "user
 * changed their mind, say nothing", a throw means "tell them why it failed".
 */
export async function openSceneFile(): Promise<{ name: string; code: string } | null> {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = ACCEPTED_EXTENSIONS;
  input.style.display = 'none';
  // Some browsers ignore .click() on an element outside the document.
  document.body.appendChild(input);

  let file: File | null;
  try {
    file = await pickFile(input);
  } finally {
    input.remove();
  }
  if (!file) return null;

  const text = await file.text();
  const result = parseSceneText(text, file.name);
  if (!result.ok) throw new Error(result.reason);
  return { name: result.name, code: result.code };
}

/**
 * Grace period after the window regains focus before we call it a cancel.
 * Generous because the cost of guessing wrong (dropping a file the user did
 * pick) is far worse than a second of nothing happening on a real cancel.
 */
const CANCEL_GRACE_MS = 1000;

/**
 * Open the picker and resolve the chosen File, or null if the user dismissed
 * the dialog.
 *
 * Detecting the dismissal is the awkward part: `<input type=file>` fires no
 * event at all on cancel in older engines. Two signals are used together:
 *
 *   1. The `cancel` event, which is exact — but only landed in Chrome 113 /
 *      Firefox 109 / Safari 16.4, so it cannot be the only signal.
 *   2. Window focus. The picker is modal, so focus returns to the page only
 *      once it has closed; if no `change` has arrived a beat after that, the
 *      user picked nothing.
 *
 * Whichever fires first wins, and `settled` keeps the promise single-shot.
 * The File System Access API (`showOpenFilePicker`) reports cancellation
 * cleanly but is Chromium-only, and we would still need this path for
 * everyone else — two implementations of one dialog, for a tidier cancel.
 */
function pickFile(input: HTMLInputElement): Promise<File | null> {
  return new Promise((resolve) => {
    let settled = false;

    const finish = (file: File | null): void => {
      if (settled) return;
      settled = true;
      window.removeEventListener('focus', onFocus);
      resolve(file);
    };

    const onFocus = (): void => {
      window.setTimeout(() => finish(null), CANCEL_GRACE_MS);
    };

    input.addEventListener('change', () => finish(input.files?.[0] ?? null), { once: true });
    input.addEventListener('cancel', () => finish(null), { once: true });

    input.click();
    // Registered after the click so the click itself can't be mistaken for
    // the picker closing.
    window.addEventListener('focus', onFocus);
  });
}

// ─── Internals ───────────────────────────────────────────────────────────────

type EnvelopeRead =
  | { kind: 'envelope'; name: unknown; code: string }
  | { kind: 'not-envelope' }
  | { kind: 'invalid'; reason: string };

/**
 * Decide whether `text` is a scene envelope, and validate it if so.
 *
 * `goboScene` is the marker: its presence means the file is claiming to be a
 * scene file, and from that point on a problem is an error rather than a
 * reason to fall back to treating the text as code.
 */
function readEnvelope(text: string): EnvelopeRead {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { kind: 'not-envelope' }; // ordinary source code
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { kind: 'not-envelope' }; // a bare string / number / array literal
  }

  const env = parsed as Record<string, unknown>;
  if (!('goboScene' in env)) return { kind: 'not-envelope' }; // some other JSON

  if (env.goboScene !== SCENE_FILE_VERSION) {
    return {
      kind: 'invalid',
      reason:
        `This scene file is version ${describeVersion(env.goboScene)}, ` +
        `but this build only reads version ${SCENE_FILE_VERSION}. ` +
        'Update gobo, or open the file in a text editor and copy the code out.',
    };
  }
  if (typeof env.code !== 'string') {
    return {
      kind: 'invalid',
      reason: "This scene file is damaged — its 'code' is missing or isn't text.",
    };
  }
  return { kind: 'envelope', name: env.name, code: env.code };
}

/** Render a rejected version value for an error message. */
function describeVersion(value: unknown): string {
  if (typeof value === 'number') return String(value);
  return JSON.stringify(value) ?? 'unknown';
}

/**
 * Replace C0 control codes and DEL with spaces.
 *
 * Done by code point rather than a regex character class because control
 * characters in a source file are invisible to whoever reads this next —
 * and a mangled escape here would silently stop sanitising.
 */
function stripControlChars(value: string): string {
  let out = '';
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    out += code < 0x20 || code === 0x7f ? ' ' : ch;
  }
  return out;
}

/**
 * Normalise a scene name: no control codes, no runs of whitespace, trimmed,
 * length-capped. Returns '' when nothing usable is left, so callers can use
 * `||` to reach for their own fallback.
 *
 * Deliberately does NOT strip characters that are merely illegal in
 * filenames — a scene may be called "50/50", and sceneFilename() handles the
 * filesystem's objections at download time.
 */
function cleanSceneName(value: unknown): string {
  if (typeof value !== 'string') return '';
  const cleaned = stripControlChars(value).replace(/\s+/g, ' ').trim();
  return cleaned.length > MAX_SCENE_NAME ? cleaned.slice(0, MAX_SCENE_NAME).trim() : cleaned;
}

/** Derive a scene name from the file's name: last path segment, known
 *  extension removed, normalised. */
function sceneNameFromFilename(filename: string): string {
  const base = String(filename ?? '').split(/[\\/]/).pop() ?? '';
  return cleanSceneName(base.replace(KNOWN_EXTENSIONS, '')) || FALLBACK_SCENE_NAME;
}
