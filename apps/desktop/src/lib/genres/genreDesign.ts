import {
  hslToHex,
  playlistDesignBackgroundStyle,
} from "@/lib/playlists/playlistCoverPresets";
import { resolveIconId } from "@/lib/iconLibrary";

/** How a genre is drawn: a solid or gradient background with an icon. */
export interface GenreDesign {
  background: string;
  backgroundEnd: string | null;
  icon: string;
}

export type GenreDesigns = Record<string, GenreDesign>;

const STORAGE_KEY = "spiral:genreDesigns";

/** Music-flavoured icons the generated look picks from. */
const DEFAULT_ICON_IDS = [
  "note",
  "notes",
  "guitar",
  "headphones",
  "boombox",
  "microphone",
  "disc",
  "disc2",
  "cassette",
  "audioWaveform",
  "fileMusic",
  "visualizer",
  "albums",
];

/** FNV-1a: a small, stable string hash. */
function hashKey(key: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/**
 * The look a genre has until it is customized: a gradient and icon derived
 * from its key, so the same genre always gets the same art.
 */
export function defaultDesignForGenre(key: string): GenreDesign {
  const hash = hashKey(key);
  const hue = hash % 360;
  const shift = 28 + ((hash >>> 9) % 40);
  return {
    background: hslToHex(hue, 0.62, 0.42),
    backgroundEnd: hslToHex((hue + shift) % 360, 0.58, 0.27),
    icon: resolveIconId(
      DEFAULT_ICON_IDS[(hash >>> 17) % DEFAULT_ICON_IDS.length],
    ),
  };
}

export function genreDesignsEqual(
  a: GenreDesign | null | undefined,
  b: GenreDesign | null | undefined,
): boolean {
  if (!a || !b) return !a && !b;
  return (
    a.background === b.background &&
    a.backgroundEnd === b.backgroundEnd &&
    a.icon === b.icon
  );
}

export function genreDesignStyle(design: GenreDesign): { background: string } {
  return playlistDesignBackgroundStyle(design.background, design.backgroundEnd);
}

function parseDesign(value: unknown): GenreDesign | null {
  if (value == null || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.background !== "string" || raw.background.trim() === "") {
    return null;
  }
  return {
    background: raw.background,
    backgroundEnd:
      typeof raw.backgroundEnd === "string" && raw.backgroundEnd.trim() !== ""
        ? raw.backgroundEnd
        : null,
    icon: resolveIconId(typeof raw.icon === "string" ? raw.icon : null),
  };
}

export function loadGenreDesigns(): GenreDesigns {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (parsed == null || typeof parsed !== "object") return {};
    const designs: GenreDesigns = {};
    for (const [key, value] of Object.entries(parsed)) {
      const design = parseDesign(value);
      if (design) designs[key] = design;
    }
    return designs;
  } catch {
    return {};
  }
}

export function saveGenreDesigns(designs: GenreDesigns): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(designs));
  } catch {
    /* ignore quota / private mode */
  }
}

/**
 * Designs after a genre key changes. The destination keeps its own design when
 * it has one (a merge); otherwise it adopts the source's. The source is dropped.
 */
export function designsAfterRename(
  designs: GenreDesigns,
  oldKey: string,
  newKey: string,
): GenreDesigns {
  if (oldKey === newKey || !(oldKey in designs)) return designs;
  const { [oldKey]: moved, ...rest } = designs;
  return newKey in rest ? rest : { ...rest, [newKey]: moved };
}
