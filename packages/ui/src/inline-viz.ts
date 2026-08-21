/**
 * Inline editor visualizations.
 *
 * Users opt into these by chaining `.viz(kind)` on a fixture or strip:
 *
 *   const washA = fixture(1, 'rgbw').viz('color')
 *   const spot  = fixture(9, 'dim').viz('wave')
 *   const strip = rgbStrip(12, 10).viz('strip')
 *
 * How the wiring works:
 *
 * 1. At eval time, each `.viz()` call pushes a VizEntry into a registry in
 *    @gobo/core. The registry contains channel layout but NOT source
 *    location. Capturing that at runtime would mean parsing stack traces,
 *    which is fragile, so it is deliberately not done.
 *
 * 2. After a successful eval, the main app calls `refreshViz(view)`. That
 *    scans the editor doc for `.viz(` call sites and zips those source
 *    locations against the registry (both are walked top-to-bottom so the
 *    orders line up). Each (line, entry) pair emits a line-end
 *    Decoration.widget. The scan runs over source with comments and string
 *    contents blanked out (source-scan.ts), which is what makes commenting a
 *    line out take its widget away.
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
  sampleCycle,
  getControls,
  getPickers,
  getPickedColor,
  setPickedColor,
  makeColor,
  type PickerEntry,
  type Color,
  getControlValue,
  setControlValue,
  type ControlEntry,
  type PatternSpan,
  type PatternLike,
  type VizEntry,
  type VizKind,
  type PatternVizEntry,
  type PatternVizKind,
} from '@gobo/core';
import { stripNonCode, findCalls } from './source-scan.js';
import { openColorWheel, type ColorWheel } from './color-wheel.js';

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
    el.className = `gobo-viz gobo-viz-${this.kind}`;
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
    el.title = `color: ch ${this.entry.startChannel}+`;
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
    fill.className = 'gobo-viz-meter-fill';
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
    c.className = 'gobo-viz-wave-canvas';
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
 * chs/pixel) and RGBW (4 chs/pixel) strips: the W channel is mixed into
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
      d.className = 'gobo-viz-strip-dot';
      el.appendChild(d);
      this.dots.push(d);
    }
    el.title = `strip: ${count} px × ${stride} ch`;
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
      // render: the white LED is a separate emitter that adds to whatever
      // the colour LEDs are doing.
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
 * This piggy-backs on `onTick` rather than `requestAnimationFrame`. The core
 * scheduler runs in a Web Worker, so it keeps ticking when the tab is
 * backgrounded, and it is the same clock that drives the DMX output, so
 * widget visuals stay phase-locked with the fixtures. rAF also gets
 * throttled or paused in some embedded preview environments, which made
 * widgets appear static after the initial build.
 *
 * Multi-universe: widgets can live on any universe (the four-colour bar, for
 * example, is demo'd on universe 1). One number[] snapshot is cached per
 * universe-in-use per tick, so two widgets on the same universe don't pay
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

// ─── Live controls (slider) ─────────────────────────────────────────────────
//
// A slider() in the scene gets a handle at its call site. Dragging writes
// straight into the control store, which the pattern reads on the next tick,
// so the light moves with the handle and nothing is re-evaluated. That is the
// point of it: during a show a re-run is a visible seam, and this has to be a
// smooth fade.

/** Draggable handle placed at the end of a slider() line. */
class SliderWidget extends WidgetType {
  private input: HTMLInputElement | null = null;
  private readout: HTMLElement | null = null;

  constructor(private readonly entry: ControlEntry) {
    super();
  }

  eq(other: WidgetType): boolean {
    return other instanceof SliderWidget
      && other.entry.name === this.entry.name
      && other.entry.min === this.entry.min
      && other.entry.max === this.entry.max
      && other.entry.step === this.entry.step;
  }

