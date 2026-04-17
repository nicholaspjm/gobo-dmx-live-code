/**
 * Inline editor visualizations.
 *
 * Users opt into these by chaining `.viz(kind)` on a fixture or strip:
 *
 *   const washA = fixture(1, 'generic-rgbw').viz('color')
 *   const spot  = fixture(9, 'generic-dimmer').viz('wave')
 *   const strip = rgbStrip(12, 10).viz('strip')
 *
 * How the wiring works:
 *
 * 1. At eval time, each `.viz()` call pushes a VizEntry into a registry in
 *    @lumen/core. The registry contains channel layout but NOT source
 *    location — fragile stack-trace parsing would be the only way to capture
 *    that at runtime, so we avoid it.
 *
 * 2. After a successful eval, the main app calls `refreshViz(view)`. We scan
 *    the editor doc for lines containing `.viz(` and zip those source
 *    locations against the registry (both are walked top-to-bottom so the
 *    orders line up). For each (line, entry) pair, we emit a line-end
 *    Decoration.widget.
 *
 * 3. Each widget is a `WidgetType` subclass that, on toDOM(), registers
 *    itself in a shared animation loop. The loop reads the live
 *    universe-1 buffer at ~30fps and each widget updates its own DOM from
 *    the channels it cares about.
 *
 * Kinds:
 *   'color' → color swatch, mixes r/g/b/w into a glowing square
 *   'wave'  → mini oscilloscope, scrolls recent intensity history
 *   'strip' → row of tiny pixel dots, one per strip pixel
 *   'meter' → vertical bar, current intensity level
 *
 * Multiple kinds on one line:
 *   spot.viz('wave', 'meter')  // both widgets appear, in that order
 */

import { EditorView, WidgetType, Decoration, type DecorationSet } from '@codemirror/view';
import { StateField, StateEffect } from '@codemirror/state';
import {
  getVizEntries,
  getUniverseBuffer,
  onTick,
  getCyclePos,
  getPatternVizEntries,
  samplePattern,
  type VizEntry,
  type VizKind,
  type PatternVizEntry,
  type PatternVizKind,
} from '@lumen/core';

// ─── Widget base class ───────────────────────────────────────────────────────

/**
 * A single inline widget instance. Subclasses provide a `build()` method
 * that populates the root element once, and an `update()` method called
 * from the shared animation loop with the current buffer for this widget's
 * universe (each widget can be on a different universe).
 */
abstract class VizWidget extends WidgetType {
  protected dom: HTMLSpanElement | null = null;

  constructor(
    /** Public so the animation loop can read `entry.universe` to pick a buffer. */
    readonly entry: VizEntry,
    protected readonly kind: VizKind,
    /**
     * Stable key so CodeMirror can reuse the same DOM across dispatches.
     * Derived from entry index + channel so two fixtures with the same
     * layout still compare unequal.
     */
    protected readonly signature: string,
  ) {
    super();
  }

  eq(other: WidgetType): boolean {
    return (
      other instanceof VizWidget &&
      other.signature === this.signature &&
      other.kind === this.kind
    );
  }

  toDOM(): HTMLElement {
    const el = document.createElement('span');
    el.className = `lumen-viz lumen-viz-${this.kind}`;
    // Keep the widget inert to CodeMirror's selection/click logic.
    el.setAttribute('aria-hidden', 'true');
    el.contentEditable = 'false';
    this.dom = el;
    this.build(el);
    _activeWidgets.add(this);
    return el;
  }

  destroy(): void {
    _activeWidgets.delete(this);
    this.dom = null;
  }

  /** Populate the root element once. */
  protected abstract build(el: HTMLSpanElement): void;

  /**
   * Called once per animation frame with the live universe-1 buffer.
   * Implementations should avoid allocations on the hot path.
   */
  abstract update(ch: number[]): void;

