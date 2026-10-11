/**
 * Scattered music-note wallpaper. A moving pointer slips nearby notes
 * aside; each one eases back home without springing past it.
 */

export type NoteKind = "beamed" | "beamedBar" | "eighth" | "quarter";

export type Note = {
  x: number;
  y: number;
  homeX: number;
  homeY: number;
  vx: number;
  vy: number;
  angle: number;
  homeAngle: number;
  va: number;
  scale: number;
  kind: NoteKind;
  /** 0–1 highlight that fades as the note settles. */
  stir: number;
};

export type FieldPointer = {
  x: number;
  y: number;
  /** Movement since the previous step, in CSS pixels. */
  dx: number;
  dy: number;
  inside: boolean;
};

type Rgb = [number, number, number];

const TILE = 240;
const RADIUS = 128;
/** Backing-store cap. The draw transform must use this same scale. */
const MAX_BACKING_SCALE = 2;
const RADIUS_SQ = RADIUS * RADIUS;
/** How far a pass can carry a note before it firms up. */
const MAX_OFFSET = 72;

type Slot = {
  x: number;
  y: number;
  rot: number;
  scale: number;
  kind: NoteKind;
};

/** Same placements as the tiled note wallpaper (240px cell). */
const SLOTS: Slot[] = [
  { x: 18 + 12 * 0.95, y: 22 + 12 * 0.95, rot: 0, scale: 0.95, kind: "beamed" },
  {
    x: 128 + 12 * 0.85,
    y: 8 + 12 * 0.85,
    rot: 12,
    scale: 0.85,
    kind: "eighth",
  },
  { x: 72 + 12 * 0.9, y: 88 + 12 * 0.9, rot: -8, scale: 0.9, kind: "quarter" },
  {
    x: 178 + 12 * 0.8,
    y: 78 + 12 * 0.8,
    rot: 18,
    scale: 0.8,
    kind: "beamedBar",
  },
  {
    x: 28 + 12 * 0.88,
    y: 158 + 12 * 0.88,
    rot: 6,
    scale: 0.88,
    kind: "eighth",
  },
  {
    x: 148 + 12 * 0.92,
    y: 152 + 12 * 0.92,
    rot: -14,
    scale: 0.92,
    kind: "beamed",
  },
  {
    x: 98 + 12 * 0.75,
    y: 198 + 12 * 0.75,
    rot: 22,
    scale: 0.75,
    kind: "quarter",
  },
  {
    x: 198 + 12 * 0.7,
    y: 198 + 12 * 0.7,
    rot: -4,
    scale: 0.7,
    kind: "beamedBar",
  },
];

/**
 * Bitmap size for a CSS viewport. The draw transform must use `scale`, or a
 * devicePixelRatio change (moving to a retina display) paints oversized notes
 * in the wrong place.
 */
export function fieldBackingSize(
  cssWidth: number,
  cssHeight: number,
  devicePixelRatio: number,
): { width: number; height: number; scale: number } {
  const dpr = devicePixelRatio > 0 ? devicePixelRatio : 1;
  const scale = Math.min(dpr, MAX_BACKING_SCALE);
  return {
    width: Math.max(1, Math.round(cssWidth * scale)),
    height: Math.max(1, Math.round(cssHeight * scale)),
    scale,
  };
}

export function seedNotes(width: number, height: number): Note[] {
  const notes: Note[] = [];
  for (let y = -TILE; y < height + TILE; y += TILE) {
    for (let x = -TILE; x < width + TILE; x += TILE) {
      for (const slot of SLOTS) {
        const homeX = x + slot.x;
        const homeY = y + slot.y;
        const angle = (slot.rot * Math.PI) / 180;
        notes.push({
          x: homeX,
          y: homeY,
          homeX,
          homeY,
          vx: 0,
          vy: 0,
          angle,
          homeAngle: angle,
          va: 0,
          scale: slot.scale,
          kind: slot.kind,
          stir: 0,
        });
      }
    }
  }
  return notes;
}

