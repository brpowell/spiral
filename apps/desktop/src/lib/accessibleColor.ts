/** Linear-light sRGB, each channel 0..1 (may stray slightly outside from oklch mixes). */
type Rgb = [number, number, number];
type Oklch = [number, number, number];

/** WCAG AA for normal-size text. */
export const MIN_TEXT_CONTRAST = 4.5;

function toLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function fromLinear(c: number): number {
  const v = Math.min(1, Math.max(0, c));
  return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
}

/** Parse `#rgb` / `#rrggbb`; null for anything else. */
function parseHex(hex: string): Rgb | null {
  let h = hex.trim();
  if (/^#[0-9a-f]{3}$/i.test(h)) {
    h = `#${[...h.slice(1)].map((c) => c + c).join("")}`;
  }
  const match = /^#([0-9a-f]{6})$/i.exec(h);
  if (!match) return null;
  const n = Number.parseInt(match[1]!, 16);
  return [
    toLinear(((n >> 16) & 255) / 255),
    toLinear(((n >> 8) & 255) / 255),
    toLinear((n & 255) / 255),
  ];
}

function toHex(rgb: Rgb): string {
  const byte = (c: number) =>
    Math.round(fromLinear(c) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${byte(rgb[0])}${byte(rgb[1])}${byte(rgb[2])}`;
}

function toOklch([r, g, b]: Rgb): Oklch {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [L, Math.hypot(a, bb), (Math.atan2(bb, a) * 180) / Math.PI];
}

function fromOklch([L, C, H]: Oklch): Rgb {
  const a = C * Math.cos((H * Math.PI) / 180);
  const b = C * Math.sin((H * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/**
 * Same result as CSS `color-mix(in oklch, a p%, b)`: `weight` of `a`, the rest
 * `b`, hue along the shorter arc, an achromatic side taking the other's hue.
 */
function mixOklch(a: Rgb, b: Rgb, weight: number): Rgb {
  const [l1, c1, h1] = toOklch(a);
  const [l2, c2, h2] = toOklch(b);
  let hueA = h1;
  let hueB = h2;
  if (c1 < 1e-4) hueA = hueB;
  if (c2 < 1e-4) hueB = hueA;
  let delta = hueB - hueA;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  return fromOklch([
    l1 * weight + l2 * (1 - weight),
    c1 * weight + c2 * (1 - weight),
    hueA + delta * (1 - weight),
  ]);
}

function luminance([r, g, b]: Rgb): number {
  const clamp = (c: number) => Math.min(1, Math.max(0, c));
  return 0.2126 * clamp(r) + 0.7152 * clamp(g) + 0.0722 * clamp(b);
}

function contrastRatio(a: Rgb, b: Rgb): number {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** Mirrors `--color-surface-raised` in theme.css: ink 11% over the page. */
const SURFACE_RAISED_INK_WEIGHT = 0.11;
/** Mirrors `--color-text-muted` in theme.css: ink 45% over the page. */
const MUTED_INK_WEIGHT = 0.45;

/** The raised card surface (`--color-surface-raised`) as hex, or null if unparsable. */
export function raisedSurfaceHex(bg: string, ink: string): string | null {
  const bgRgb = parseHex(bg);
  const inkRgb = parseHex(ink);
  if (!bgRgb || !inkRgb) return null;
  return toHex(mixOklch(inkRgb, bgRgb, SURFACE_RAISED_INK_WEIGHT));
}

/**
 * Muted text color that stays at least `minRatio` against the raised surface.
 *
 * Starts at the stock muted mix and adds ink until it passes, so themes that
 * already clear the bar keep their look. Returns null when either color is not
 * a hex value, leaving the CSS fallback in charge.
 */
export function accessibleMutedOnRaised(
  bg: string,
  ink: string,
  minRatio: number = MIN_TEXT_CONTRAST,
): string | null {
  const bgRgb = parseHex(bg);
  const inkRgb = parseHex(ink);
  if (!bgRgb || !inkRgb) return null;

  const surface = mixOklch(inkRgb, bgRgb, SURFACE_RAISED_INK_WEIGHT);
  for (let weight = MUTED_INK_WEIGHT; weight < 1; weight += 0.01) {
    const candidate = mixOklch(inkRgb, bgRgb, weight);
    if (contrastRatio(candidate, surface) >= minRatio) {
      return toHex(candidate);
    }
  }
  return toHex(inkRgb);
}

/** Contrast of `fg` over `bg` hex colors, or null if unparsable. */
export function hexContrastRatio(fg: string, bg: string): number | null {
  const a = parseHex(fg);
  const b = parseHex(bg);
  return a && b ? contrastRatio(a, b) : null;
}
