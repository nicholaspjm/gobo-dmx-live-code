/**
 * A drawn colour wheel, for the swatch beside a pick().
 *
 * The swatch used to be an `<input type="color">`, which hands the job to the
 * operating system. That is a wheel on most platforms but a set of sliders on
 * some, it cannot take the editor's theme, and on a dark stage it is a bright
 * grey box in the middle of a dark buffer. This is the same control drawn
 * here instead, so it looks and behaves the same everywhere at the cost of
 * owning it.
 *
 * What it is: an HSV disc, hue by angle and saturation by radius, with a
 * value bar beside it. Two axes on the disc and one on the bar covers the
 * whole cube, and it is the arrangement most people have already used.
 *
 * The disc is drawn once at full value into an ImageData and then scaled per
 * frame, because the per-pixel hue conversion is the expensive half and the
 * value is a multiply. Dragging repaints on every pointer move and this keeps
 * that cheap enough not to compete with the DMX tick.
 *
 * Placement: the popover is a child of <body> with `position: fixed`, not a
 * child of the widget. Inside the editor it would be clipped by the
 * scroller's overflow and pushed around by the line it sits on. Fixed
 * positioning off the swatch's own rect means it follows the swatch when the
 * document scrolls, and closes rather than floating loose once the swatch
 * itself has scrolled out of sight.
 *
 * Its rules are here rather than in the page stylesheet so that importing the
 * module is all there is to it; they read the same theme variables the rest
 * of the page does, so a theme change carries.
 */

/** Handle for the popover the caller opened. */
export interface ColorWheel {
  /**
   * Follow a colour set from somewhere else. Cheap and safe to call often:
   * a hex that matches what the wheel is already on does nothing.
   */
  setHex(hex: string): void;
  /** Take it down and drop every listener. Safe to call more than once. */
  close(): void;
}

export interface ColorWheelOptions {
  /** The swatch the popover hangs off, and where focus goes on Escape. */
  anchor: HTMLElement;
  /** The picker's name, for the accessible label. */
  label: string;
  /** Opening colour, as `#rrggbb`. */
  hex: string;
  /** Called on every movement, not only at the end, so the rig follows. */
  onInput: (hex: string) => void;
  /** Called once, whenever and however the popover goes away. */
  onClose: () => void;
}

/** Disc diameter and bar width, in CSS pixels. */
const DISC = 132;
const BAR_W = 14;
/** Gap between the popover and the swatch, and the margin it keeps from the
 *  window edge when it has to be pushed back inside. */
const OFFSET = 6;
const MARGIN = 4;

const STYLE_ID = 'gobo-wheel-style';

const CSS = `
.gobo-wheel {
  position: fixed;
  top: 0;
  left: 0;
  /* Above the sliding panels, which sit at 100, like the scene menu. */
  z-index: 120;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 6px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45);
  font-family: var(--mono, ui-monospace, monospace);
}
.gobo-wheel-row {
  display: flex;
  gap: 10px;
  align-items: flex-start;
}
.gobo-wheel-disc,
.gobo-wheel-bar {
  display: block;
  /* A pointer drag is the primary gesture, so it must not scroll the page
     out from under itself on a touch screen. */
  touch-action: none;
}
.gobo-wheel-disc {
  border-radius: 50%;
  cursor: crosshair;
}
.gobo-wheel-bar {
  border-radius: 3px;
  cursor: ns-resize;
}
.gobo-wheel-disc:focus-visible,
.gobo-wheel-bar:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 3px;
}
.gobo-wheel-foot {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 10px;
  letter-spacing: 0.06em;
  color: var(--text-muted);
}
.gobo-wheel-hex {
  color: var(--text);
}
`;

function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