export function stepNotes(
  notes: Note[],
  pointer: FieldPointer,
  dtMs: number,
): void {
  const frame = Math.min(Math.max(dtMs / (1000 / 60), 0.25), 3);
  const moved = Math.hypot(pointer.dx, pointer.dy);

  if (pointer.inside && moved > 0.4) {
    const inv = 1 / moved;
    const mdx = pointer.dx * inv;
    const mdy = pointer.dy * inv;
    for (const note of notes) {
      const dx = note.x - pointer.x;
      const dy = note.y - pointer.y;
      const distSq = dx * dx + dy * dy;
      if (distSq >= RADIUS_SQ || distSq < 1) continue;
      const dist = Math.sqrt(distSq);
      const influence = (1 - dist / RADIUS) ** 2;
      const nx = dx / dist;
      const ny = dy / dist;
      const ahead = Math.max(0, nx * mdx + ny * mdy);
      const side = Math.sign(dx * pointer.dy - dy * pointer.dx) || 1;
      const kick = influence * Math.min(moved, 32);
      const slip = kick * (0.12 + ahead * 0.22);
      note.x += nx * slip + mdx * kick * 0.06;
      note.y += ny * slip + mdy * kick * 0.06;
      note.x += -ny * side * slip * 0.28;
      note.y += nx * side * slip * 0.28;
      note.vx += nx * slip * 0.08;
      note.vy += ny * slip * 0.08;
      note.va += side * slip * 0.0015;
      note.stir = Math.min(1, note.stir + influence * Math.min(moved / 14, 1));
    }
  }

  // Heavy damping and a direct ease home. No restoring spring, so a note
  // cannot overshoot and bounce back.
  const damp = Math.pow(0.72, frame);
  const ease = 1 - Math.pow(0.965, frame);
  for (const note of notes) {
    note.vx *= damp;
    note.vy *= damp;
    note.va *= damp;
    note.x += note.vx * frame;
    note.y += note.vy * frame;
    note.angle += note.va * frame;
    note.x += (note.homeX - note.x) * ease;
    note.y += (note.homeY - note.y) * ease;
    note.angle += (note.homeAngle - note.angle) * ease;
    const spin = note.angle - note.homeAngle;
    if (Math.abs(spin) > 0.35) {
      note.angle = note.homeAngle + Math.sign(spin) * 0.35;
      note.va = 0;
    }
    note.stir *= Math.pow(0.96, frame);

    const ox = note.x - note.homeX;
    const oy = note.y - note.homeY;
    const offset = Math.hypot(ox, oy);
    if (offset > MAX_OFFSET) {
      const scale = MAX_OFFSET / offset;
      note.x = note.homeX + ox * scale;
      note.y = note.homeY + oy * scale;
      const nx = ox / offset;
      const ny = oy / offset;
      const outward = note.vx * nx + note.vy * ny;
      if (outward > 0) {
        note.vx -= nx * outward;
        note.vy -= ny * outward;
      }
    }
  }
}

function fieldIsSettled(notes: Note[], pointerMoving: boolean): boolean {
  if (pointerMoving) return false;
  for (const note of notes) {
    if (note.stir > 0.015) return false;
    if (note.vx * note.vx + note.vy * note.vy > 0.02) return false;
    if (Math.abs(note.x - note.homeX) > 0.35) return false;
    if (Math.abs(note.y - note.homeY) > 0.35) return false;
  }
  return true;
}

function drawKind(ctx: CanvasRenderingContext2D, kind: NoteKind): void {
  ctx.beginPath();
  if (kind === "eighth") {
    ctx.arc(8, 18, 4, 0, Math.PI * 2);
    ctx.moveTo(12, 18);
    ctx.lineTo(12, 2);
    ctx.lineTo(19, 6);
  } else if (kind === "quarter") {
    ctx.arc(12, 18, 4, 0, Math.PI * 2);
    ctx.moveTo(16, 18);
    ctx.lineTo(16, 2);
  } else {
    ctx.moveTo(9, 18);
    ctx.lineTo(9, 5);
    ctx.lineTo(21, 3);
    ctx.lineTo(21, 16);
    if (kind === "beamedBar") {
      ctx.moveTo(9, 9);
      ctx.lineTo(21, 7);
    }
    ctx.moveTo(9, 18);
    ctx.arc(6, 18, 3, 0, Math.PI * 2);
    ctx.moveTo(21, 16);
    ctx.arc(18, 16, 3, 0, Math.PI * 2);
  }
  ctx.stroke();
}

function noteGlow(note: Note, pointer: FieldPointer): number {
  if (!pointer.inside) return note.stir;
  const dx = note.x - pointer.x;
  const dy = note.y - pointer.y;
  const distSq = dx * dx + dy * dy;
  if (distSq >= RADIUS_SQ) return note.stir;
  const proximity = (1 - Math.sqrt(distSq) / RADIUS) ** 2;
  return Math.min(1, note.stir + proximity * 0.5);
}

