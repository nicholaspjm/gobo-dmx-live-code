/**
 * Safe eval sandbox for user-written lumen code.
 *
 * Uses new Function() to run code with a controlled set of globals.
 * Strudel pattern functions are loaded once and injected into the context.
 *
 * Example user code:
 *   ch(1, sine().slow(2))
 *   rgb(1, sine(), 0, cosine().slow(3))
 */

import { clearDefs, ch, uni, dim, rgb, type PatternLike } from './dmx.js';
import { setBPM } from './scheduler.js';
import {
  fixture,
  defineFixture,
  listFixtures,
  rgbStrip,
  rgbwStrip,
  clearVizRegistry,
} from './fixtures.js';
import { sendConfig } from './websocket.js';

// Strudel functions, loaded once via initStrudel()
const _strudelCtx: Record<string, unknown> = {};
let _strudelReady = false;

/** Call once (async) before first eval to load @strudel/core waveforms. */
export async function initStrudel(): Promise<void> {
  if (_strudelReady) return;
  try {
    // Dynamic import keeps build working even if strudel isn't installed yet
    const core = await import('@strudel/core');

    // Wrap each waveform: if it's already a function → use directly.
    // If it's a Pattern instance → wrap in a factory (() => pattern).
    // This ensures user code can call sine(), cosine(), etc.
    function wrap(exported: unknown): (...args: unknown[]) => PatternLike {
      if (typeof exported === 'function') {
        return exported as (...args: unknown[]) => PatternLike;
      }
      // Pattern instance — make it callable
      return () => exported as PatternLike;
    }

    _strudelCtx.sine = wrap(core.sine);
    _strudelCtx.cosine = wrap(core.cosine);
    _strudelCtx.square = wrap(core.square);
    _strudelCtx.saw = wrap(core.saw);
    _strudelCtx.rand = wrap(core.rand);
    _strudelCtx.mini = core.mini;
    _strudelCtx.sequence = core.sequence;
    _strudelCtx.cat = core.cat;
    _strudelCtx.stack = core.stack;
    // Convenience alias
    _strudelCtx.m = core.mini;

    _strudelReady = true;
    console.log('[lumen] strudel core loaded');
  } catch (err) {
    console.warn('[lumen] @strudel/core not available:', err);
    // Fall back to simple numeric waveforms so the engine still works
    _strudelCtx.sine = makeFallbackWaveform((t) => Math.sin(t * 2 * Math.PI) * 0.5 + 0.5);
    _strudelCtx.cosine = makeFallbackWaveform((t) => Math.cos(t * 2 * Math.PI) * 0.5 + 0.5);
    _strudelCtx.square = makeFallbackWaveform((t) => (t % 1 < 0.5 ? 1 : 0));
    _strudelCtx.saw = makeFallbackWaveform((t) => t % 1);
    _strudelCtx.rand = makeFallbackWaveform(() => Math.random());
    _strudelReady = true;
  }
}

/** Minimal Pattern-compatible wrapper for fallback waveforms. */
function makeFallbackWaveform(fn: (t: number) => number) {
  const self: PatternLike & Record<string, unknown> = {
    queryArc(begin: number, end: number) {
      const mid = (begin + end) / 2;
      return [{ value: fn(mid) }];
    },
  };

  // Add common chaining methods that return modified patterns
  self.slow = (factor: number) =>
    makeFallbackWaveform((t) => fn(t / (factor as number)));
  self.fast = (factor: number) =>
    makeFallbackWaveform((t) => fn(t * (factor as number)));
  self.add = (n: number) =>
    makeFallbackWaveform((t) => Math.min(1, fn(t) + (n as number)));
  self.mul = (n: number) =>
    makeFallbackWaveform((t) => fn(t) * (n as number));
  self.range = (lo: number, hi: number) =>
    makeFallbackWaveform((t) => lo + fn(t) * (hi - lo));

  return () => self;
}

// ─── Bridge config helpers (called from user code) ───────────────────────────

function artnet(host = '127.0.0.1', port = 6454): void {
  sendConfig({ mode: 'artnet', artnet: { host, port } });
}

function sacn(universe = 1, priority = 100): void {
  sendConfig({ mode: 'sacn', sacn: { universe, priority } });
}

function osc(host = '127.0.0.1', port = 9000): void {
  sendConfig({ mode: 'osc', osc: { host, port } });
}

function mock(): void {
  sendConfig({ mode: 'mock' });
}

export interface EvalResult {
  success: boolean;
  error?: string;
}

export function evalCode(code: string): EvalResult {
  try {
    clearDefs();
    clearVizRegistry();

    const ctx: Record<string, unknown> = {
      // DMX API
      ch,
      uni,
      dim,
      rgb,
      // Fixture system
      fixture,
      defineFixture,
      listFixtures,
      rgbStrip,
      rgbwStrip,
      // Clock
      setBPM,
      // Bridge config
      artnet,
      sacn,
      osc,
      mock,
      // Patterns (populated by initStrudel)
      ..._strudelCtx,
      // Passthrough safe globals
      Math,
      console,
    };

    const keys = Object.keys(ctx);
    const values = Object.values(ctx);

    // new Function is intentional — this is the eval sandbox
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const fn = new Function(...keys, `"use strict";\n${code}`);
    fn(...values);

    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