  toDOM(): HTMLElement {
    const { name, min, max, step } = this.entry;
    const span = document.createElement('span');
    span.className = 'gobo-slider';
    span.contentEditable = 'false';

    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    // A continuous control still needs a fine step for the range input, or the
    // browser quantises it to integers and a 0-1 slider becomes a switch.
    input.step = String(step > 0 ? step : (max - min) / 1000);
    input.value = String(getControlValue(name) ?? this.entry.initial);
    input.title = `${name}: ${min} to ${max}`;

    const readout = document.createElement('span');
    readout.className = 'gobo-slider-value';

    const paint = (): void => {
      const v = Number(input.value);
      readout.textContent = step >= 1 ? String(Math.round(v)) : v.toFixed(2);
    };

    input.addEventListener('input', () => {
      setControlValue(name, Number(input.value));
      paint();
    });
    // The editor owns these keys; a focused range input would otherwise eat
    // arrow keys and swallow ctrl+enter mid-show.
    input.addEventListener('keydown', (e) => { e.stopPropagation(); });
    // Dragging must not move the text cursor or start a selection.
    span.addEventListener('mousedown', (e) => { e.stopPropagation(); });

    const label = document.createElement('span');
    label.className = 'gobo-slider-name';
    label.textContent = name;

    span.append(label, input, readout);
    this.input = input;
    this.readout = readout;
    paint();
    return span;
  }

  /**
   * Follow the stored value when something other than this handle moved it,
   * so two views of one control cannot disagree.
   */
  sync(): void {
    if (!this.input) return;
    const v = getControlValue(this.entry.name);
    if (v === null || document.activeElement === this.input) return;
    if (Number(this.input.value) === v) return;
    this.input.value = String(v);
    if (this.readout) {
      this.readout.textContent = this.entry.step >= 1 ? String(Math.round(v)) : v.toFixed(2);
    }
  }

  destroy(): void {
    this.input = null;
    this.readout = null;
  }
}

/** Live slider widgets, so the tick can keep their handles in step. */
let _sliderWidgets: SliderWidget[] = [];

/**
 * A colour, with the wheel behind it.
 *
 * A swatch showing what pick() is currently on. Clicking opens the wheel in
 * color-wheel.ts, which is drawn here rather than handed to the operating
 * system: the native picker is a wheel on most platforms but not all, and it
 * takes none of the editor's theme. The chosen colour is stored by name and
 * read live by the pattern the picker handed the scene, so the rig follows
 * the wheel without a re-run.
 *
 * The wheel speaks the same #rrggbb the native input did, and the colour
 * still reaches the store through fromHex(), so nothing downstream of pick()
 * can tell which control moved it.
 */
class PickerWidget extends WidgetType {
  private swatch: HTMLButtonElement | null = null;
  private wheel: ColorWheel | null = null;
  /** Last hex painted on the swatch, so the per-tick sync does nothing on the
   *  overwhelming majority of ticks, where the colour has not moved. */
  private shown = '';

  constructor(readonly entry: PickerEntry) {
    super();
  }

  eq(other: WidgetType): boolean {
    return other instanceof PickerWidget && other.entry.name === this.entry.name;
  }

  /** Repaint the swatch from the stored colour. Called by the refresh loop so
   *  a colour restored across a re-run shows without waiting for a click. */
  sync(): void {
    const swatch = this.swatch;
    if (!swatch) return;
    const hex = toHex(getPickedColor(this.entry.name) ?? this.entry.initial);
    if (hex === this.shown) return;
    this.shown = hex;
    swatch.style.background = hex;
    // The wheel writes through this same store, so reaching here means
    // something else moved the colour and an open wheel should follow it.
    this.wheel?.setHex(hex);
  }