// ─── Colour maths ────────────────────────────────────────────────────────────

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** h in degrees, s and v in 0..1, out as three 0..255 integers. */
function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const c = v * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1)      { r = c; g = x; }
  else if (hp < 2) { r = x; g = c; }
  else if (hp < 3) { g = c; b = x; }
  else if (hp < 4) { g = x; b = c; }
  else if (hp < 5) { r = x; b = c; }
  else             { r = c; b = x; }
  const m = v - c;
  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  ];
}

function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
  const rr = r / 255;
  const gg = g / 255;
  const bb = b / 255;
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === rr) h = 60 * (((gg - bb) / d) % 6);
    else if (max === gg) h = 60 * ((bb - rr) / d + 2);
    else h = 60 * ((rr - gg) / d + 4);
  }
  return { h: (h + 360) % 360, s: max === 0 ? 0 : d / max, v: max };
}

function toHex(r: number, g: number, b: number): string {
  const part = (n: number): string => n.toString(16).padStart(2, '0');
  return `#${part(r)}${part(g)}${part(b)}`;
}

function fromHex(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// ─── The popover ─────────────────────────────────────────────────────────────

export function openColorWheel(opts: ColorWheelOptions): ColorWheel {
  ensureStyle();
  const dpr = Math.max(1, window.devicePixelRatio || 1);

  const root = document.createElement('div');
  root.className = 'gobo-wheel';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', `${opts.label}: colour`);

  const row = document.createElement('div');
  row.className = 'gobo-wheel-row';

  const disc = document.createElement('canvas');
  disc.className = 'gobo-wheel-disc';
  disc.width = Math.round(DISC * dpr);
  disc.height = Math.round(DISC * dpr);
  disc.style.width = `${DISC}px`;
  disc.style.height = `${DISC}px`;
  disc.tabIndex = 0;
  // Two axes announced as one control. A slider is the closest role there is
  // for it, so hue is the value and saturation goes in the spoken text.
  disc.setAttribute('role', 'slider');
  disc.setAttribute('aria-label', 'hue and saturation');
  disc.setAttribute('aria-valuemin', '0');
  disc.setAttribute('aria-valuemax', '360');

  const bar = document.createElement('canvas');
  bar.className = 'gobo-wheel-bar';
  bar.width = Math.round(BAR_W * dpr);
  bar.height = Math.round(DISC * dpr);
  bar.style.width = `${BAR_W}px`;
  bar.style.height = `${DISC}px`;
  bar.tabIndex = 0;
  bar.setAttribute('role', 'slider');
  bar.setAttribute('aria-label', 'brightness');
  bar.setAttribute('aria-valuemin', '0');
  bar.setAttribute('aria-valuemax', '100');

  const foot = document.createElement('div');
  foot.className = 'gobo-wheel-foot';
  const name = document.createElement('span');
  name.textContent = opts.label;
  const hexOut = document.createElement('span');
  hexOut.className = 'gobo-wheel-hex';
  foot.append(name, hexOut);

  row.append(disc, bar);
  root.append(row, foot);

  const dctx = disc.getContext('2d');
  const bctx = bar.getContext('2d');

  // Current colour, held as HSV. Hex is a rounding of this, so keeping HSV
  // as the truth is what stops the cursor drifting as a drag crosses cells
  // that round to the same byte.
  const start = rgbToHsv(...fromHex(opts.hex));
  let h = start.h;
  let s = start.s;
  let v = start.v;

  // ─── Drawing ───────────────────────────────────────────────────────────

  const px = disc.width;
  const centre = px / 2;
  /** Drawn radius, one CSS pixel in from the edge so the rim has room. */
  const radius = centre - dpr;

  /** The disc at full value, built once. */
  const base = dctx ? dctx.createImageData(px, px) : null;
  const frame = dctx ? dctx.createImageData(px, px) : null;

  if (base) {
    const d = base.data;
    for (let y = 0; y < px; y++) {
      for (let x = 0; x < px; x++) {
        const dx = x + 0.5 - centre;
        const dy = y + 0.5 - centre;
        const dist = Math.hypot(dx, dy);
        const k = (y * px + x) * 4;
        if (dist > radius + 1) {
          d[k + 3] = 0;
          continue;
        }
        const hue = (Math.atan2(dy, dx) * 180) / Math.PI;
        const [r, g, b] = hsvToRgb(hue, Math.min(1, dist / radius), 1);
        d[k] = r;
        d[k + 1] = g;
        d[k + 2] = b;
        // A one-pixel ramp at the rim, so the circle does not have stairs.
        d[k + 3] = Math.round(255 * clamp01(radius + 1 - dist));
      }
    }
  }

  /**
   * The cursor rings are fixed white over black rather than a theme colour.
   * They sit on every hue at once, and an accent would disappear over its
   * own corner of the disc.
   */
  function drawCursor(ctx: CanvasRenderingContext2D): void {
    const a = (h * Math.PI) / 180;
    const r = s * radius;
    const x = centre + Math.cos(a) * r;
    const y = centre + Math.sin(a) * r;
    ctx.lineWidth = 1.5 * dpr;
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.beginPath();
    ctx.arc(x, y, 5.5 * dpr, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 1.5 * dpr;
    ctx.strokeStyle = '#fff';
    ctx.beginPath();
    ctx.arc(x, y, 4 * dpr, 0, Math.PI * 2);
    ctx.stroke();
  }

  function paintDisc(): void {
    if (!dctx || !base || !frame) return;
    const src = base.data;
    const dst = frame.data;
    for (let k = 0; k < src.length; k += 4) {
      dst[k] = src[k] * v;
      dst[k + 1] = src[k + 1] * v;
      dst[k + 2] = src[k + 2] * v;
      dst[k + 3] = src[k + 3];
    }
    dctx.putImageData(frame, 0, 0);
    drawCursor(dctx);
  }

  function paintBar(): void {
    if (!bctx) return;
    const [r, g, b] = hsvToRgb(h, s, 1);
    const grad = bctx.createLinearGradient(0, 0, 0, bar.height);
    grad.addColorStop(0, `rgb(${r},${g},${b})`);
    grad.addColorStop(1, '#000');
    bctx.fillStyle = grad;
    bctx.fillRect(0, 0, bar.width, bar.height);
    // The handle is a line across the bar, clamped in far enough at the ends
    // that it never draws half off the canvas.
    const edge = 1.5 * dpr;
    const y = Math.min(bar.height - edge, Math.max(edge, (1 - v) * bar.height));
    bctx.lineWidth = 3 * dpr;
    bctx.strokeStyle = 'rgba(0,0,0,0.6)';
    bctx.beginPath();
    bctx.moveTo(0, y);
    bctx.lineTo(bar.width, y);
    bctx.stroke();
    bctx.lineWidth = 1.5 * dpr;
    bctx.strokeStyle = '#fff';
    bctx.beginPath();
    bctx.moveTo(0, y);
    bctx.lineTo(bar.width, y);
    bctx.stroke();
  }

  function currentHex(): string {
    return toHex(...hsvToRgb(h, s, v));
  }

  /** Repaint and say what the colour now is. No side effect outside here. */
  function render(): void {
    paintDisc();
    paintBar();
    hexOut.textContent = currentHex();
    disc.setAttribute('aria-valuenow', String(Math.round(h)));
    disc.setAttribute(
      'aria-valuetext',
      `hue ${Math.round(h)} degrees, saturation ${Math.round(s * 100)} percent`,
    );
    bar.setAttribute('aria-valuenow', String(Math.round(v * 100)));
    bar.setAttribute('aria-valuetext', `brightness ${Math.round(v * 100)} percent`);
  }

  /** Render, then hand the colour out. Every movement calls this, so the rig
   *  follows the wheel rather than waiting for it to be let go of. */
  function emit(): void {
    render();
    opts.onInput(currentHex());
  }

  // ─── Pointer ───────────────────────────────────────────────────────────

  function discFromPoint(clientX: number, clientY: number): void {
    const r = disc.getBoundingClientRect();
    const dx = clientX - (r.left + r.width / 2);
    const dy = clientY - (r.top + r.height / 2);
    h = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
    // Dragging past the rim pins saturation at full and keeps steering the
    // hue, which is how a wheel is expected to behave once you leave it.
    s = clamp01(Math.hypot(dx, dy) / (r.width / 2 - 1));
    emit();
  }

  function barFromPoint(clientY: number): void {
    const r = bar.getBoundingClientRect();
    v = clamp01(1 - (clientY - r.top) / r.height);
    emit();
  }

  function dragHandlers(
    el: HTMLElement,
    apply: (e: PointerEvent) => void,
  ): void {
    let held = -1;
    el.addEventListener('pointerdown', (e) => {
      held = e.pointerId;
      el.focus({ preventScroll: true });
      apply(e);
      // Capture keeps the drag alive once the pointer leaves the canvas,
      // which on a disc is most of a drag. It is asked for after the press
      // has been read, so that a pointer the browser refuses to capture
      // costs the rest of the drag and not the press as well.
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // No capture available; the drag holds only while over the canvas.
      }
      // No text selection, and no caret landing behind the popover.
      e.preventDefault();
      e.stopPropagation();
    });
    el.addEventListener('pointermove', (e) => {
      if (e.pointerId === held) apply(e);
    });
    const release = (e: PointerEvent): void => {
      if (e.pointerId !== held) return;
      held = -1;
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    };
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);
  }

  dragHandlers(disc, (e) => discFromPoint(e.clientX, e.clientY));
  dragHandlers(bar, (e) => barFromPoint(e.clientY));

  // ─── Keyboard ──────────────────────────────────────────────────────────
  //
  // Both canvases are in the tab order and answer to the arrow keys. Tab
  // moves between the two and no further: the popover is a dialog, and
  // Escape is the way out of it.

  function step(e: KeyboardEvent, coarse: number, fine: number): number {
    return e.shiftKey ? coarse : fine;
  }

  function trapTab(e: KeyboardEvent, other: HTMLElement): boolean {
    if (e.key !== 'Tab') return false;
    other.focus();
    e.preventDefault();
    return true;
  }

  disc.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    let handled = true;
    switch (e.key) {
      case 'ArrowLeft':  h = (h - step(e, 10, 2) + 360) % 360; break;
      case 'ArrowRight': h = (h + step(e, 10, 2)) % 360; break;
      case 'ArrowUp':    s = clamp01(s + step(e, 0.1, 0.02)); break;
      case 'ArrowDown':  s = clamp01(s - step(e, 0.1, 0.02)); break;
      case 'PageUp':     h = (h + 30) % 360; break;
      case 'PageDown':   h = (h - 30 + 360) % 360; break;
      case 'Home':       s = 0; break;
      case 'End':        s = 1; break;
      default:           handled = trapTab(e, bar); break;
    }
    if (!handled) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key !== 'Tab') emit();
  });

  bar.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    let handled = true;
    switch (e.key) {
      case 'ArrowUp':
      case 'ArrowRight': v = clamp01(v + step(e, 0.1, 0.02)); break;
      case 'ArrowDown':
      case 'ArrowLeft':  v = clamp01(v - step(e, 0.1, 0.02)); break;
      case 'Home':       v = 0; break;
      case 'End':        v = 1; break;
      default:           handled = trapTab(e, disc); break;
    }
    if (!handled) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key !== 'Tab') emit();
  });

  // ─── Placement, and going away ─────────────────────────────────────────

  let closed = false;

  /**
   * The ancestors that clip the swatch, worked out once on the way up. The
   * chain cannot change while the popover is open, and reading computed
   * styles on every scroll event would be a forced style recalculation on a
   * path that has to stay out of the tick's way.
   */
  const clippers: Element[] = [];
  for (let el = opts.anchor.parentElement; el; el = el.parentElement) {
    const s = getComputedStyle(el);
    if (s.overflow !== 'visible' || s.overflowX !== 'visible' || s.overflowY !== 'visible') {
      clippers.push(el);
    }
  }

  /**
   * Whether any of the swatch is still showing. The window is not enough to
   * go on: the editor scrolls inside its own box, so a line can leave the
   * screen while the window has not moved at all.
   */
  function anchorVisible(r: DOMRect): boolean {
    let left = 0;
    let top = 0;
    let right = window.innerWidth;
    let bottom = window.innerHeight;
    for (const el of clippers) {
      const b = el.getBoundingClientRect();
      left = Math.max(left, b.left);
      top = Math.max(top, b.top);
      right = Math.min(right, b.right);
      bottom = Math.min(bottom, b.bottom);
    }
    return r.right > left && r.left < right && r.bottom > top && r.top < bottom;
  }

  function place(): void {
    if (closed) return;
    const r = opts.anchor.getBoundingClientRect();
    // The swatch has gone, so there is nothing left to point at. Better away
    // than parked over unrelated text.
    if (!anchorVisible(r)) {
      close();
      return;
    }
    const w = root.offsetWidth;
    const hgt = root.offsetHeight;
    let top = r.bottom + OFFSET;
    if (top + hgt > window.innerHeight - MARGIN) {
      // No room below: put it above the swatch, and if there is no room
      // there either, sit against the bottom edge.
      const above = r.top - hgt - OFFSET;
      top = above >= MARGIN ? above : Math.max(MARGIN, window.innerHeight - hgt - MARGIN);
    }
    const left = Math.min(Math.max(MARGIN, r.left), Math.max(MARGIN, window.innerWidth - w - MARGIN));
    root.style.left = `${Math.round(left)}px`;
    root.style.top = `${Math.round(top)}px`;
  }

  function onDocPointerDown(e: PointerEvent): void {
    const target = e.target as Node | null;
    if (target && (root.contains(target) || opts.anchor.contains(target))) return;
    close();
  }

  function onDocKeyDown(e: KeyboardEvent): void {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    close(true);
  }

  function close(returnFocus = false): void {
    if (closed) return;
    closed = true;
    document.removeEventListener('pointerdown', onDocPointerDown, true);
    document.removeEventListener('keydown', onDocKeyDown, true);
    window.removeEventListener('scroll', place, true);
    window.removeEventListener('resize', place);
    root.remove();
    // Back to the swatch, so a keyboard user is where they started rather
    // than at the top of the document.
    if (returnFocus && opts.anchor.isConnected) opts.anchor.focus();
    opts.onClose();
  }

  document.body.appendChild(root);
  // Render rather than emit: opening the wheel is not a movement, and writing
  // the colour back to the store on open would be a change nobody made.
  render();

  // Listeners before the first place(), because place() can decide there is
  // nothing to point at and close on the spot, and close() can only take
  // down listeners that are already up.
  //
  // Scroll is captured rather than bubbled: the editor scrolls inside its own
  // box without the window moving, and the popover has to travel with the
  // line either way.
  window.addEventListener('scroll', place, true);
  window.addEventListener('resize', place);
  document.addEventListener('pointerdown', onDocPointerDown, true);
  document.addEventListener('keydown', onDocKeyDown, true);

  place();
  if (!closed) disc.focus({ preventScroll: true });

  return {
    setHex(hex: string): void {
      if (closed || hex === currentHex()) return;
      const next = rgbToHsv(...fromHex(hex));
      // Black and grey carry no hue, and pure black no saturation either.
      // Taking the reading anyway would swing the cursor to red every time
      // something else dimmed the colour to nothing.
      if (next.v > 0 && next.s > 0) h = next.h;
      if (next.v > 0) s = next.s;
      v = next.v;
      render();
    },
    close(): void {
      close();
    },
  };
}
