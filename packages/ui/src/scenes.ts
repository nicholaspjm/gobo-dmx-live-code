/**
 * Scenes — multiple named editor buffers, persisted to localStorage.
 *
 * Each scene is a separate slab of lumen code (fixtures + patterns).
 * The active scene's source is loaded into the editor at startup, and
 * the editor autosaves back to it on every change. Switching scenes
 * writes out the current buffer and loads the selected one.
 *
 * Seeded on first run with the hardcoded default (the same content that
 * used to be the only init code) plus a "ultratonics 11" template
 * pre-structured for live performance against the Ryoji Ikeda track —
 * instruments defined up top, a LIVE block at the bottom where the
 * performer toggles elements by comment/uncomment + Ctrl+Enter.
 */

const SCENES_KEY = 'lumen-scenes-v1';
const ACTIVE_KEY = 'lumen-active-scene-v1';
const META_KEY   = 'lumen-scene-meta-v1';
const DEFAULT_SCENE = 'default';

type SceneMap = Record<string, string>;

/** Per-scene metadata — small so we can store it as its own JSON blob
 *  and migrate either side without touching the other. Currently just
 *  a last-accessed timestamp used to sort the dropdown by recency. */
interface SceneMeta {
  /** Wall-clock ms when the scene was last activated or edited. */
  lastAccessedAt: number;
}
type SceneMetaMap = Record<string, SceneMeta>;

// ─── Storage ─────────────────────────────────────────────────────────────────