  toDOM(): HTMLElement {
    const wrap = document.createElement('span');
    wrap.className = 'gobo-picker';

    const label = document.createElement('span');
    label.className = 'gobo-picker-label';
    label.textContent = this.entry.name;

    const hex = toHex(getPickedColor(this.entry.name) ?? this.entry.initial);
    const swatch = document.createElement('button');
    swatch.type = 'button';
    swatch.className = 'gobo-picker-swatch';
    swatch.title = `${this.entry.name} · click for the colour wheel`;
    swatch.setAttribute('aria-label', `${this.entry.name}: colour`);
    swatch.setAttribute('aria-haspopup', 'dialog');
    // Inline, because the shared rule paints no background of its own: it
    // was written for an <input type="color">, which brings its own. The
    // appearance reset goes with it, or a platform button style paints over
    // the colour on the browsers that still have one.
    swatch.style.setProperty('-webkit-appearance', 'none');
    swatch.style.setProperty('appearance', 'none');
    swatch.style.background = hex;
    this.swatch = swatch;
    this.shown = hex;

    swatch.addEventListener('click', () => this.toggle());
    // The editor would otherwise take the click back and move the caret.
    swatch.addEventListener('mousedown', (e) => e.stopPropagation());
    // Only the two keys the button itself answers to are taken off the
    // editor. Ctrl+Enter has to keep running the scene from here.
    swatch.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();
    });

    wrap.append(label, swatch);
    _livePickers.add(this);
    return wrap;
  }

  /** Second click on the swatch puts the wheel away again. */
  private toggle(): void {
    if (this.wheel) {
      this.wheel.close();
      return;
    }
    const swatch = this.swatch;
    if (!swatch) return;
    this.wheel = openColorWheel({
      anchor: swatch,
      label: this.entry.name,
      hex: toHex(getPickedColor(this.entry.name) ?? this.entry.initial),
      onInput: (next) => {
        this.shown = next;
        if (this.swatch) this.swatch.style.background = next;
        setPickedColor(this.entry.name, fromHex(next));
      },
      onClose: () => {
        this.wheel = null;
      },
    });
  }

  destroy(): void {
    // The popover lives on <body>, so nothing else would take it down with
    // the line it belonged to.
    this.wheel?.close();
    this.wheel = null;
    this.swatch = null;
    _livePickers.delete(this);
  }

  ignoreEvent(): boolean {
    return true;
  }
}

/** A colour to the #rrggbb the wheel speaks. Live components read once so a
 *  picker whose colour is itself a pattern still shows something. */
function toHex(c: Color): string {
  const part = (v: unknown): string => {
    const n = typeof v === 'number' ? v : 0;
    return Math.round(Math.max(0, Math.min(1, n)) * 255).toString(16).padStart(2, '0');
  };
  return `#${part(c.r)}${part(c.g)}${part(c.b)}`;
}