  /**
   * Derive a single 0..1 level from the fixture's channels. Used by the
   * meter and wave widgets so RGB/RGBW/dimmer/strip fixtures all reduce
   * to a comparable scalar.
   */
  protected level(ch: number[]): number {
    const start = this.entry.startChannel - 1;
    const { rgbw, dim, pixelCount } = this.entry;
    if (dim !== undefined) {
      return (ch[start + dim] ?? 0) / 255;
    }
    if (rgbw) {
      let m = 0;
      if (rgbw.r !== undefined) m = Math.max(m, ch[start + rgbw.r] ?? 0);
      if (rgbw.g !== undefined) m = Math.max(m, ch[start + rgbw.g] ?? 0);
      if (rgbw.b !== undefined) m = Math.max(m, ch[start + rgbw.b] ?? 0);
      if (rgbw.w !== undefined) m = Math.max(m, ch[start + rgbw.w] ?? 0);
      return m / 255;
    }
    if (pixelCount) {
      const stride = this.entry.channelsPerPixel ?? 3;
      let sum = 0;
      for (let i = 0; i < pixelCount; i++) {
        const base = start + i * stride;
        // Mix the white channel into the peak so RGBW strips don't look dim
        // when they're driven entirely off the W channel.
        const w = stride >= 4 ? (ch[base + 3] ?? 0) : 0;
        sum += Math.max(
          ch[base] ?? 0,
          ch[base + 1] ?? 0,
          ch[base + 2] ?? 0,
          w,
        );
      }
      return sum / pixelCount / 255;
    }
    return 0;
  }
}

// ─── Color swatch ────────────────────────────────────────────────────────────

/** Small glowing square showing the fixture's mixed output color. */
class ColorSwatchWidget extends VizWidget {
  protected build(el: HTMLSpanElement): void {
    el.title = `color — ch ${this.entry.startChannel}+`;
  }

  update(ch: number[]): void {
    if (!this.dom) return;
    const start = this.entry.startChannel - 1;
    const { rgbw, dim } = this.entry;
    if (!rgbw && !dim) return;

    const r = rgbw?.r !== undefined ? ch[start + rgbw.r] ?? 0 : 0;
    const g = rgbw?.g !== undefined ? ch[start + rgbw.g] ?? 0 : 0;
    const b = rgbw?.b !== undefined ? ch[start + rgbw.b] ?? 0 : 0;
    const w = rgbw?.w !== undefined ? ch[start + rgbw.w] ?? 0 : 0;
    // Dimmer (if present) scales the final RGB. No dimmer → pass through.
    const dimScale = dim !== undefined ? (ch[start + dim] ?? 0) / 255 : 1;

    const rr = Math.min(255, Math.round((r + w) * dimScale));
    const gg = Math.min(255, Math.round((g + w) * dimScale));
    const bb = Math.min(255, Math.round((b + w) * dimScale));
    const brightness = Math.max(rr, gg, bb) / 255;

    if (brightness < 0.03) {
      this.dom.style.background = '#2e2a26';
      this.dom.style.boxShadow = 'none';
      return;
    }
    this.dom.style.background = `rgb(${rr},${gg},${bb})`;
    this.dom.style.boxShadow = `0 0 ${Math.round(brightness * 10)}px rgba(${rr},${gg},${bb},${(brightness * 0.75).toFixed(2)})`;
  }
}

// ─── Vertical meter ──────────────────────────────────────────────────────────

/** Thin vertical bar filling from the bottom as intensity rises. */
class MeterWidget extends VizWidget {
  private fill: HTMLSpanElement | null = null;

  protected build(el: HTMLSpanElement): void {
    const fill = document.createElement('span');
    fill.className = 'lumen-viz-meter-fill';
    el.appendChild(fill);
    this.fill = fill;
    el.title = 'intensity';
  }

  update(ch: number[]): void {
    if (!this.fill) return;
    const v = this.level(ch);
    this.fill.style.height = `${(v * 100).toFixed(1)}%`;
    this.fill.style.opacity = (0.35 + v * 0.65).toFixed(2);
  }
}

// ─── Wave scope ──────────────────────────────────────────────────────────────

/**
 * Scrolling oscilloscope of the fixture's recent intensity history. Keeps
 * the last N samples in a ring buffer and redraws on every frame. Good for
 * seeing the shape of square/saw/sine patterns without looking at the
 * physical fixture.
 */