function mixRgb(rest: Rgb, hot: Rgb, t: number): string {
  const u = t < 0 ? 0 : t > 1 ? 1 : t;
  const r = (rest[0] + (hot[0] - rest[0]) * u) | 0;
  const g = (rest[1] + (hot[1] - rest[1]) * u) | 0;
  const b = (rest[2] + (hot[2] - rest[2]) * u) | 0;
  return `rgb(${r},${g},${b})`;
}

function clampByte(channel: number): number {
  return Math.round(Math.min(255, Math.max(0, channel)));
}

function linearToSrgbByte(channel: number): number {
  const v =
    channel <= 0.0031308
      ? 12.92 * channel
      : 1.055 * channel ** (1 / 2.4) - 0.055;
  return clampByte(v * 255);
}

/** OKLCH → sRGB. Hue must not be treated as a blue channel. */
function oklchToSrgb(lightness: number, chroma: number, hue: number): Rgb {
  const rad = (hue * Math.PI) / 180;
  const a = chroma * Math.cos(rad);
  const b = chroma * Math.sin(rad);
  const l_ = lightness + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = lightness - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = lightness - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;
  return [
    linearToSrgbByte(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    linearToSrgbByte(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    linearToSrgbByte(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

function oklchComponent(token: string): number | null {
  if (token === "none") return 0;
  const n = Number.parseFloat(token);
  return Number.isFinite(n) ? n : null;
}

function oklchLightness(token: string): number | null {
  if (token === "none") return 0;
  const n = Number.parseFloat(token);
  if (!Number.isFinite(n)) return null;
  return token.endsWith("%") ? n / 100 : n;
}

function channelByte(token: string, scale: "byte" | "unit"): number | null {
  const percent = token.endsWith("%");
  const n = Number.parseFloat(token);
  if (!Number.isFinite(n)) return null;
  if (percent) return clampByte((n / 100) * 255);
  if (scale === "unit") return clampByte(n * 255);
  return clampByte(n);
}

function coordTokens(fnBody: string): string[] {
  const [coords] = fnBody.split("/");
  return coords
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean);
}

/**
 * Computed theme colors are often `oklch(...)` from `color-mix(in oklch)`.
 * Reading those three numbers as RGB stores the hue in the blue channel.
 */
export function cssColorToRgb(value: string, fallback: Rgb): Rgb {
  const input = value.trim().toLowerCase();
  const open = input.indexOf("(");
  const close = input.lastIndexOf(")");
  if (input.startsWith("#")) {
    const hex = input.slice(1);
    const full =
      hex.length === 3
        ? hex
            .split("")
            .map((c) => c + c)
            .join("")
        : hex.length >= 6
          ? hex.slice(0, 6)
          : "";
    if (full.length !== 6 || /[^0-9a-f]/.test(full)) return fallback;
    const n = Number.parseInt(full, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  if (open < 0 || close < open) return fallback;
  const name = input.slice(0, open);
  const tokens = coordTokens(input.slice(open + 1, close));
  if (tokens.length < 3) return fallback;

  if (name === "oklch") {
    const lightnessToken = tokens[0] ?? "";
    const lightness = oklchLightness(lightnessToken);
    const chroma = oklchComponent(tokens[1] ?? "");
    const hue = oklchComponent(tokens[2] ?? "");
    if (lightness == null || chroma == null || hue == null) return fallback;
    return oklchToSrgb(lightness, chroma, hue);
  }

  const scale = name === "color" ? "unit" : "byte";
  const channels = name === "color" ? tokens.slice(1, 4) : tokens.slice(0, 3);
  if (name !== "rgb" && name !== "rgba" && name !== "color") return fallback;
  const rgb = channels.map((token) => channelByte(token, scale));
  if (rgb.some((channel) => channel == null)) return fallback;
  return [rgb[0]!, rgb[1]!, rgb[2]!];
}

/** Dark ink on a light page reads heavier than light ink at the same alpha. */
export function restingNoteAlpha(appearance: string | undefined): number {
  return appearance === "light" ? 0.07 : 0.1;
}

function readColors(el: HTMLElement): {
  rest: Rgb;
  hot: Rgb;
  restingAlpha: number;
} {
  const style = getComputedStyle(el);
  return {
    rest: cssColorToRgb(style.color, [168, 168, 176]),
    hot: cssColorToRgb(style.accentColor, [123, 140, 222]),
    restingAlpha: restingNoteAlpha(document.documentElement.dataset.appearance),
  };
}

function drawField(
  ctx: CanvasRenderingContext2D,
  notes: Note[],
  pointer: FieldPointer,
  width: number,
  height: number,
  dpr: number,
  colors: { rest: Rgb; hot: Rgb; restingAlpha: number },
): void {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = 2;

  for (const note of notes) {
    if (
      note.x < -40 ||
      note.y < -40 ||
      note.x > width + 40 ||
      note.y > height + 40
    ) {
      continue;
    }
    const glow = noteGlow(note, pointer);
    ctx.save();
    ctx.translate(note.x, note.y);
    ctx.rotate(note.angle);
    ctx.scale(note.scale, note.scale);
    ctx.translate(-12, -12);
    ctx.globalAlpha = colors.restingAlpha + glow * 0.62;
    ctx.strokeStyle = mixRgb(colors.rest, colors.hot, Math.min(1, glow * 1.15));
    drawKind(ctx, note.kind);
    ctx.restore();
  }
}

export function mountNotesField(
  canvas: HTMLCanvasElement,
  options: { reduceMotion: boolean },
): () => void {
  const host = canvas.parentElement;
  if (!host) return () => {};

  let notes: Note[] = [];
  let width = 0;
  let height = 0;
  let scale = 1;
  let raf = 0;
  let running = false;
  let last = 0;
  const pointer: FieldPointer = { x: 0, y: 0, dx: 0, dy: 0, inside: false };
  let hasLast = false;
  let lastX = 0;
  let lastY = 0;

  const ctx = canvas.getContext("2d");
  if (!ctx) return () => {};

  // ResizeObserver does not run when only devicePixelRatio changes, which is
  // what happens moving the window onto a retina display. Keep the bitmap and
  // the draw scale on the same value whenever either updates.
  const syncSurface = () => {
    const nextW = canvas.clientWidth;
    const nextH = canvas.clientHeight;
    if (nextW < 1 || nextH < 1) return;
    const backing = fieldBackingSize(
      nextW,
      nextH,
      window.devicePixelRatio || 1,
    );
    scale = backing.scale;
    if (canvas.width !== backing.width || canvas.height !== backing.height) {
      canvas.width = backing.width;
      canvas.height = backing.height;
    }
    if (Math.abs(nextW - width) > 1 || Math.abs(nextH - height) > 1) {
      width = nextW;
      height = nextH;
      notes = seedNotes(width, height);
    }
  };

  const paint = () => {
    syncSurface();
    if (width < 1 || height < 1) return;
    drawField(ctx, notes, pointer, width, height, scale, readColors(canvas));
  };

  const tick = (now: number) => {
    const dt = last === 0 ? 16 : Math.min(now - last, 48);
    last = now;
    const moving = pointer.dx * pointer.dx + pointer.dy * pointer.dy > 0.16;
    stepNotes(notes, pointer, dt);
    pointer.dx = 0;
    pointer.dy = 0;
    paint();
    if (fieldIsSettled(notes, moving)) {
      running = false;
      return;
    }
    raf = requestAnimationFrame(tick);
  };

  const wake = () => {
    if (options.reduceMotion || running) return;
    running = true;
    last = 0;
    raf = requestAnimationFrame(tick);
  };

  const onMove = (event: PointerEvent) => {
    if (options.reduceMotion) return;
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    if (hasLast) {
      const dx = x - lastX;
      const dy = y - lastY;
      if (Math.hypot(dx, dy) < 90) {
        pointer.dx += dx;
        pointer.dy += dy;
      }
    }
    lastX = x;
    lastY = y;
    hasLast = true;
    pointer.x = x;
    pointer.y = y;
    pointer.inside = true;
    wake();
  };

  const onLeave = () => {
    pointer.inside = false;
    hasLast = false;
    pointer.dx = 0;
    pointer.dy = 0;
    wake();
  };

  const observer = new ResizeObserver(() => paint());
  observer.observe(host);
  const stopScaleWatch = watchDeviceScale(paint);
  paint();

  if (!options.reduceMotion) {
    host.addEventListener("pointermove", onMove);
    host.addEventListener("pointerleave", onLeave);
  }

  return () => {
    cancelAnimationFrame(raf);
    observer.disconnect();
    stopScaleWatch();
    host.removeEventListener("pointermove", onMove);
    host.removeEventListener("pointerleave", onLeave);
  };
}

/** Fires when the window moves to a display with a different pixel density. */
function watchDeviceScale(onChange: () => void): () => void {
  let query = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
  const handle = () => {
    query.removeEventListener("change", handle);
    onChange();
    query = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    query.addEventListener("change", handle);
  };
  query.addEventListener("change", handle);
  return () => query.removeEventListener("change", handle);
}