function fromHex(hex: string): Color {
  const n = parseInt(hex.slice(1), 16);
  return makeColor(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

/**
 * Picker widgets that currently have DOM, so the tick can keep their swatches
 * in step.
 *
 * Filled by toDOM and drained by destroy, the way the viz widgets above do it,
 * rather than collected in refreshViz. CodeMirror keeps a widget's DOM when
 * the replacement compares equal, and the instance holding that DOM is then
 * the one from the earlier run, not the one the refresh just built. A list
 * built during the refresh would be full of widgets that never rendered, and
 * every sync() on them would quietly do nothing.
 */
const _livePickers = new Set<PickerWidget>();


/** The kinds drawn as a canvas at line-end rather than as a line decoration. */
const SHAPE_KINDS = new Set<PatternVizKind>(['roll', 'punchcard', 'spiral', 'spectrum']);

// ─── Pattern-level inline viz (.flash / .glow / .wave) ──────────────────────
// Distinct decoration pipeline from the fixture-level `.viz(kind)` widgets
// above. Flash and glow apply a CSS class + a `data-gobo-patviz` index to
// the line they appear on (via `Decoration.line`), then a tick subscription
// finds those lines by data-attribute and mutates their inline styles from
// the current pattern sample. Wave places a canvas widget at line-end and
// draws a recent-history sparkline of the pattern.

interface PatternVizDecoEntry {
  /** Matches the PatternVizEntry in @gobo/core. */
  core: PatternVizEntry;
  /** Line number (1-based) the decoration was placed on. */
  line: number;
  /** Attached to Decoration.line or the WaveSparkline via data-attr so the
   *  tick updater can find this entry's rendered DOM. */
  idx: number;
  /** Sparkline widget reference (wave only). */
  sparkline?: PatternWaveWidget;
  /** Canvas widget reference (roll / punchcard / spiral / spectrum). */
  shape?: PatternShapeWidget;
  /** Cached line element, so the tick avoids a querySelector. Stays null
   *  until the line is first rendered, and is re-queried if CM drops the
   *  reference (viewport scroll, line DOM recycle). */
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
    span.className = 'gobo-patviz-wave';
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
 * The structural decorations: roll, punchcard, spiral and spectrum.
 *
 * All four are small canvases at the end of the line, and all four are fed the
 * same two things on each tick: the events of the current cycle and where the
 * playhead is inside it. Sharing one class keeps the drawing differences to a
 * single switch rather than four near-identical widgets.
 *
 * The cycle is re-queried only when the cycle number changes, not every tick:
 * the shape of a bar does not move within the bar, and querying a whole cycle
 * sixty times a second for a decoration would be real work for no gain.
 */
class PatternShapeWidget extends WidgetType {
  private canvas: HTMLCanvasElement | null = null;
  private spans: PatternSpan[] = [];
  private cachedCycle = -1;
  /** Recent values, for the spectrum's transform. */
  private history: number[] = [];
  private readonly HISTORY = 64;

  constructor(
    private readonly idx: number,
    private readonly kind: PatternVizKind,
  ) {
    super();
  }

  eq(other: WidgetType): boolean {
    return other instanceof PatternShapeWidget
      && other.idx === this.idx && other.kind === this.kind;
  }

  private width(): number {
    // A spiral is square; the rest read left to right.
    return this.kind === 'spiral' ? 16 : 70;
  }

  toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = `gobo-patviz-shape gobo-patviz-${this.kind}`;
    span.setAttribute('aria-hidden', 'true');
    span.contentEditable = 'false';
    span.title = this.kind;
    const c = document.createElement('canvas');
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const w = this.width();
    c.width = w * dpr;
    c.height = 16 * dpr;
    c.style.width = `${w}px`;
    c.style.height = '16px';
    span.appendChild(c);
    this.canvas = c;
    this.cachedCycle = -1;
    return span;
  }

  /** Called once per tick with the pattern and the position within the cycle. */
  update(pattern: PatternLike, cyclePos: number, value: number): void {
    const c = this.canvas;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;

    const cycle = Math.floor(cyclePos);
    if (cycle !== this.cachedCycle) {
      this.cachedCycle = cycle;
      this.spans = sampleCycle(pattern, cycle);
    }
    const phase = cyclePos - cycle;

    this.history.push(Math.max(0, Math.min(1, value)));
    if (this.history.length > this.HISTORY) this.history.shift();

    const { width: w, height: h } = c;
    ctx.clearRect(0, 0, w, h);

    switch (this.kind) {
      case 'roll':      this.drawRoll(ctx, w, h, phase); break;
      case 'punchcard': this.drawPunchcard(ctx, w, h, phase); break;
      case 'spiral':    this.drawSpiral(ctx, w, h, phase); break;
      case 'spectrum':  this.drawSpectrum(ctx, w, h); break;
      default: break;
    }
  }

  /** Events as blocks across the bar, height by level, plus a playhead. */
  private drawRoll(ctx: CanvasRenderingContext2D, w: number, h: number, phase: number): void {
    for (const s of this.spans) {
      const x = s.begin * w;
      // A zero-length event still has to be visible, hence the floor.
      const bw = Math.max(1, (s.end - s.begin) * w);
      const bh = Math.max(1, s.value * (h - 2));
      ctx.fillStyle = `rgba(196, 114, 74, ${0.35 + s.value * 0.65})`;
      ctx.fillRect(x, h - bh, bw - 0.5, bh);
    }
    ctx.fillStyle = 'rgba(230, 200, 150, 0.85)';
    ctx.fillRect(phase * w, 0, 1, h);
  }

  /** A fixed grid of cells: where the hits land, at a glance. */
  private drawPunchcard(ctx: CanvasRenderingContext2D, w: number, h: number, phase: number): void {
    const CELLS = 16;
    const cw = w / CELLS;
    for (let i = 0; i < CELLS; i++) {
      const at = (i + 0.5) / CELLS;
      // The level covering this cell's midpoint, so a held event fills every
      // cell it spans rather than only the one it starts in.
      let v = 0;
      for (const s of this.spans) {
        if (at >= s.begin && at < Math.max(s.end, s.begin + 1e-6) && s.value > v) v = s.value;
      }
      const inset = cw * 0.18;
      const size = Math.max(1, cw - inset * 2);
      const y = h / 2 - size / 2;
      ctx.fillStyle = v > 0
        ? `rgba(196, 114, 74, ${0.35 + v * 0.65})`
        : 'rgba(255, 255, 255, 0.07)';
      ctx.fillRect(i * cw + inset, y, size, size);
    }
    const playing = Math.floor(phase * CELLS);
    ctx.strokeStyle = 'rgba(230, 200, 150, 0.9)';
    ctx.lineWidth = 1;
    ctx.strokeRect(playing * cw + 0.5, 0.5, cw - 1, h - 1);
  }

  /** The bar wound round, with the playhead sweeping it like a radar. */
  private drawSpiral(ctx: CanvasRenderingContext2D, w: number, h: number, phase: number): void {
    const cx = w / 2;
    const cy = h / 2;
    const rMax = Math.min(cx, cy) - 1;
    const TURNS = 2;
    ctx.lineWidth = Math.max(1, rMax / 5);
    for (const s of this.spans) {
      if (s.value <= 0) continue;
      const a0 = s.begin * Math.PI * 2 * TURNS - Math.PI / 2;
      const a1 = Math.max(s.end, s.begin + 0.004) * Math.PI * 2 * TURNS - Math.PI / 2;
      const r = rMax * (0.35 + 0.65 * s.begin);
      ctx.strokeStyle = `rgba(196, 114, 74, ${0.35 + s.value * 0.65})`;
      ctx.beginPath();
      ctx.arc(cx, cy, r, a0, a1);
      ctx.stroke();
    }
    const pa = phase * Math.PI * 2 * TURNS - Math.PI / 2;
    const pr = rMax * (0.35 + 0.65 * phase);
    ctx.fillStyle = 'rgba(230, 200, 150, 0.95)';
    ctx.beginPath();
    ctx.arc(cx + Math.cos(pa) * pr, cy + Math.sin(pa) * pr, Math.max(1, rMax / 7), 0, Math.PI * 2);
    ctx.fill();
  }

  /**
   * Which rates the recent values move at.
   *
   * A plain magnitude transform over the value history, so a strobe shows a
   * peak at its rate and a slow fade sits at the left. It is a spectrum of the
   * CHANNEL, not of any audio: there is no sound in this program to analyse,
   * and pretending otherwise would be the wrong reading of the picture.
   */
  private drawSpectrum(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const n = this.history.length;
    if (n < 8) return;
    const mean = this.history.reduce((a, b) => a + b, 0) / n;
    const BINS = 16;
    let peak = 1e-6;
    const mags: number[] = [];
    for (let k = 1; k <= BINS; k++) {
      let re = 0;
      let im = 0;
      for (let i = 0; i < n; i++) {
        // Mean removed so a channel held at full does not read as one huge
        // bin and flatten everything else.
        const v = this.history[i] - mean;
        const ang = (2 * Math.PI * k * i) / n;
        re += v * Math.cos(ang);
        im -= v * Math.sin(ang);
      }
      const mag = Math.sqrt(re * re + im * im) / n;
      mags.push(mag);
      if (mag > peak) peak = mag;
    }
    const bw = w / BINS;
    for (let k = 0; k < BINS; k++) {
      const t = mags[k] / peak;
      const bh = Math.max(1, t * (h - 2));
      ctx.fillStyle = `rgba(196, 114, 74, ${0.3 + t * 0.7})`;
      ctx.fillRect(k * bw, h - bh, Math.max(1, bw - 1), bh);
    }
  }

  destroy(): void {
    this.canvas = null;
    this.spans = [];
    this.history = [];
  }
}

/**
 * Tick subscription that drives the flash / glow / wave decorations from
 * their patterns' current sample values. Runs on the same worker-clock
 * schedule as the main pattern engine.
 *
 * Light-touch on the main thread: only CSS custom-property writes and, for
 * wave, a small canvas redraw. No attribute toggles and no forced reflows.
 * An earlier implementation used `void offsetWidth` to restart a keyframe
 * animation on each rising edge, and those synchronous layouts stalled the
 * DMX tick enough to jitter packet timing, which showed up as physical-light
 * flicker on Art-Net fixtures.
 *
 * Flash is driven the same way glow is: a decaying intensity written as a
 * CSS custom property. Rising edge → bump intensity to 1. Each tick → decay
 * toward zero. CSS multiplies it into the bg colour.
 */
const FLASH_DECAY_PER_TICK = 0.10;   // ≈170ms to zero at 60Hz
const FLASH_RISE_THRESHOLD = 0.5;

const _lastValue = new Map<number, number>();

onTick(() => {
  // Handles follow the stored value, so a control moved from anywhere else
  // cannot leave a stale position on screen. Skipped while one is being
  // dragged, which the widget checks by focus.
  for (const w of _sliderWidgets) w.sync();
  for (const w of _livePickers) w.sync();

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

    if (deco.shape) {
      deco.shape.update(deco.core.pattern, cyclePos, value);
      continue;
    }

    // Cache the line element to avoid a querySelector every tick. CM may
    // drop the rendered node on viewport scroll, so re-query on miss.
    let lineEl = deco.cachedLineEl;
    if (!lineEl || !lineEl.isConnected) {
      lineEl = document.querySelector<HTMLElement>(
        `.cm-content .cm-line[data-gobo-patviz="${deco.idx}"]`,
      );
      deco.cachedLineEl = lineEl;
    }
    if (!lineEl) continue; // line is outside CM's virtualized viewport

    if (deco.core.kind === 'glow') {
      lineEl.style.setProperty('--gobo-val', value.toFixed(3));
    } else if (deco.core.kind === 'flash') {
      // Rising edge bumps the decaying intensity; otherwise decay toward 0.
      // A CSS-var write only, with no attribute toggles and no reflow, so
      // the tick handler stays fast and DMX timing stays even.
      let fi = deco.flashIntensity ?? 0;
      if (value > FLASH_RISE_THRESHOLD && prev <= FLASH_RISE_THRESHOLD) {
        fi = 1;
      } else {
        fi = Math.max(0, fi - FLASH_DECAY_PER_TICK);
      }
      deco.flashIntensity = fi;
      lineEl.style.setProperty('--gobo-flash', fi.toFixed(3));
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
 * Call after every successful eval. The steps:
 *   1. Read VizEntries from @gobo/core (populated by `.viz()` calls during eval).
 *   2. Strip the doc of comments and string contents, then record where every
 *      `.viz(` call site is, one entry per call rather than per line.
 *   3. Zip the two lists 1:1. Any excess on either side is ignored.
 *   4. For each (entry, line) pair, emit one widget per kind at line-end.
 *
 * Step 2 is the load-bearing one. The zip is positional, so a call site the
 * scan sees but the run never made pushes every later widget onto the wrong
 * line, and a widget lands on the very line that was supposed to have gone
 * quiet. Both lists have to be counted the same way for that not to happen.
 */
export function refreshViz(view: EditorView, opts: { disabled?: boolean } = {}): void {
  // Settings can disable inline viz entirely. Dispatch an empty decoration
  // set to clear any widgets placed by a previous successful eval.
  if (opts.disabled) {
    _patternVizEntries.clear();
    view.dispatch({ effects: setVizDecorations.of(Decoration.set([])) });
    return;
  }
  const entries = getVizEntries();
  const doc = view.state.doc;

  // One strip of the whole buffer, shared by every scan below. Comments and
  // string contents are spaces in it, so a call site that has been commented
  // out is not a call site. See source-scan.ts for why that is not as simple
  // as cutting each line at its first pair of slashes.
  const code = stripNonCode(doc.toString());

  const vizHits = findCalls(code, /\.viz\s*\(/g);

  const ranges: Array<{ from: number; to: number; value: Decoration }> = [];
  const pairs = Math.min(entries.length, vizHits.length);
  for (let i = 0; i < pairs; i++) {
    const entry = entries[i];
    const line = doc.line(vizHits[i].line);
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

  // ─── Live controls (slider) ─────────────────────────────────────────────
  // Same zip as everything else: walk the doc for slider( call sites and pair
  // them in order with what the scene declared.
  _sliderWidgets = [];
  const controls = getControls();
  const sliderHits = findCalls(code, /\bslider\s*\(/g);
  const sliderPairs = Math.min(controls.length, sliderHits.length);
  for (let i = 0; i < sliderPairs; i++) {
    const widget = new SliderWidget(controls[i]);
    _sliderWidgets.push(widget);
    const lineObj = doc.line(sliderHits[i].line);
    ranges.push({
      from: lineObj.to,
      to: lineObj.to,
      value: Decoration.widget({ widget, side: 1 }),
    });
  }


  // ─── Colour pickers (pick) ──────────────────────────────────────────────
  const pickers = getPickers();
  const pickHits = findCalls(code, /\bpick\s*\(/g);
  const pickPairs = Math.min(pickers.length, pickHits.length);
  for (let i = 0; i < pickPairs; i++) {
    const widget = new PickerWidget(pickers[i]);
    const lineObj = doc.line(pickHits[i].line);
    ranges.push({
      from: lineObj.to,
      to: lineObj.to,
      value: Decoration.widget({ widget, side: 1 }),
    });
  }

  // ─── Pattern-level viz (.flash / .glow / .wave on pattern calls) ────────
  // One regex over the stripped source, so the order of matches within a
  // line is the order the entries were pushed in and the 1:1 zip holds.
  _patternVizEntries.clear();
  const patEntries = getPatternVizEntries();
  const patHits = findCalls(code, /\.(flash|glow|wave|roll|punchcard|spiral|spectrum)\s*\(/g);

  const patPairs = Math.min(patEntries.length, patHits.length);
  for (let i = 0; i < patPairs; i++) {
    const coreEntry = patEntries[i];
    const hit = patHits[i];
    // Skip if the source kind and the registered kind disagree; that is
    // usually an identifier collision, not a real chain call.
    if ((hit.match[1] as PatternVizKind) !== coreEntry.kind) continue;
    const lineObj = doc.line(hit.line);
    const deco: PatternVizDecoEntry = { core: coreEntry, line: hit.line, idx: i };
    _patternVizEntries.set(i, deco);

    if (coreEntry.kind === 'wave') {
      // Widget at end-of-line. The tick loop pushes samples into its canvas.
      const widget = new PatternWaveWidget(i);
      deco.sparkline = widget;
      ranges.push({
        from: lineObj.to,
        to: lineObj.to,
        value: Decoration.widget({ widget, side: 1 }),
      });
    } else if (SHAPE_KINDS.has(coreEntry.kind)) {
      // Also end-of-line, and also fed by the tick. Several on one line
      // simply become several widgets, in the order they were written.
      const widget = new PatternShapeWidget(i, coreEntry.kind);
      deco.shape = widget;
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
            class: `gobo-patviz gobo-patviz-${coreEntry.kind}`,
            'data-gobo-patviz': String(i),
          },
        }),
      });
    }
  }

  // Line decorations sort before widget decorations at the same position.
  // Decoration.set wants ranges sorted by `from` and handles the secondary
  // ordering itself, so sort by `from` ascending and leave the rest to CM.
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
