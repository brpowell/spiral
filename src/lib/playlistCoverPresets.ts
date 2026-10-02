import { DEFAULT_LIBRARY_ICON_ID } from "./iconLibrary";

export const DEFAULT_PLAYLIST_COVER_COLOR = "#4f46e5";
export const DEFAULT_PLAYLIST_COVER_GRADIENT_END = "#312e81";

export type PlaylistDesignCover = {
  coverBackground: string;
  coverBackgroundEnd: string | null;
  coverIcon: string;
};

export function defaultPlaylistDesignCover(): PlaylistDesignCover {
  return {
    coverBackground: DEFAULT_PLAYLIST_COVER_COLOR,
    coverBackgroundEnd: null,
    coverIcon: DEFAULT_LIBRARY_ICON_ID,
  };
}

function randomUnit(): number {
  return Math.random();
}

function sample(min: number, max: number): number {
  return min + randomUnit() * (max - min);
}

/** Shortest distance around the hue wheel, in degrees. */
function hueDistance(a: number, b: number): number {
  const delta = Math.abs(a - b) % 360;
  return Math.min(delta, 360 - delta);
}

function hexToHue(hex: string | null | undefined): number | null {
  const match = /^#([0-9a-f]{6})$/i.exec(hex?.trim() ?? "");
  if (!match) return null;
  const n = Number.parseInt(match[1], 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (delta < 0.04) return null;
  let hue: number;
  if (max === r) hue = ((g - b) / delta) % 6;
  else if (max === g) hue = (b - r) / delta + 2;
  else hue = (r - g) / delta + 4;
  return (hue * 60 + 360) % 360;
}

/** HSL (s and l in 0–1) to `#rrggbb`. Lightness stays low enough for a white icon. */
function hslToHex(hue: number, saturation: number, lightness: number): string {
  const a = saturation * Math.min(lightness, 1 - lightness);
  const channel = (n: number) => {
    const k = (n + hue / 30) % 12;
    const value = lightness - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * value)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

type CoverMood = "vivid" | "deep" | "muted" | "bright";

function pickMood(): CoverMood {
  const roll = randomUnit();
  if (roll < 0.28) return "vivid";
  if (roll < 0.52) return "deep";
  if (roll < 0.76) return "muted";
  return "bright";
}

/** Saturation and lightness bands. Bright stays saturated so the white icon holds. */
function colorInMood(hue: number, mood: CoverMood): string {
  switch (mood) {
    case "vivid":
      return hslToHex(hue, sample(0.7, 0.96), sample(0.3, 0.5));
    case "deep":
      return hslToHex(hue, sample(0.4, 0.88), sample(0.14, 0.3));
    case "muted":
      return hslToHex(hue, sample(0.18, 0.46), sample(0.22, 0.44));
    case "bright":
      return hslToHex(hue, sample(0.62, 0.94), sample(0.46, 0.58));
  }
}

function pickHue(avoidHues: number[]): number {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const hue = randomUnit() * 360;
    if (avoidHues.every((other) => hueDistance(hue, other) >= 42)) return hue;
  }
  return randomUnit() * 360;
}

/**
 * Hue offset for the second gradient stop.
 * Mixes near, wide, complementary, and same-hue (lightness-only) pairs.
 */
function pickGradientShift(): number {
  const roll = randomUnit();
  const magnitude =
    roll < 0.22
      ? 0
      : roll < 0.5
        ? sample(32, 78)
        : roll < 0.75
          ? sample(95, 140)
          : sample(155, 200);
  return randomUnit() < 0.5 ? -magnitude : magnitude;
}

/**
 * New cover colors. A solid stays a single color; a gradient gets a new pair.
 * `current` hues are skipped so a repeat click does not land beside the last pick.
 * Does not choose an icon.
 */
export function randomPlaylistCoverColors(
  gradient: boolean,
  current?: {
    background?: string | null;
    backgroundEnd?: string | null;
  },
): {
  coverBackground: string;
  coverBackgroundEnd: string | null;
} {
  const avoidHues = [current?.background, current?.backgroundEnd]
    .map(hexToHue)
    .filter((hue): hue is number => hue != null);
  const hue = pickHue(avoidHues);

  if (!gradient) {
    return {
      coverBackground: colorInMood(hue, pickMood()),
      coverBackgroundEnd: null,
    };
  }

  const shift = pickGradientShift();
  let start = colorInMood(hue, pickMood());
  let end = colorInMood((hue + shift + 360) % 360, pickMood());
  if (randomUnit() < 0.5) {
    [start, end] = [end, start];
  }
  return {
    coverBackground: start,
    coverBackgroundEnd: end,
  };
}

/** CSS background for a designed cover (solid or 135° gradient). */
export function playlistDesignBackgroundStyle(
  background: string,
  backgroundEnd: string | null | undefined,
): { background: string } {
  const start = background.trim() || DEFAULT_PLAYLIST_COVER_COLOR;
  const end = backgroundEnd?.trim();
  if (!end) {
    return { background: start };
  }
  return {
    background: `linear-gradient(135deg, ${start}, ${end})`,
  };
}
