/**
 * Canvas-based DMX visualizer.
 *
 * Renders 512 vertical bars representing channels 1–512.
 * Updates at ~30 fps with smooth interpolation toward the current value.
 *
 * Colors use the earth-tone palette; active channels glow in terracotta.
 */

import { COLORS } from './theme.js';

const TARGET_FPS = 30;
const SMOOTHING = 0.25; // 0 = instant, 1 = never moves
const CHANNEL_COUNT = 512;

let _canvas: HTMLCanvasElement;
let _ctx: CanvasRenderingContext2D;
let _displayValues = new Float32Array(CHANNEL_COUNT); // smoothed 0–255
let _targetValues = new Float32Array(CHANNEL_COUNT);  // from scheduler
let _rafId: number | null = null;
let _lastFrameTime = 0;
const _FRAME_INTERVAL = 1000 / TARGET_FPS;

export function initVisualizer(canvas: HTMLCanvasElement): void {
  _canvas = canvas;
  _ctx = canvas.getContext('2d')!;
  _displayValues.fill(0);
  _targetValues.fill(0);

  const ro = new ResizeObserver(() => resize());
  ro.observe(canvas.parentElement!);
  resize();

  requestAnimationFrame(renderLoop);
}

export function updateVisualizer(channels: number[]): void {
  for (let i = 0; i < CHANNEL_COUNT; i++) {
    _targetValues[i] = channels[i] ?? 0;
  }
}

function resize(): void {
  const parent = _canvas.parentElement!;
  _canvas.width = parent.clientWidth * devicePixelRatio;
  _canvas.height = parent.clientHeight * devicePixelRatio;
  _canvas.style.width = parent.clientWidth + 'px';
  _canvas.style.height = parent.clientHeight + 'px';
}

function renderLoop(now: number): void {
  _rafId = requestAnimationFrame(renderLoop);

  if (now - _lastFrameTime < _FRAME_INTERVAL) return;
  _lastFrameTime = now;

  // Smooth toward targets
  for (let i = 0; i < CHANNEL_COUNT; i++) {
    _displayValues[i] += (_targetValues[i] - _displayValues[i]) * (1 - SMOOTHING);
  }

  draw();
}

function draw(): void {
  const w = _canvas.width;
  const h = _canvas.height;

  // Background
  _ctx.fillStyle = COLORS.surface;
  _ctx.fillRect(0, 0, w, h);

  if (w < 1 || h < 1) return;

  const barW = w / CHANNEL_COUNT;
  const maxH = h - 4; // leave 2px top/bottom padding

  // Parse accent color for gradient
  const accentRgb = hexToRgb(COLORS.accent);
  const accent2Rgb = hexToRgb(COLORS.accent2);
  const dimRgb = hexToRgb(COLORS.border);

  for (let i = 0; i < CHANNEL_COUNT; i++) {
    const value = _displayValues[i];
    if (value < 0.5) {
      // Very dim — just draw a subtle tick mark
      const t = value / 0.5;
      _ctx.fillStyle = `rgba(${dimRgb},${0.3 + t * 0.3})`;
      _ctx.fillRect(i * barW, h - 2, Math.max(1, barW - 0.5), 2);
      continue;
    }

    const t = value / 255; // 0–1
    const barH = Math.max(2, t * maxH);
    const x = i * barW;
    const y = h - barH;

    // Color: blend accent (terracotta) → accent2 (amber) as value increases
    const r = Math.round(lerp(accentRgb[0], accent2Rgb[0], t));
    const g = Math.round(lerp(accentRgb[1], accent2Rgb[1], t));
    const b = Math.round(lerp(accentRgb[2], accent2Rgb[2], t));
    const alpha = 0.5 + t * 0.5;

    _ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`;
    _ctx.fillRect(x, y, Math.max(1, barW - 0.5), barH);

    // Bright top cap for lit channels
    if (t > 0.05) {
      _ctx.fillStyle = `rgba(${r},${g},${b},${Math.min(1, alpha + 0.4)})`;
      _ctx.fillRect(x, y, Math.max(1, barW - 0.5), Math.min(2, barH));
    }
  }

  // Channel number labels every 64 channels
  _ctx.fillStyle = COLORS.textMuted;
  _ctx.font = `${Math.round(9 * devicePixelRatio)}px monospace`;
  _ctx.textAlign = 'left';
  for (let i = 0; i < CHANNEL_COUNT; i += 64) {
    const x = i * barW + 2;
    _ctx.fillText(String(i + 1), x, h - 4);
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function stopVisualizer(): void {
  if (_rafId !== null) {
    cancelAnimationFrame(_rafId);
    _rafId = null;
  }
}
