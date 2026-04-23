#!/usr/bin/env python
"""
Audio analysis tool for building live-coding templates.

Given an MP3/WAV path, extract the data a lumen scene author needs
to structure a performance around it:

  - duration, sample rate
  - tempo (BPM) estimate + beat timestamps
  - onset timestamps (transient detection — kicks/snares/hits)
  - per-beat band energies (bass / mid / treble) at beat grid
  - section boundaries (agglomerative clustering on chroma/MFCC
    self-similarity — roughly, "where the musical texture changes")
  - loudness envelope summarised into 2-second buckets
  - spectral-centroid envelope (proxy for "brightness")

Output: a JSON blob printed to stdout plus a small summary written
to stderr so you can eyeball the BPM / duration / sections quickly.

Usage:
  python scripts/analyse-track.py path/to/track.mp3 > out.json
"""

from __future__ import annotations
import json
import sys
from pathlib import Path

import librosa
import numpy as np


def analyse(path: str) -> dict:
    # Load at the file's native sample rate — librosa defaults to 22050
    # which loses treble detail that matters for Ikeda-type tracks.
    y, sr = librosa.load(path, sr=None, mono=True)
    duration = float(librosa.get_duration(y=y, sr=sr))

    print(f"  loaded {path}  sr={sr}  duration={duration:.2f}s", file=sys.stderr)

    # ─── Tempo + beat grid ──────────────────────────────────────────
    # librosa's beat tracker is median-filter + dynamic-programming on
    # onset strength — works well on music with regular pulses.
    tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr, units='frames')
    beat_times = librosa.frames_to_time(beat_frames, sr=sr)
    tempo_val = float(tempo if np.isscalar(tempo) else tempo[0])
    print(f"  tempo ≈ {tempo_val:.1f} BPM   beats={len(beat_times)}", file=sys.stderr)

    # ─── Onsets (kick/snare/hit detection) ───────────────────────────
    # Broad onset detection picks up every transient. Useful for
    # sequencing accent-like patterns that follow the track.
    onset_env = librosa.onset.onset_strength(y=y, sr=sr, aggregate=np.median)
    onsets = librosa.onset.onset_detect(
        onset_envelope=onset_env, sr=sr, backtrack=True, units='time',
    )
    print(f"  onsets={len(onsets)}", file=sys.stderr)

    # ─── Band energies per beat ─────────────────────────────────────
    # Compute an STFT, split into low/mid/high bands, then average
    # each band's energy inside each beat window. Lets the scene
    # author see which parts of the track are bass-heavy vs bright.
    stft = np.abs(librosa.stft(y, n_fft=2048, hop_length=512))
    freqs = librosa.fft_frequencies(sr=sr, n_fft=2048)
    low = stft[(freqs >= 20) & (freqs < 200)].mean(axis=0)
    mid = stft[(freqs >= 200) & (freqs < 2000)].mean(axis=0)
    hi  = stft[(freqs >= 2000) & (freqs < 12000)].mean(axis=0)
    # Frame times for each STFT frame, then bucket into beats.
    hop_t = librosa.frames_to_time(np.arange(len(low)), sr=sr, hop_length=512)

    def beat_bucket(env: np.ndarray) -> list[float]:
        out = []
        # Pair each beat start with the next beat start (or end of track).
        edges = np.concatenate([beat_times, [duration]])
        for a, b in zip(edges[:-1], edges[1:]):
            mask = (hop_t >= a) & (hop_t < b)
            out.append(float(env[mask].mean()) if mask.any() else 0.0)
        return out

    beat_energies = {
        'bass':   beat_bucket(low),
        'mid':    beat_bucket(mid),
        'treble': beat_bucket(hi),
    }

    # Normalise to 0..1 for portability.
    def norm01(xs: list[float]) -> list[float]:
        if not xs:
            return xs
        m = max(xs) or 1.0
        return [round(x / m, 4) for x in xs]
    beat_energies = {k: norm01(v) for k, v in beat_energies.items()}

    # ─── Section boundaries ─────────────────────────────────────────
    # Use agglomerative clustering on chroma + MFCC features — a
    # standard approach for finding where the music changes. Returns
    # a small handful of boundary times in seconds.
    try:
        chroma = librosa.feature.chroma_cqt(y=y, sr=sr)
        mfcc = librosa.feature.mfcc(y=y, sr=sr, n_mfcc=12)
        feats = np.vstack([librosa.util.normalize(chroma, axis=1),
                           librosa.util.normalize(mfcc, axis=1)])
        # 6-8 segments reads naturally as verse/build/drop-length chunks.
        boundary_frames = librosa.segment.agglomerative(feats, k=7)
        boundaries = librosa.frames_to_time(boundary_frames, sr=sr).tolist()
        boundaries = [round(float(b), 2) for b in sorted(set(boundaries))]
    except Exception as e:
        print(f"  section detection failed: {e}", file=sys.stderr)
        boundaries = []
    print(f"  sections={boundaries}", file=sys.stderr)

    # ─── Loudness envelope (2-second buckets) ───────────────────────
    # Simple RMS in 2s windows — gives a "graph" of how loud the track
    # is across its duration. Great for eyeballing drops.
    bucket_secs = 2.0
    window = int(bucket_secs * sr)
    loudness = []
    for i in range(0, len(y), window):
        chunk = y[i:i + window]
        if len(chunk):
            rms = float(np.sqrt(np.mean(chunk ** 2)))
            loudness.append({'t': round(i / sr, 2), 'rms': round(rms, 4)})
    # Normalise.
    mrms = max((p['rms'] for p in loudness), default=1.0) or 1.0
    for p in loudness:
        p['rms'] = round(p['rms'] / mrms, 4)

    # ─── Spectral centroid envelope ─────────────────────────────────
    # "Brightness" proxy. Ikeda tracks bounce between very dark
    # sub-bass sections and glassy high-frequency textures; this
    # captures that shape.
    centroid = librosa.feature.spectral_centroid(y=y, sr=sr)[0]
    cen_t = librosa.frames_to_time(np.arange(len(centroid)), sr=sr)
    cen_buckets = []
    for i in range(0, len(centroid), int(bucket_secs * sr / 512)):
        chunk = centroid[i:i + int(bucket_secs * sr / 512)]
        t_chunk = cen_t[i:i + int(bucket_secs * sr / 512)]
        if len(chunk):
            cen_buckets.append({
                't': round(float(t_chunk[0]), 2),
                'hz': round(float(chunk.mean()), 0),
            })

    return {
        'file': str(Path(path).name),
        'duration': round(duration, 2),
        'sampleRate': int(sr),
        'tempoBpm': round(tempo_val, 1),
        'beatTimes': [round(float(t), 3) for t in beat_times.tolist()],
        'onsetTimes': [round(float(t), 3) for t in onsets.tolist()],
        'beatEnergies': beat_energies,
        'sectionBoundaries': boundaries,
        'loudness': loudness,
        'centroidHz': cen_buckets,
    }


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('usage: python analyse-track.py <path-to-audio>', file=sys.stderr)
        sys.exit(1)
    result = analyse(sys.argv[1])
    json.dump(result, sys.stdout, separators=(',', ':'))
