import { Vibrant } from "node-vibrant/browser";

const FALLBACK_PALETTE = [
  "#7c6af7",
  "#5a4fd4",
  "#9b8fff",
  "#3d3566",
  "#c4baff",
] as const;

const SWATCH_KEYS = [
  "Vibrant",
  "LightVibrant",
  "Muted",
  "DarkVibrant",
  "LightMuted",
] as const;

type SwatchLike = { hex: string } | null;

/**
 * A swatch may sit this far below the palette's median lightness.
 * Darker than that (usually DarkVibrant) paints as a black band when a
 * visualizer walks the list in order.
 */
const MIN_LIGHTNESS_OF_MEDIAN = 0.8;

type Rgb = { r: number; g: number; b: number };

function parseHex(hex: string): Rgb | null {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match?.[1]) return null;
  const n = Number.parseInt(match[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function hslOf(rgb: Rgb): { h: number; s: number; l: number } {
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return { h, s, l };
}

function hexFromHsl(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = l - c / 2;
  const channel = (v: number) =>
    Math.round(Math.min(1, Math.max(0, v + m)) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

/**
 * Raise swatches that are much darker than the rest of the palette.
 * Hue stays put, so a near-black accent becomes a visible shade of itself
 * instead of a hole in the gradient.
 */
export function normalizeVisualizerPalette(
  colors: readonly string[],
): string[] {
  const parsed = colors.map((hex) => ({ hex, rgb: parseHex(hex) }));
  const lightness = parsed.map((entry) =>
    entry.rgb ? hslOf(entry.rgb).l : null,
  );
  const known = lightness
    .filter((l): l is number => l != null)
    .sort((a, b) => a - b);
  if (known.length === 0) return [...colors];
  const median = known[Math.floor(known.length / 2)] ?? 0;
  const floor = median * MIN_LIGHTNESS_OF_MEDIAN;

  return parsed.map((entry, i) => {
    const l = lightness[i];
    if (!entry.rgb || l == null || l >= floor) return entry.hex;
    const { h, s } = hslOf(entry.rgb);
    return hexFromHsl(h, s, floor);
  });
}

function paletteToColors(palette: Record<string, SwatchLike>): string[] {
  const colors: string[] = [];
  for (const key of SWATCH_KEYS) {
    const swatch = palette[key];
    if (swatch) {
      colors.push(swatch.hex);
    }
  }
  return colors.length > 0
    ? normalizeVisualizerPalette(colors)
    : getDefaultPalette();
}

export async function extractPaletteFromImageUrl(
  imageUrl: string,
): Promise<string[]> {
  try {
    const palette = await Vibrant.from(imageUrl).getPalette();
    return paletteToColors(palette);
  } catch (err) {
    console.warn("Failed to extract palette from album art:", err);
    return getDefaultPalette();
  }
}

export function getDefaultPalette(): string[] {
  return normalizeVisualizerPalette(FALLBACK_PALETTE);
}
