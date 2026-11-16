import { Vibrant } from "node-vibrant/browser";

const FALLBACK_PALETTE = [
  "#96c836",
  "#c4e070",
  "#7ab01c",
  "#3f6410",
  "#e4ecb4",
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

function clampLightness(l: number, max = 0.92): number {
  return Math.min(max, Math.max(0.08, l));
}

/**
 * A five-swatch ramp built around a theme's accent: the accent, a lighter and a
 * slightly deeper shade, a dark one, and a pale tint. Null when the accent
 * isn't a `#rrggbb` colour.
 */
function paletteFromAccent(accent: string): string[] | null {
  const rgb = parseHex(accent);
  if (!rgb) return null;
  const { h, s, l } = hslOf(rgb);
  return [
    accent,
    hexFromHsl(h, s * 0.9, clampLightness(l + 0.15)),
    hexFromHsl(h, s, clampLightness(l - 0.08)),
    hexFromHsl(h, s, clampLightness(l * 0.55)),
    hexFromHsl(h, s * 0.6, clampLightness(l + 0.3)),
  ];
}

function paletteToColors(
  palette: Record<string, SwatchLike>,
  fallbackAccent?: string,
): string[] {
  const colors: string[] = [];
  for (const key of SWATCH_KEYS) {
    const swatch = palette[key];
    if (swatch) {
      colors.push(swatch.hex);
    }
  }
  return colors.length > 0
    ? normalizeVisualizerPalette(colors)
    : getDefaultPalette(fallbackAccent);
}

/** `fallbackAccent` colours the fallback palette when the art has no usable swatches. */
export async function extractPaletteFromImageUrl(
  imageUrl: string,
  fallbackAccent?: string,
): Promise<string[]> {
  try {
    const palette = await Vibrant.from(imageUrl).getPalette();
    return paletteToColors(palette, fallbackAccent);
  } catch (err) {
    console.warn("Failed to extract palette from album art:", err);
    return getDefaultPalette(fallbackAccent);
  }
}

/**
 * The palette used when there's no album art: shades of the theme's accent, or
 * Spiral green when no (usable) accent is given.
 */
export function getDefaultPalette(accent?: string): string[] {
  const derived = accent ? paletteFromAccent(accent) : null;
  return normalizeVisualizerPalette(derived ?? FALLBACK_PALETTE);
}

export interface CoverGradient {
  start: string;
  end: string;
}

/** Hue distance on the colour wheel, in degrees (0-180). */
function hueGap(a: number, b: number): number {
  const delta = Math.abs(a - b) % 360;
  return Math.min(delta, 360 - delta);
}

/** How much a swatch reads as a colour: saturated and away from black and white. */
function colorfulness(hsl: { s: number; l: number }): number {
  return hsl.s * (1 - Math.abs(2 * hsl.l - 1));
}

const COVER_START_LIGHTNESS = { min: 0.3, max: 0.44 } as const;
const COVER_END_LIGHTNESS = { min: 0.18, max: 0.29 } as const;

/**
 * Cover colors are a tint of the artwork, not the artwork's full punch, so
 * saturation is scaled down and capped. A vivid yellow or red still reads as
 * itself, just quieter.
 */
const COVER_SATURATION_SCALE = 0.85;
const COVER_MAX_SATURATION = 0.62;

function softenSaturation(saturation: number): number {
  return Math.min(COVER_MAX_SATURATION, saturation * COVER_SATURATION_SCALE);
}

function clampBetween(
  value: number,
  range: { min: number; max: number },
): number {
  return Math.min(range.max, Math.max(range.min, value));
}

/**
 * Two stops for a cover background, taken from a palette. Both stay dark enough
 * for white text and are softened rather than full strength: the start is the
 * palette's most colourful swatch, the end a deeper shade (of a different
 * swatch when one sits near it, else of the same colour). Falls back to shades
 * of Spiral green for an empty or unusable palette.
 */
export function coverGradientFromPalette(
  colors: readonly string[],
): CoverGradient {
  const swatches = colors
    .map((hex) => parseHex(hex))
    .filter((rgb): rgb is Rgb => rgb != null)
    .map(hslOf);
  const usable =
    swatches.length > 0
      ? swatches
      : getDefaultPalette().flatMap((hex) => {
          const rgb = parseHex(hex);
          return rgb ? [hslOf(rgb)] : [];
        });

  const ranked = [...usable].sort((a, b) => colorfulness(b) - colorfulness(a));
  const primary = ranked[0] ?? { h: 0, s: 0, l: 0.3 };
  // A neighbour hue gives the gradient some travel; skip near-identical swatches.
  const neighbour = ranked
    .slice(1)
    .find(
      (swatch) =>
        swatch.s > 0.15 &&
        hueGap(swatch.h, primary.h) >= 14 &&
        hueGap(swatch.h, primary.h) <= 90,
    );
  const endBase = neighbour ?? primary;

  return {
    start: hexFromHsl(
      primary.h,
      softenSaturation(primary.s),
      clampBetween(primary.l, COVER_START_LIGHTNESS),
    ),
    end: hexFromHsl(
      endBase.h,
      softenSaturation(endBase.s),
      clampBetween(endBase.l * 0.6, COVER_END_LIGHTNESS),
    ),
  };
}
