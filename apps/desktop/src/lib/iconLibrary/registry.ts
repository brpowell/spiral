import * as AppIcons from "../../components/icons";
import { EXTRA_LIBRARY_ICONS } from "./extraIcons";
import type { IconComponent, IconTag, SpiralIconDefinition } from "./types";
import { DEFAULT_LIBRARY_ICON_ID } from "./types";

/** Optional aliases → canonical registry id. */
const ICON_ALIASES: Record<string, string> = {
  mic: "microphone",
};

/**
 * Search / filter keywords per id. Missing ids still register with `[]`.
 * Keep tags lowercase freeform words.
 */
const ICON_TAGS: Record<string, readonly IconTag[]> = {
  previous: ["playback", "transport"],
  next: ["playback", "transport"],
  shuffle: ["playback", "transport", "music", "cover"],
  setList: ["playback", "playlist", "queue"],
  columns: ["layout", "ui"],
  hide: ["ui", "visibility"],
  repeat: ["playback", "transport", "music"],
  repeatOne: ["playback", "transport", "music"],
  play: ["playback", "transport", "music"],
  pause: ["playback", "transport", "music"],
  volume: ["playback", "audio"],
  volumeMute: ["playback", "audio"],
  back: ["navigation", "ui"],
  search: ["ui", "find"],
  tracks: ["library", "music", "cover"],
  albums: ["library", "music", "cover"],
  image: ["media", "image", "file"],
  artists: ["library", "music"],
  disc: ["music", "cd", "media", "cover"],
  eject: ["cd", "media"],
  playlists: ["library", "playlist", "music", "cover"],
  playlistAdd: ["playlist", "music"],
  removeFromPlaylist: ["playlist", "music"],
  pencil: ["edit", "ui"],
  info: ["ui", "help"],
  star: ["rating", "favorite", "cover"],
  replace: ["edit", "ui"],
  import: ["library", "file"],
  openFolder: ["file", "folder"],
  folderLink: ["file", "folder", "link"],
  unlink: ["link", "ui"],
  refresh: ["ui", "sync"],
  package: ["packs", "appearance"],
  packagePlus: ["packs", "appearance"],
  visualizer: ["playback", "visualizer", "audio", "cover"],
  audioWaveform: ["playback", "visualizer", "audio", "cover"],
  palette: ["appearance", "theme", "cover"],
  idCard: ["account", "license"],
  chevronLeft: ["navigation", "ui"],
  chevronRight: ["navigation", "ui"],
  chevronDown: ["navigation", "ui"],
  check: ["ui", "confirm"],
  copy: ["edit", "ui"],
  convert: ["audio", "file"],
  reset: ["ui", "edit"],
  close: ["ui", "window"],
  windowMinimize: ["window"],
  windowMaximize: ["window"],
  windowRestore: ["window"],
  more: ["ui", "menu"],
  help: ["ui", "help"],
  warning: ["ui", "alert"],
  missingFile: ["file", "error"],
  addToQueue: ["queue", "playback", "music"],
  removeFromQueue: ["queue", "playback", "music"],
  delete: ["edit", "ui"],
  grip: ["ui", "drag"],
  artistPlaceholder: ["library", "artist", "placeholder"],
  popOut: ["window", "ui"],
  skinMode: ["appearance", "skin"],
  maximize: ["window"],
  minimize: ["window"],
  alwaysOnTop: ["window"],
  clock: ["time"],
  microphone: ["music", "audio", "record", "cover"],
  cancel: ["ui"],
  fileMusic: ["music", "file", "cover"],
  bitrate: ["audio", "file"],
  hardDrive: ["storage", "file"],
  calendarPlus: ["time"],
  glasses: ["ui"],
  link: ["link", "ui"],
  externalLink: ["link", "ui"],
  gpu: ["performance"],
  download: ["network", "file"],
  errorAlert: ["ui", "alert", "error"],
  warningAlert: ["ui", "alert"],
  undoClock: ["time", "ui"],
  disconnected: ["network", "error"],
  // Extra (cover / mood) glyphs
  boombox: ["music", "audio", "cover"],
  disc2: ["music", "cd", "media", "cover"],
  cassette: ["music", "audio", "cover"],
  note: ["music", "cover"],
  notes: ["music", "cover"],
  headphones: ["music", "audio", "cover"],
  heart: ["favorite", "mood", "cover"],
  bolt: ["mood", "energy", "cover"],
  flame: ["mood", "energy", "cover"],
  moon: ["mood", "night", "cover"],
  sun: ["mood", "day", "cover"],
  sparkles: ["mood", "cover"],
  coffee: ["mood", "cover"],
  car: ["mood", "travel", "cover"],
  book: ["mood", "cover"],
  globe: ["mood", "travel", "cover"],
};

