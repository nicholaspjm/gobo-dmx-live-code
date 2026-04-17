/**
 * Audio integration (optional).
 *
 * File-upload or live-mic audio that patterns can pull from. Three moving parts:
 *
 *   1. One shared Web Audio AudioContext + AnalyserNode. The source (file
 *      buffer or mic stream) is swapped into the graph on load/mic-enable.
 *
 *   2. A per-tick band reader that computes bass / mid / treble / rms / peak
 *      from the analyser's frequency data and stores the latest values in
 *      module-scope. Pattern factories (`audio.bass()` etc.) are
 *      `PatternLike` objects whose queryArc returns the current stored value,
 *      so they ignore the cycle-time argument — they're "live" values, not
 *      parametric waveforms. Same `.range / .add / .mul / .slow / .fast`
 *      chain as the fallback waveforms so users can `audio.bass().range(0, 1)`.
 *
 *   3. An external clock provider registered with the scheduler. When a track
 *      is loaded and playing, cyclePos is pinned to (audioPosition * bpm /
 *      60 / BEATS_PER_CYCLE) so pattern phase tracks the music through
 *      pauses and seeks. Mic mode doesn't drive the clock (no meaningful
 *      position) — internal wall-clock keeps running there.
 *
 * Not a main feature — if no track is loaded and mic isn't enabled, this
 * module sits idle and everything else behaves exactly as before.
 */

import { setBPM, setClockProvider } from './scheduler.js';
import type { PatternLike } from './dmx.js';
import { attachPatternVizMethods } from './pattern-viz.js';

// ─── Web Audio graph ─────────────────────────────────────────────────────────

// Matches BEATS_PER_CYCLE in scheduler.ts. Duplicated as a local constant
// to avoid a circular import.
const BEATS_PER_CYCLE = 4;

let _ctx: AudioContext | null = null;
let _analyser: AnalyserNode | null = null;
// Explicit ArrayBuffer generic — getByteFrequencyData rejects the default
// ArrayBufferLike variant (newer TS lib.dom).
let _freqData: Uint8Array<ArrayBuffer> | null = null;

/** Buffer-backed file playback. Recreated on each play() because BufferSource
 *  nodes are one-shot. */
let _bufferSource: AudioBufferSourceNode | null = null;
let _audioBuffer: AudioBuffer | null = null;

/** Mic source — kept around so we can disconnect cleanly. */
let _micSource: MediaStreamAudioSourceNode | null = null;
let _micStream: MediaStream | null = null;

type Source = 'file' | 'mic' | null;
let _source: Source = null;

// ─── Playback state (file only) ──────────────────────────────────────────────

let _trackName = '';
let _duration = 0;
let _bpm: number | null = null;

/** Where we were in the track when play() was most recently called. */
let _playHeadSec = 0;
/** The AudioContext time at that same moment. Lets us derive live position. */
let _playStartCtxTime = 0;
let _isPlaying = false;

// ─── Band values (updated each tick from the analyser) ───────────────────────

let _bass = 0;
let _mid = 0;
let _treble = 0;
let _rms = 0;
let _peak = 0;

// Rolling RMS history for peak detection (~500ms at 60Hz ticks).
const _rmsHistory: number[] = [];
const RMS_HISTORY_LEN = 30;
let _lastPeakMs = 0;
const PEAK_REFRACTORY_MS = 120;
const PEAK_DECAY_PER_TICK = 0.07; // ≈150ms to zero at 60Hz

// ─── Context lifecycle ───────────────────────────────────────────────────────

