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
const DEFAULT_SCENE = 'default';

type SceneMap = Record<string, string>;

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

/** Sorted list of existing scene names. DEFAULT_SCENE is pinned first
 *  so the dropdown always leads with "default". */
export function listScenes(): string[] {
  const names = Object.keys(readAll());
  names.sort((a, b) => {
    if (a === DEFAULT_SCENE) return -1;
    if (b === DEFAULT_SCENE) return 1;
    return a.localeCompare(b);
  });
  return names;
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
  if (!map['ultratonics 11']) {
    map['ultratonics 11'] = ULTRATONICS_11_TEMPLATE;
    changed = true;
  }
  if (changed) writeAll(map);
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
const ULTRATONICS_11_TEMPLATE = `// ultratonics 11 — live-performance template (Ryoji Ikeda)
//
// Each musical element below is a function. Add a call to the LIVE
// block at the bottom to bring it in, remove the call to drop it.
// Ctrl+Enter re-evaluates; Ctrl+. zeroes every channel.
//
// Load the actual track in the audio bar at the bottom of the screen
// if you want the audio-reactive variants to follow the recording.
// Otherwise tap-tempo or setBPM() to match by ear.

artnet('2.0.0.100')
setBPM(130)

// ── fixtures ──────────────────────────────────────────────
// Spot = any simple 4-channel RGBW par at DMX ch 1-4, universe 0.
// Bar  = the custom four-colour moving bar from the public library.
const spot = fixture(1, 'generic-rgbw').viz('color')
const bar  = fixture(1, 'four-color-bar', 1)
bar.pixels.viz('strip')
bar.dim(1)

// ── instrument library ────────────────────────────────────
// Calling a function REGISTERS its patterns. Not calling it means
// those channels stay at zero. Each eval wipes previous patterns
// first, so the set of called functions is the full current state.

// KICK — sparse downbeat thud on the spot's dimmer.
function kick() {
  spot.dim(mini('1 - - -').flash())
}

// KICK_DOUBLE — kick on beats 1 and 3 of each bar.
function kickDouble() {
  spot.dim(mini('1 - 1 -').flash())
}

// HATS — 16th-note clicks. Bright high-frequency detail.
function hats() {
  spot.white(mini('1 1 1 1  1 1 1 1  1 1 1 1  1 1 1 1').range(0, 0.35))
}

// HATS_OFFBEAT — only the off-beats, sparser.
function hatsOffbeat() {
  spot.white(mini('- 1 - 1 - 1 - 1').range(0, 0.4))
}

// SINE_TONE — long pulsing blue drone. Classic Ikeda texture.
function sineTone() {
  spot.blue(sine().slow(16).range(0.1, 0.9).glow())
}

// NOISE_BURST — sparse red spikes from thresholded randomness.
function noiseBurst() {
  spot.red(rand().range(-6, 1))
}

// BAR_PULSE — whole-bar white flash on every downbeat.
function barPulse() {
  bar.pixels.white(mini('1 - - -').range(-15, 1).flash())
}

// BAR_SWEEP — rainbow chase across the bar, half-note timed.
function barSweep() {
  bar.pixels.rainbowChase({ speed: 2, narrow: 12 })
}

// BAR_STROBE — continuous 16th-note strobe. Use sparingly (drops only).
function barStrobe() {
  bar.pixels.white(mini('1*16').range(-4, 1))
}

// BAR_OFF — blackout the bar.
function barOff() {
  bar.pixels.fill(0, 0, 0, 0)
}

// ── audio-reactive variants ──────────────────────────────
// Route real audio features (from the loaded track) to lights.
// Load a file via the audio bar first; these no-op without audio.

function audioKick()  { spot.dim(audio.peak()) }
function audioBass()  { spot.red(audio.bass().range(0, 1).glow()) }
function audioHats()  { spot.white(audio.treble().range(0, 0.5)) }
function audioBar()   {
  bar.pixels.rainbowChase({ speed: 1 })
  bar.pixels.white(audio.peak().range(0, 1))
}

// ── LIVE ──────────────────────────────────────────────────
// Uncomment the elements you want active right now, save with
// Ctrl+Enter. Group the uncommented calls by song section so you
// can eyeball which block is live.

// --- intro ---
// sineTone()
// hatsOffbeat()

// --- build ---
// kick()
// hats()
// noiseBurst()

// --- drop ---
// kickDouble()
// barPulse()
// barStrobe()

// --- outro ---
// sineTone()
// barOff()

// --- audio-driven alternatives (load a track first) ---
// audioKick()
// audioBass()
// audioHats()
// audioBar()
`;