class WaveWidget extends VizWidget {
  private canvas: HTMLCanvasElement | null = null;
  private history: number[] = [];
  private readonly SAMPLES = 80;

  protected build(el: HTMLSpanElement): void {
    const c = document.createElement('canvas');
    // Oversample the backing store so it stays sharp on HiDPI screens.
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    c.width = 96 * dpr;
    c.height = 22 * dpr;
    c.style.width = '96px';
    c.style.height = '22px';
    c.className = 'lumen-viz-wave-canvas';
    el.appendChild(c);
    this.canvas = c;
    this.history = new Array(this.SAMPLES).fill(0);
    el.title = 'wave scope';
  }

  update(ch: number[]): void {
    if (!this.canvas) return;
    const v = this.level(ch);
    this.history.push(v);
    if (this.history.length > this.SAMPLES) this.history.shift();

    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    const { width, height } = this.canvas;
    ctx.clearRect(0, 0, width, height);

    // Fill under the waveform
    ctx.beginPath();
    for (let i = 0; i < this.history.length; i++) {
      const x = (i / (this.SAMPLES - 1)) * width;
      const y = height - this.history[i] * (height - 2) - 1;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.lineTo(width, height);
    ctx.lineTo(0, height);
    ctx.closePath();
    ctx.fillStyle = 'rgba(196,114,74,0.18)';
    ctx.fill();

    // Top line
    ctx.strokeStyle = '#c4724a';
    ctx.lineWidth = Math.max(1, Math.round(height / 22));
    ctx.beginPath();
    for (let i = 0; i < this.history.length; i++) {
      const x = (i / (this.SAMPLES - 1)) * width;
      const y = height - this.history[i] * (height - 2) - 1;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

// ─── Strip preview ───────────────────────────────────────────────────────────

/**
 * Row of tiny coloured dots, one per strip pixel. Works for both RGB (3
 * chs/pixel) and RGBW (4 chs/pixel) strips — the W channel is mixed into
 * R/G/B additively so an all-white rgbw strip still lights the dots.
 */
class StripWidget extends VizWidget {
  private dots: HTMLSpanElement[] = [];

  protected build(el: HTMLSpanElement): void {
    const count = this.entry.pixelCount ?? 0;
    const stride = this.entry.channelsPerPixel ?? 3;
    this.dots = [];
    for (let i = 0; i < count; i++) {
      const d = document.createElement('span');
      d.className = 'lumen-viz-strip-dot';
      el.appendChild(d);
      this.dots.push(d);
    }
    el.title = `strip — ${count} px × ${stride} ch`;
  }

  update(ch: number[]): void {
    const start = this.entry.startChannel - 1;
    const count = this.entry.pixelCount ?? 0;
    const stride = this.entry.channelsPerPixel ?? 3;
    for (let i = 0; i < count; i++) {
      const base = start + i * stride;
      const r = ch[base] ?? 0;
      const g = ch[base + 1] ?? 0;
      const b = ch[base + 2] ?? 0;
      const w = stride >= 4 ? (ch[base + 3] ?? 0) : 0;
      // Mix white into RGB additively, clamped. Matches how RGBW fixtures
      // actually render — the white LED is a separate emitter that adds to
      // whatever the colour LEDs are doing.
      const rr = Math.min(255, r + w);
      const gg = Math.min(255, g + w);
      const bb = Math.min(255, b + w);
      const br = Math.max(rr, gg, bb) / 255;
      const dot = this.dots[i];
      if (!dot) continue;
      if (br < 0.03) {
        dot.style.background = '#2e2a26';
      } else {
        dot.style.background = `rgb(${rr},${gg},${bb})`;
      }
    }
  }
}

// ─── Shared animation loop ───────────────────────────────────────────────────

/**
 * Every live widget registers itself here on toDOM(). A single subscription
 * to the core scheduler tick iterates the set and pokes each widget with its
 * own universe's buffer. Widgets unregister themselves on destroy().
 *
 * We intentionally piggy-back on `onTick` instead of using
 * `requestAnimationFrame` — the core scheduler runs in a Web Worker so it
 * keeps ticking even when the tab is backgrounded, and it's the same clock
 * that drives the DMX output, so widget visuals stay phase-locked with the
 * fixtures. rAF also gets throttled or paused in some embedded preview
 * environments, which made widgets appear static after the initial build.
 *
 * Multi-universe: widgets can live on any universe (the four-colour bar, for
 * example, is demo'd on universe 1). We cache one number[] snapshot per
 * universe-in-use per tick so two widgets on the same universe don't pay
 * for two copies of the same buffer.
 */
const _activeWidgets = new Set<VizWidget>();

onTick(() => {
  if (_activeWidgets.size === 0) return;
  const buffers = new Map<number, number[]>();
  for (const w of _activeWidgets) {
    const uni = w.entry.universe;
    let ch = buffers.get(uni);
    if (!ch) {
      ch = Array.from(getUniverseBuffer(uni));
      buffers.set(uni, ch);
    }
    try {
      w.update(ch);
    } catch {
      // A misbehaving widget shouldn't take down the whole loop.
    }
  }
});

// ─── Pattern-level inline viz (.flash / .glow / .wave) ──────────────────────
// Distinct decoration pipeline from the fixture-level `.viz(kind)` widgets
// above. Flash and glow apply a CSS class + a `data-lumen-patviz` index to
// the line they appear on (via `Decoration.line`), then a tick subscription
// finds those lines by data-attribute and mutates their inline styles from
// the current pattern sample. Wave places a canvas widget at line-end and
// draws a recent-history sparkline of the pattern.

interface PatternVizDecoEntry {
  /** Matches the PatternVizEntry in @lumen/core. */
  core: PatternVizEntry;
  /** Line number (1-based) the decoration was placed on. */
  line: number;
  /** Attached to Decoration.line or the WaveSparkline via data-attr so the
   *  tick updater can find this entry's rendered DOM. */
  idx: number;
  /** Sparkline widget reference (wave only). */
  sparkline?: PatternWaveWidget;
  /** Cached line element — avoids a querySelector every tick. Stays null
   *  until the line gets rendered the first time, and is re-queried if CM
   *  ever drops the reference (viewport scroll, line DOM recycle). */
  cachedLineEl?: HTMLElement | null;
  /** For flash: decaying intensity driven by rising-edge detection. */
  flashIntensity?: number;
}

/** Currently-active pattern-viz decorations, indexed by `idx`. */
const _patternVizEntries = new Map<number, PatternVizDecoEntry>();

/**
 * Tiny inline canvas sparkline that plots the recent history of a pattern's
 * sample value. Driven from the shared pattern-viz tick subscription below.
 */
class PatternWaveWidget extends WidgetType {
  private canvas: HTMLCanvasElement | null = null;
  private history: number[] = [];
  private readonly SAMPLES = 60;

  constructor(private readonly idx: number) {
    super();
  }

  eq(other: WidgetType): boolean {
    return other instanceof PatternWaveWidget && other.idx === this.idx;
  }

  toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = 'lumen-patviz-wave';
    span.setAttribute('aria-hidden', 'true');
    span.contentEditable = 'false';
    const c = document.createElement('canvas');
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    c.width = 70 * dpr;
    c.height = 14 * dpr;
    c.style.width = '70px';
    c.style.height = '14px';
    span.appendChild(c);
    this.canvas = c;
    this.history = new Array(this.SAMPLES).fill(0);
    return span;
  }

  /** Push a new sample and redraw. Called once per scheduler tick. */
  push(value: number): void {
    if (!this.canvas) return;
    this.history.push(Math.max(0, Math.min(1, value)));
    if (this.history.length > this.SAMPLES) this.history.shift();
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    const { width, height } = this.canvas;
    ctx.clearRect(0, 0, width, height);
    ctx.strokeStyle = '#c4724a';
    ctx.lineWidth = Math.max(1, Math.round(height / 14));
    ctx.beginPath();
    for (let i = 0; i < this.history.length; i++) {
      const x = (i / (this.SAMPLES - 1)) * width;
      const y = height - this.history[i] * (height - 2) - 1;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  destroy(): void {
    this.canvas = null;
  }
}

/**
 * Tick subscription that drives the flash / glow / wave decorations from
 * their patterns' current sample values. Runs on the same worker-clock
 * schedule as the main pattern engine.
 *
 * Deliberately light-touch on the main thread: only CSS custom-property
 * writes and, for wave, a small canvas redraw. No attribute toggles, no
 * forced reflows — an earlier implementation used `void offsetWidth` to
 * restart a keyframe animation on each rising edge, and those synchronous
 * layouts were stalling the DMX tick enough to jitter packet timing, which
 * showed up as subtle physical-light flicker on Art-Net fixtures.
 *
 * Flash is now driven the same way glow is: a decaying intensity written
 * as a CSS custom property. Rising edge → bump intensity to 1. Each tick →
 * decay toward zero. CSS multiplies it into the bg colour.
 */
const FLASH_DECAY_PER_TICK = 0.10;   // ≈170ms to zero at 60Hz
const FLASH_RISE_THRESHOLD = 0.5;

const _lastValue = new Map<number, number>();

onTick(() => {
  if (_patternVizEntries.size === 0) return;
  const cyclePos = getCyclePos();

  for (const deco of _patternVizEntries.values()) {
    const value = samplePattern(deco.core.pattern, cyclePos);
    const prev = _lastValue.get(deco.idx) ?? 0;
    _lastValue.set(deco.idx, value);

    if (deco.core.kind === 'wave') {
      deco.sparkline?.push(value);
      continue;
    }

    // Cache the line element to avoid a querySelector every tick. CM may
    // drop the rendered node on viewport scroll, so re-query on miss.
    let lineEl = deco.cachedLineEl;
    if (!lineEl || !lineEl.isConnected) {
      lineEl = document.querySelector<HTMLElement>(
        `.cm-content .cm-line[data-lumen-patviz="${deco.idx}"]`,
      );
      deco.cachedLineEl = lineEl;
    }
    if (!lineEl) continue; // line is outside CM's virtualized viewport

    if (deco.core.kind === 'glow') {
      lineEl.style.setProperty('--lumen-val', value.toFixed(3));
    } else if (deco.core.kind === 'flash') {
      // Rising edge bumps the decaying intensity; otherwise decay toward 0.
      // No attribute toggles, no reflow — pure CSS-var write so the tick
      // handler stays fast and DMX timing stays clean.
      let fi = deco.flashIntensity ?? 0;
      if (value > FLASH_RISE_THRESHOLD && prev <= FLASH_RISE_THRESHOLD) {
        fi = 1;
      } else {
        fi = Math.max(0, fi - FLASH_DECAY_PER_TICK);
      }
      deco.flashIntensity = fi;
      lineEl.style.setProperty('--lumen-flash', fi.toFixed(3));
    }
  }
});

// ─── CodeMirror state plumbing ───────────────────────────────────────────────

const setVizDecorations = StateEffect.define<DecorationSet>();

/**
 * Editor extension that stores the current set of widget decorations.
 * Positions are mapped through doc changes so widgets track the line they
 * were placed on until the next `refreshViz()` rebuilds the set.
 */
export const vizDecorationsField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setVizDecorations)) deco = e.value;
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

/**
 * Rebuild widget decorations to reflect the current registry.
 *
 * Call after every successful eval. We:
 *   1. Read VizEntries from @lumen/core (populated by `.viz()` calls during eval).
 *   2. Walk the doc and record the line numbers that contain `.viz(` (in code,
 *      not comments).
 *   3. Zip the two lists 1:1. If the user has more `.viz(` hits in the doc
 *      than entries (e.g. a commented-out one that regex still matched), the
 *      extras are ignored, and vice versa.
 *   4. For each (entry, line) pair, emit one widget per kind at line-end.
 */
export function refreshViz(view: EditorView): void {
  const entries = getVizEntries();
  const doc = view.state.doc;

  // Collect source lines with a .viz( call, skipping // line comments.
  const vizLines: number[] = [];
  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i);
    const commentIdx = line.text.indexOf('//');
    const code = commentIdx >= 0 ? line.text.slice(0, commentIdx) : line.text;
    if (/\.viz\s*\(/.test(code)) vizLines.push(i);
  }

  const ranges: Array<{ from: number; to: number; value: Decoration }> = [];
  const pairs = Math.min(entries.length, vizLines.length);
  for (let i = 0; i < pairs; i++) {
    const entry = entries[i];
    const line = doc.line(vizLines[i]);
    const signature = `${i}:${entry.startChannel}:${entry.channelCount}`;
    for (const kind of entry.kinds) {
      const widget = makeWidget(entry, kind, signature);
      ranges.push({
        from: line.to,
        to: line.to,
        value: Decoration.widget({ widget, side: 1 }),
      });
    }
  }

  // ─── Pattern-level viz (.flash / .glow / .wave on pattern calls) ────────
  // Walk the doc again looking for each kind's call marker. We track kind-
  // per-line plus a flat in-order list that zips 1:1 with the core registry.
  _patternVizEntries.clear();
  const patEntries = getPatternVizEntries();
  const patHits: Array<{ line: number; kind: PatternVizKind }> = [];

  for (let i = 1; i <= doc.lines; i++) {
    const lineObj = doc.line(i);
    const commentIdx = lineObj.text.indexOf('//');
    const code = commentIdx >= 0 ? lineObj.text.slice(0, commentIdx) : lineObj.text;
    // Order of matches within a line matters for the 1:1 zip — use a single
    // regex with /g and record each hit in order.
    const re = /\.(flash|glow|wave)\s*\(/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(code)) !== null) {
      patHits.push({ line: i, kind: m[1] as PatternVizKind });
    }
  }

  const patPairs = Math.min(patEntries.length, patHits.length);
  for (let i = 0; i < patPairs; i++) {
    const coreEntry = patEntries[i];
    const hit = patHits[i];
    // Skip if the source kind and the registered kind disagree — probably
    // a comment/identifier collision rather than a real chain call.
    if (hit.kind !== coreEntry.kind) continue;
    const lineObj = doc.line(hit.line);
    const deco: PatternVizDecoEntry = { core: coreEntry, line: hit.line, idx: i };
    _patternVizEntries.set(i, deco);

    if (coreEntry.kind === 'wave') {
      // Widget at end-of-line — tick loop pushes samples into its canvas.
      const widget = new PatternWaveWidget(i);
      deco.sparkline = widget;
      ranges.push({
        from: lineObj.to,
        to: lineObj.to,
        value: Decoration.widget({ widget, side: 1 }),
      });
    } else {
      // Line decoration carrying the idx as a data-attr so the tick loop
      // can find the rendered DOM by query.
      ranges.push({
        from: lineObj.from,
        to: lineObj.from,
        value: Decoration.line({
          attributes: {
            class: `lumen-patviz lumen-patviz-${coreEntry.kind}`,
            'data-lumen-patviz': String(i),
          },
        }),
      });
    }
  }

  // Line decorations sort before widget decorations at the same position.
  // Decoration.set wants ranges sorted by `from` with secondary ordering
  // handled internally — we sort by `from` ascending and let CM handle
  // the rest.
  ranges.sort((a, b) => a.from - b.from);
  const deco = Decoration.set(
    ranges.map((r) =>
      // Widget and line decorations take a single position; mark takes both.
      // All three of our uses here are point-ranges (from === to), so calling
      // .range(from) on every one is safe.
      r.value.range(r.from),
    ),
    true,
  );
  view.dispatch({ effects: setVizDecorations.of(deco) });
}

function makeWidget(entry: VizEntry, kind: VizKind, sig: string): VizWidget {
  switch (kind) {
    case 'color':
      return new ColorSwatchWidget(entry, kind, sig);
    case 'wave':
      return new WaveWidget(entry, kind, sig);
    case 'strip':
      return new StripWidget(entry, kind, sig);
    case 'meter':
      return new MeterWidget(entry, kind, sig);
  }
}