function ensureContext(): AudioContext {
  if (_ctx) return _ctx;
  // Using the browser's standard constructor — TS's lib.dom types cover this.
  _ctx = new (window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();

  _analyser = _ctx.createAnalyser();
  _analyser.fftSize = 1024;       // 512 freq bins, plenty for 3-band split
  _analyser.smoothingTimeConstant = 0.7;
  // Backing ArrayBuffer explicit so TS picks the tight Uint8Array<ArrayBuffer>
  // overload that getByteFrequencyData expects — the loose ArrayBufferLike
  // variant (e.g. SharedArrayBuffer-compatible) won't type-check on newer
  // lib.dom bundles.
  _freqData = new Uint8Array(new ArrayBuffer(_analyser.frequencyBinCount));
  return _ctx;
}

/**
 * Browsers block AudioContext playback until a user gesture (click/key).
 * This is called from the UI button handlers; no-op if already running.
 */
async function resumeIfSuspended(): Promise<void> {
  if (_ctx && _ctx.state === 'suspended') {
    await _ctx.resume();
  }
}

// ─── File loading ────────────────────────────────────────────────────────────

export interface LoadTrackResult {
  name: string;
  duration: number;
  bpm: number | null;
}

/**
 * Decode an audio file and get it ready to play. BPM is detected offline via
 * web-audio-beat-detector if the library is installed; if detection fails or
 * the library isn't present, bpm stays null and the internal clock keeps its
 * previous value.
 */
export async function loadTrack(file: File | Blob): Promise<LoadTrackResult> {
  const ctx = ensureContext();
  stopPlayback();
  disableMic();

  const arrayBuffer = await file.arrayBuffer();
  _audioBuffer = await ctx.decodeAudioData(arrayBuffer);
  _trackName = (file as File).name ?? 'track';
  _duration = _audioBuffer.duration;
  _playHeadSec = 0;
  _source = 'file';

  // BPM detection is best-effort. Dynamic import so missing dep isn't fatal.
  _bpm = null;
  try {
    const mod = await import('web-audio-beat-detector');
    // The library's analyze() scans the whole buffer; on long tracks this
    // takes ~1-2s and returns a single tempo estimate.
    const detected = await mod.analyze(_audioBuffer);
    if (Number.isFinite(detected) && detected >= 40 && detected <= 220) {
      _bpm = Math.round(detected);
      setBPM(_bpm);
    }
  } catch {
    // Library missing or analysis failed — silently skip, user can setBPM manually.
  }

  // Hook the scheduler's external clock once a track is loaded.
  setClockProvider(fileClockProvider);

  return { name: _trackName, duration: _duration, bpm: _bpm };
}

/** Start (or resume) playback from the current playhead. */
export async function playTrack(): Promise<void> {
  if (!_audioBuffer || !_ctx || !_analyser) return;
  await resumeIfSuspended();
  if (_isPlaying) return;

  _bufferSource = _ctx.createBufferSource();
  _bufferSource.buffer = _audioBuffer;
  _bufferSource.connect(_analyser);
  _analyser.connect(_ctx.destination);
  _bufferSource.onended = () => {
    // Ended by the buffer itself (playhead reached end) — not by pause().
    if (_isPlaying) {
      _isPlaying = false;
      _playHeadSec = _duration;
    }
  };

  _playStartCtxTime = _ctx.currentTime;
  _bufferSource.start(0, _playHeadSec);
  _isPlaying = true;
}

export function pauseTrack(): void {
  if (!_isPlaying) return;
  _playHeadSec = currentTrackPosition();
  stopPlayback();
}

/** Internal: tear down the buffer source without touching playhead. */
function stopPlayback(): void {
  if (_bufferSource) {
    try { _bufferSource.onended = null; _bufferSource.stop(); } catch { /* already stopped */ }
    try { _bufferSource.disconnect(); } catch { /* noop */ }
    _bufferSource = null;
  }
  _isPlaying = false;
}

/** Live track position in seconds. */
function currentTrackPosition(): number {
  if (!_ctx || !_isPlaying) return _playHeadSec;
  return Math.min(_duration, _playHeadSec + (_ctx.currentTime - _playStartCtxTime));
}

// ─── Mic mode ────────────────────────────────────────────────────────────────

export async function enableMic(): Promise<void> {
  const ctx = ensureContext();
  await resumeIfSuspended();
  stopPlayback();

  if (_micStream) return; // already live

  try {
    _micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    console.warn('[lumen audio] mic denied', err);
    return;
  }

  _micSource = ctx.createMediaStreamSource(_micStream);
  _micSource.connect(_analyser!);
  // Intentionally NOT connected to ctx.destination — would cause feedback.
  _source = 'mic';

  // Mic mode doesn't drive the scheduler clock (no track position), so
  // clear any provider left over from a previous loadTrack().
  setClockProvider(null);
}

export function disableMic(): void {
  if (_micSource) {
    try { _micSource.disconnect(); } catch { /* noop */ }
    _micSource = null;
  }
  if (_micStream) {
    for (const t of _micStream.getTracks()) t.stop();
    _micStream = null;
  }
  if (_source === 'mic') _source = null;
}

// ─── Clock provider ──────────────────────────────────────────────────────────

function fileClockProvider(): number | null {
  // Only drive cyclePos when we have a track AND a detected BPM AND it's
  // actively playing. Otherwise let the internal clock run so patterns
  // don't freeze while the user is stopped.
  if (_source !== 'file' || !_isPlaying || _bpm === null) return null;
  const beats = currentTrackPosition() * (_bpm / 60);
  return beats / BEATS_PER_CYCLE;
}

// ─── Per-tick band update ────────────────────────────────────────────────────

/**
 * Called once per scheduler tick from main.ts. Reads the analyser's frequency
 * bins, splits into 3 bands, writes the module-scope values that pattern
 * factories read. Fast — ~half a millisecond even on low-end hardware.
 */
export function updateAudioFrame(): void {
  if (!_analyser || !_freqData || _source === null) {
    _bass = _mid = _treble = _rms = 0;
    if (_peak > 0) _peak = Math.max(0, _peak - PEAK_DECAY_PER_TICK);
    return;
  }

  _analyser.getByteFrequencyData(_freqData);
  const bins = _freqData;
  const nyquist = (_ctx?.sampleRate ?? 48000) / 2;
  const binHz = nyquist / bins.length;

  // Band edges picked for musical sense, not FFT perfection:
  //   bass  <= 200Hz   · kick, bass guitar
  //   mid   200-2000Hz · vocals, snare body
  //   treble 2-12kHz   · hats, cymbals, sibilance
  const bassEnd = Math.floor(200 / binHz);
  const midEnd  = Math.floor(2000 / binHz);
  const trebEnd = Math.floor(12000 / binHz);

  let bassSum = 0, midSum = 0, trebSum = 0, allSum = 0;
  for (let i = 1; i < bins.length; i++) {
    const v = bins[i];
    allSum += v;
    if (i <= bassEnd) bassSum += v;
    else if (i <= midEnd) midSum += v;
    else if (i <= trebEnd) trebSum += v;
  }

  _bass   = bassSum / Math.max(1, bassEnd) / 255;
  _mid    = midSum  / Math.max(1, midEnd - bassEnd) / 255;
  _treble = trebSum / Math.max(1, trebEnd - midEnd) / 255;
  _rms    = allSum / bins.length / 255;

  // Peak detection: energy above rolling mean by a factor, outside refractory.
  _rmsHistory.push(_rms);
  if (_rmsHistory.length > RMS_HISTORY_LEN) _rmsHistory.shift();
  const avg = _rmsHistory.reduce((a, b) => a + b, 0) / _rmsHistory.length;
  const now = performance.now();
  if (_rms > avg * 1.5 && _rms > 0.05 && now - _lastPeakMs > PEAK_REFRACTORY_MS) {
    _lastPeakMs = now;
    _peak = 1;
  } else if (_peak > 0) {
    _peak = Math.max(0, _peak - PEAK_DECAY_PER_TICK);
  }
}

// ─── Pattern factory (reactive values as PatternLike) ────────────────────────

/**
 * Wrap a 0..1 read function in a PatternLike with the same chain methods the
 * fallback-waveform factory offers, so `audio.bass().range(0, 1)` works the
 * same way as `sine().slow(4).range(...)`.
 *
 * queryArc ignores begin/end — these are "live" values, not parametric.
 */
function makeReactive(read: () => number): PatternLike {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const self: any = {
    queryArc(_b: number, _e: number) {
      return [{ value: read() }];
    },
  };
  self.slow  = () => makeReactive(read); // slow/fast are no-ops for live values
  self.fast  = () => makeReactive(read);
  self.add   = (n: number) => makeReactive(() => Math.min(1, read() + n));
  self.mul   = (n: number) => makeReactive(() => read() * n);
  self.range = (lo: number, hi: number) => makeReactive(() => lo + read() * (hi - lo));
  attachPatternVizMethods(self);
  return self;
}

// ─── Public facade ───────────────────────────────────────────────────────────

/**
 * Exposed as `audio` in the eval context. All reactive methods return a
 * pattern you can drop into any fixture setter: `washA.red(audio.bass())`.
 */
export const audio = {
  // Reactive pattern sources (0..1, chainable).
  bass:   (): PatternLike => makeReactive(() => _bass),
  mid:    (): PatternLike => makeReactive(() => _mid),
  treble: (): PatternLike => makeReactive(() => _treble),
  rms:    (): PatternLike => makeReactive(() => _rms),
  peak:   (): PatternLike => makeReactive(() => _peak),

  // Scalars (getters, so they reflect the live value).
  get bpm()       { return _bpm; },
  get isPlaying() { return _isPlaying; },
  get position()  { return currentTrackPosition(); },
  get duration()  { return _duration; },
  get track()     { return _trackName; },
  get source()    { return _source; },
};

// ─── Exports the UI layer uses (not the eval sandbox) ────────────────────────

export function getTrackInfo() {
  return {
    name: _trackName,
    duration: _duration,
    position: currentTrackPosition(),
    bpm: _bpm,
    isPlaying: _isPlaying,
    source: _source,
  };
}
