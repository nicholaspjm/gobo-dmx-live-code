/**
 * Scene files — save the working buffer to disk, read one back.
 *
 * The editor holds a single working buffer that autosaves to the browser.
 * That covers "don't lose my set on a refresh", but it is still one origin,
 * one machine, one cleared-cache away from gone. A file is the durable copy:
 * the user owns it, backs it up, emails it, keeps it next to the show.
 *
 * A saved scene is the code and nothing else, written as a `.js` file.
 *
 * It used to be a JSON envelope carrying the name, the code and a timestamp.
 * That was backwards for a tool whose whole premise is that a scene IS
 * readable code: JSON escapes the source into a single unreadable line, so
 * the file could not be read, edited, diffed or syntax-highlighted anywhere
 * outside gobo. Everything the envelope carried has a better home — the name
 * is the filename, the save time is the file's own mtime, and plain code has
 * no format to version. `.js` rather than `.txt` because it IS JavaScript:
 * editors highlight it, gists render it, formatters and diffs understand it.
 *
 * Opening still accepts the old envelope so files written by the previous
 * build keep working (see readLegacyEnvelope). The decision is made on
 * CONTENT, not on the extension, so a `.gobo` file someone renamed still
 * opens and a `.js` file that happens to hold an old envelope still restores
 * its name. Anything else is raw code, named after the file it came from.
 */

/**
 * On-disk shape of a scene saved by builds up to 0.2.0. READ ONLY — nothing
 * here writes this shape any more; it exists so those files still open.
 */
export interface LegacySceneFile {
  goboScene: 1;
  name: string;
  code: string;
  savedAt: string;
}

/** The only envelope version that ever shipped. */
const LEGACY_SCENE_FILE_VERSION = 1;

const FILE_EXTENSION = '.js';

/** Extensions offered in the picker. `.gobo` is here for files written by the
 *  old build; `.txt` because people paste sets into scratch files. None of
 *  them are trusted — parseSceneText decides on content. */
const ACCEPTED_EXTENSIONS = '.js,.txt,.gobo';

/**
 * Extensions stripped when deriving a scene name from a filename. Anchored to
 * the end and matched once, so only the LAST one goes: `act 2.5 final.js`
 * opens as `act 2.5 final`, not as `act 2`. Kept to a known list rather than
 * "everything after the last dot" so a scene genuinely called
 * `ultratronics 11.2` keeps its name even with no extension on the file.
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
 * Write the buffer to a `.js` file and hand it to the browser's downloader.
 *
 * The blob is the code verbatim — no envelope, no re-indentation, no trailing
 * newline added. What the user sees in the editor is what lands in the file,
 * byte for byte, because the file is the thing they will open in an editor
 * next. `name` only decides what the file is called.
 *
 * Fire-and-forget: there is no way to observe whether the user kept the file,
 * so callers should treat the call itself as the save point.
 */
export function downloadScene(name: string, code: string): void {
  // charset is spelled out because the code may carry non-ASCII (fixture
  // labels, comments) and a downloaded file has no page encoding to inherit.
  const blob = new Blob([code], { type: 'text/javascript;charset=utf-8' });
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
 * Now that the name lives ONLY in the filename, this function and
 * sceneNameFromFilename() are a matched pair, and the property that matters
 * is that they settle: sanitising can rename a scene once (`50/50` saves as
 * `50 50.js` and reopens as `50 50`), but re-saving that reopened name
 * produces the identical filename, so a name cannot drift a little further on
 * every save/open cycle. Every rewrite here is one the user can see — it is in
 * the filename they were just handed and in the topbar when they reopen it.
 *
 * Exported for tests, and for main.ts to tell the user which file it wrote.
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

  // `con.js` is unopenable on Windows — the OS resolves it to the console
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
 * Raw code is the normal path; the legacy envelope is still read. Decided by
 * content, never by the extension:
 *
 *   - Parses as a JSON object carrying a `goboScene` key → an envelope from
 *     an older build, validated before use. A wrong version or a
 *     missing/non-string `code` is an error, because the file is claiming to
 *     be something it isn't and silently loading it as source would drop a
 *     wall of JSON into the editor.
 *   - Anything else → the whole text is the code, and the name comes from the
 *     filename minus its extension. This includes JSON that is *not* an
 *     envelope: a scene is JavaScript, and `{ a: 1 }` is a legal (if dull)
 *     program.
 */
export function parseSceneText(text: string, filename: string): ParsedScene {
  if (typeof text !== 'string' || text.trim() === '') {
    return { ok: false, reason: 'That file is empty.' };
  }

  const read = readLegacyEnvelope(text);
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
 * Decide whether `text` is a legacy scene envelope, and validate it if so.
 *
 * `goboScene` is the marker — presence of the KEY, not the extension, because
 * a file written by the old build may have been renamed since. Once it is
 * there the file is claiming to be a scene file, so a problem from that point
 * on is an error rather than a reason to fall back to treating it as code.
 */
function readLegacyEnvelope(text: string): EnvelopeRead {
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

  if (env.goboScene !== LEGACY_SCENE_FILE_VERSION) {
    return {
      kind: 'invalid',
      reason:
        `This scene file says it is version ${describeVersion(env.goboScene)}, ` +
        `but the only scene-file format gobo ever wrote was version ${LEGACY_SCENE_FILE_VERSION}. ` +
        'Open it in a text editor and copy the code out.',
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
 *  extension removed, normalised. The inverse of sceneFilename() — see the
 *  settling property documented there. */
function sceneNameFromFilename(filename: string): string {
  const base = String(filename ?? '').split(/[\\/]/).pop() ?? '';
  return cleanSceneName(base.replace(KNOWN_EXTENSIONS, '')) || FALLBACK_SCENE_NAME;
}