function exportNameToId(exportName: string): string | null {
  if (!exportName.startsWith("Icon") || exportName.length <= 4) return null;
  const rest = exportName.slice(4);
  return rest[0]!.toLowerCase() + rest.slice(1);
}

function isIconComponent(value: unknown): value is IconComponent {
  return typeof value === "function";
}

function buildRegistry(): {
  list: readonly SpiralIconDefinition[];
  byId: Map<string, SpiralIconDefinition>;
} {
  const byId = new Map<string, SpiralIconDefinition>();

  const register = (id: string, component: IconComponent) => {
    if (byId.has(id)) return;
    byId.set(id, {
      id,
      component,
      tags: ICON_TAGS[id] ?? [],
    });
  };

  for (const [exportName, value] of Object.entries(AppIcons)) {
    if (!isIconComponent(value)) continue;
    const id = exportNameToId(exportName);
    if (!id) continue;
    register(id, value);
  }

  for (const [id, component] of Object.entries(EXTRA_LIBRARY_ICONS)) {
    register(id, component);
  }

  const list = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
  return { list, byId };
}

const { list: SPIRAL_ICON_LIST, byId: SPIRAL_ICON_BY_ID } = buildRegistry();

export const SPIRAL_ICONS: readonly SpiralIconDefinition[] = SPIRAL_ICON_LIST;

export function listLibraryIcons(): readonly SpiralIconDefinition[] {
  return SPIRAL_ICONS;
}

export function getLibraryIcon(id: string): SpiralIconDefinition | undefined {
  const canonical = ICON_ALIASES[id] ?? id;
  return SPIRAL_ICON_BY_ID.get(canonical);
}

export function resolveIcon(id: string): IconComponent | undefined {
  return getLibraryIcon(id)?.component;
}

/** Resolve an id, falling back to the default library icon. */
export function resolveIconId(id: string | null | undefined): string {
  if (id) {
    const canonical = ICON_ALIASES[id] ?? id;
    if (SPIRAL_ICON_BY_ID.has(canonical)) return canonical;
  }
  return DEFAULT_LIBRARY_ICON_ID;
}

export function libraryIconHasTag(
  icon: SpiralIconDefinition,
  tag: string,
): boolean {
  const needle = tag.trim().toLowerCase();
  if (!needle) return true;
  return icon.tags.some((t) => t.toLowerCase() === needle);
}

/**
 * Filter icons by free-text query against id and tags.
 * Empty query returns the full catalog.
 */
export function searchLibraryIcons(query: string): SpiralIconDefinition[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...SPIRAL_ICONS];
  return SPIRAL_ICONS.filter((icon) => {
    if (icon.id.toLowerCase().includes(q)) return true;
    return icon.tags.some((tag) => tag.toLowerCase().includes(q));
  });
}

export function iconsWithTag(tag: string): SpiralIconDefinition[] {
  return SPIRAL_ICONS.filter((icon) => libraryIconHasTag(icon, tag));
}

/**
 * Sort icons so those with `tag` come first (alphabetical within each group).
 * Does not filter — the full catalog is returned.
 */
export function sortLibraryIconsByTag(
  tag: string,
  icons: readonly SpiralIconDefinition[] = SPIRAL_ICONS,
): SpiralIconDefinition[] {
  const needle = tag.trim().toLowerCase();
  if (!needle) return [...icons].sort((a, b) => a.id.localeCompare(b.id));

  const matched: SpiralIconDefinition[] = [];
  const rest: SpiralIconDefinition[] = [];
  for (const icon of icons) {
    if (libraryIconHasTag(icon, needle)) matched.push(icon);
    else rest.push(icon);
  }
  matched.sort((a, b) => a.id.localeCompare(b.id));
  rest.sort((a, b) => a.id.localeCompare(b.id));
  return [...matched, ...rest];
}

/** Human-readable label from an id (`setList` → `Set List`). */
export function humanizeIconId(id: string): string {
  const spaced = id
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .trim();
  if (!spaced) return id;
  return spaced.replace(/\b\w/g, (c) => c.toUpperCase());
}

export { DEFAULT_LIBRARY_ICON_ID };