function readAll(): SceneMap {
  try {
    const raw = localStorage.getItem(SCENES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as SceneMap;
  } catch {
    return {};
  }
}

function writeAll(map: SceneMap): void {
  try { localStorage.setItem(SCENES_KEY, JSON.stringify(map)); } catch {
    // Full disk / private mode — scene will still work in-memory for the
    // session but won't persist across reloads.
  }
}

function readMeta(): SceneMetaMap {
  try {
    const raw = localStorage.getItem(META_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as SceneMetaMap;
  } catch {
    return {};
  }
}

function writeMeta(map: SceneMetaMap): void {
  try { localStorage.setItem(META_KEY, JSON.stringify(map)); } catch { /* see above */ }
}

/** Stamp `lastAccessedAt` for this scene. Call when the user opens,
 *  creates, or edits a scene — any interaction that signals "I care
 *  about this one right now". */
export function touchScene(name: string): void {
  const meta = readMeta();
  meta[name] = { lastAccessedAt: Date.now() };
  writeMeta(meta);
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function getActiveScene(): string {
  return localStorage.getItem(ACTIVE_KEY) ?? DEFAULT_SCENE;
}

export function setActiveScene(name: string): void {
  try { localStorage.setItem(ACTIVE_KEY, name); } catch { /* see above */ }
}

export function getSceneCode(name: string): string | null {
  return readAll()[name] ?? null;
}

export function saveSceneCode(name: string, code: string): void {
  const map = readAll();
  map[name] = code;
  writeAll(map);
}

/** Sorted list of existing scene names. DEFAULT_SCENE is pinned first;
 *  everything else is sorted by `lastAccessedAt` (most recent first),
 *  falling back to alphabetical for scenes that haven't been touched. */
export function listScenes(): string[] {
  const names = Object.keys(readAll());
  const meta = readMeta();
  names.sort((a, b) => {
    if (a === DEFAULT_SCENE) return -1;
    if (b === DEFAULT_SCENE) return 1;
    const ma = meta[a]?.lastAccessedAt ?? 0;
    const mb = meta[b]?.lastAccessedAt ?? 0;
    if (ma !== mb) return mb - ma;
    return a.localeCompare(b);
  });
  return names;
}

/**
 * File-picker-style view of the scenes: the default scene in its own
 * group, then "recent" scenes ordered by access time, then everything
 * else alphabetically. Used by the topbar dropdown so the structure
 * reads the way users expect ("default" / "recent" / "all").
 */
export interface ScenesView {
  default: string[];
  recent: string[];
  other: string[];
}

export function getScenesView(recentLimit = 5): ScenesView {
  const sorted = listScenes();
  const meta = readMeta();
  const default_ = sorted.filter((n) => n === DEFAULT_SCENE);
  const rest = sorted.filter((n) => n !== DEFAULT_SCENE);
  const hasTs = (n: string): boolean => (meta[n]?.lastAccessedAt ?? 0) > 0;
  const touched   = rest.filter((n) => hasTs(n));
  const untouched = rest.filter((n) => !hasTs(n));
  return {
    default: default_,
    recent: touched.slice(0, recentLimit),
    other: [...touched.slice(recentLimit), ...untouched].sort(),
  };
}

export function deleteScene(name: string): boolean {
  if (name === DEFAULT_SCENE) return false; // protect the default
  const map = readAll();
  if (!(name in map)) return false;
  delete map[name];
  writeAll(map);
  return true;
}

export function createScene(name: string, code = ''): boolean {
  const map = readAll();
  if (name in map) return false;
  map[name] = code;
  writeAll(map);
  return true;
}

/**
 * Seed the built-in scenes on first run. Called from main.ts at startup
 * with the hardcoded default code (previously the only init code). Never
 * overwrites an existing scene — once seeded, the user's edits are king.
 */
export function seedScenesIfEmpty(defaultCode: string): void {
  const map = readAll();
  let changed = false;
  if (!map[DEFAULT_SCENE]) {
    map[DEFAULT_SCENE] = defaultCode;
    changed = true;
  }
  // One-time migration: my earlier seed had a typo ('ultratonics'); the
  // real album title is 'ultratronics'. If the user has the typo version
  // and no corrected version, rename it in place and preserve any edits
  // they made. If both exist, they already sorted it out themselves.
  if (map['ultratonics 11'] && !map['ultratronics 11']) {
    map['ultratronics 11'] = map['ultratonics 11'];
    delete map['ultratonics 11'];
    if (getActiveScene() === 'ultratonics 11') setActiveScene('ultratronics 11');
    changed = true;
  }
  if (!map['ultratronics 11']) {
    map['ultratronics 11'] = ULTRATONICS_11_TEMPLATE;
    changed = true;
  }
  if (changed) writeAll(map);
}

/**
 * Overwrite a named seed scene with the current template, bypassing the
 * "don't overwrite user edits" rule of seedScenesIfEmpty. Used by the UI
 * when the user wants to pick up an updated built-in template after a
 * release. No-op for scene names that don't have a built-in template.
 */
export function resetSeedScene(name: string): boolean {
  if (name === DEFAULT_SCENE) return false;
  const seed = builtInSeeds()[name];
  if (!seed) return false;
  const map = readAll();
  map[name] = seed;
  writeAll(map);
  return true;
}

/** Ids that `resetSeedScene` knows how to re-seed. */
export function listSeedScenes(): readonly string[] {
  return Object.keys(builtInSeeds());
}

/** Function instead of an object literal so forward-referencing
 *  ULTRATONICS_11_TEMPLATE (declared further down) is safe. */
function builtInSeeds(): Record<string, string> {
  return {
    'ultratronics 11': ULTRATONICS_11_TEMPLATE,
  };
}

// ─── Built-in templates ──────────────────────────────────────────────────────

/**
 * Live-performance template structured for Ryoji Ikeda's "ultratonics 11".
 * Each musical element is a named function; the performer turns elements
 * on/off by editing the LIVE block at the bottom and re-evaluating.
 *
 * Ikeda's style is minimalist: sparse kick, fast hi-hat-like click
 * textures, long sine drones, occasional noise bursts, sudden drops
 * and silences. The instrument palette here is chosen to match that
 * vocabulary with two-fixture gear (simple RGBW + the custom bar).
 *
 * BPM is set to 130 as a rough starting point — tap-tempo or setBPM()
 * when you rehearse to lock the internal clock to the actual track,
 * or enable the audio-reactive variants to follow the recording.
 */
const ULTRATONICS_11_TEMPLATE = `// ultratronics 11 — Ryoji Ikeda · 5:30 · 108 BPM
//
// Section cues extracted from the actual track via librosa analysis
// (scripts/analyse-track.py). Timings are seconds into the file —
// keep this comment pinned for rehearsal.
//
//   0:00  intro            sparse, dark · rms ~0.33
//   0:36  development      bass creeping in · rms ~0.36
//   1:12  first shift      texture change · rms ~0.39→0.68
//   1:35  main body        full drive · rms 0.70–0.94 (peaks ~2:10)
//   3:00  second wave      peak intensity · rms 0.72–0.98 (peak ~3:40)
//   4:36  outro            ebb · rms 0.56–0.60
//   5:21  fade             rms falls to silence
//
// Load the audio file in the bar below and tap 'play'. setBPM(108)
// is already wired; if librosa's estimate drifts from what you hear,
// tap-tempo with T. Audio-reactive variants follow the recording when
// the track is playing; the non-audio ones run off the internal clock.

artnet('2.0.0.100')
setBPM(108)

// ── fixtures ──────────────────────────────────────────────
// spot = simple RGBW par at uni 0 ch 1-4.
// bar  = four-colour moving bar from the public library on uni 1.
const spot = fixture(1, 'generic-rgbw').viz('color')
const bar  = fixture(1, 'four-color-bar', 1)
bar.pixels.viz('strip')
bar.dim(1)

// ── instrument library ────────────────────────────────────
// Each call registers patterns on specific colour channels on the
// spot (r / g / b / w) — we have a 4-channel RGBW par with no
// dedicated dim, so brightness comes from driving the colour
// channels directly. One function per channel family at a time:
//
//   WHITE  → kicks / peaks
//   GREEN  → hi-hats / mid detail
//   BLUE   → drones
//   RED    → noise / bass
//
// Two functions that share a channel family will override each
// other (last call wins). Uncomment one from each family when you
// want them running in parallel.

// ── WHITE · kicks / peaks ─────────────────────────────────
function kickSlow()   { spot.white(mini('1 - - -').slow(2).flash()) }
function kick()       { spot.white(mini('1 - - -').flash()) }
function kickDouble() { spot.white(mini('1 - 1 -').flash()) }

// ── GREEN · hats / mid detail ─────────────────────────────
function hatsOffbeat() { spot.green(mini('- 1 - 1 - 1 - 1').range(0, 0.4)) }
function hats()        { spot.green(mini('1 1 1 1  1 1 1 1  1 1 1 1  1 1 1 1').range(0, 0.35)) }
function hatsDense()   { spot.green(mini('1*32').range(-2, 0.6)) }

// ── BLUE · drones ─────────────────────────────────────────
function sineDeep()  { spot.blue(sine().slow(32).range(0.3, 0.8).glow()) }
function sineTone()  { spot.blue(sine().slow(16).range(0.1, 0.9).glow()) }

// ── RED · noise / bass ────────────────────────────────────
function noiseBurst() { spot.red(rand().range(-6, 1)) }

// ── BAR · independent 8-pixel RGBW moving bar on universe 1 ──
function barPulse()  { bar.pixels.white(mini('1 - - -').range(-15, 1).flash()) }
function barSweep()  { bar.pixels.rainbowChase({ speed: 2, narrow: 12 }) }
function barStrobe() { bar.pixels.white(mini('1*16').range(-4, 1)) }
function barOff()    { bar.pixels.fill(0, 0, 0, 0) }

// ── audio-reactive variants ──────────────────────────────
// Route real audio features to lights. Only meaningful once the
// track is loaded and playing. Same channel-family rule applies:
// audioKick and kick both drive white, audioBass and noiseBurst
// both drive red — pick one per family.
function audioKick() { spot.white(audio.peak()) }
function audioHats() { spot.green(audio.treble().range(0, 0.5)) }
function audioMid()  { spot.green(audio.mid().range(0, 0.7)) }
function audioBass() { spot.red(audio.bass().range(0, 1).glow()) }
function audioBar()  {
  bar.pixels.rainbowChase({ speed: 1 })
  bar.pixels.white(audio.peak().range(0, 1))
}

// ── LIVE ──────────────────────────────────────────────────
// Uncomment elements per section, Ctrl+Enter to apply. Section cue
// times in the header comment. You're not required to follow them —
// improvise — but the grouping below is a suggested arrangement.

// --- intro · 0:00-0:36 · minimal ---
// sineDeep()

// --- development · 0:36-1:12 · bass creeps in ---
// sineDeep()
// audioBass()
// hatsOffbeat()

// --- first shift · 1:12-1:35 · texture change ---
// sineTone()
// hatsOffbeat()
// noiseBurst()

// --- main body · 1:35-3:00 · full drive ---
// kick()
// hats()
// sineTone()
// barSweep()

// --- second wave · 3:00-4:36 · peak intensity ---
// kickDouble()
// hats()
// barPulse()
// audioBar()

// --- outro · 4:36-5:21 · ebb ---
// sineTone()
// hatsOffbeat()

// --- fade · 5:21-5:30 ---
// barOff()

// --- full audio-reactive alt (works across the whole track) ---
// audioKick()
// audioBass()
// audioMid()
// audioHats()
// audioBar()
`;
