import * as AppIcons from "../../components/icons";
import { EXTRA_LIBRARY_ICONS } from "./extraIcons";
import iconTagsJson from "./iconTags.json";
import { normalizeIconTags, type IconTagTable } from "./iconTagTable";
import type { IconComponent, IconTag, SpiralIconDefinition } from "./types";
import { DEFAULT_LIBRARY_ICON_ID } from "./types";

/** Optional aliases → canonical registry id. */
const ICON_ALIASES: Record<string, string> = {
  mic: "microphone",
};

/**
 * Search / filter keywords per id, from `iconTags.json`. Ids missing from the
 * file still register with `[]`. Edit it by hand or through Developer → Icon
 * Lab (which writes the file and hot-applies the change).
 */
let iconTags: Readonly<IconTagTable> = iconTagsJson;

function exportNameToId(exportName: string): string | null {
  if (!exportName.startsWith("Icon") || exportName.length <= 4) return null;
  const rest = exportName.slice(4);
  return rest[0]!.toLowerCase() + rest.slice(1);
}

/** Plain function components, plus `forwardRef`/`memo` objects (Lucide icons). */
function isIconComponent(value: unknown): value is IconComponent {
  return (
    typeof value === "function" ||
    (typeof value === "object" && value !== null && "$$typeof" in value)
  );
}

function buildRegistry(): {
  list: SpiralIconDefinition[];
  byId: Map<string, SpiralIconDefinition>;
} {
  const byId = new Map<string, SpiralIconDefinition>();

  const register = (id: string, component: IconComponent) => {
    if (byId.has(id)) return;
    byId.set(id, {
      id,
      component,
      tags: iconTags[id] ?? [],
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

/**
 * The catalog, sorted by id. The array and its entries are replaced in place
 * when tags change (see `setLibraryIconTags`), so reads always see live tags.
 */
export const SPIRAL_ICONS: readonly SpiralIconDefinition[] = SPIRAL_ICON_LIST;

let libraryVersion = 0;
const libraryListeners = new Set<() => void>();

function notifyLibraryChanged() {
  libraryVersion += 1;
  for (const listener of [...libraryListeners]) listener();
}

/** Subscribe to tag changes (for `useSyncExternalStore`). */
export function subscribeIconLibrary(listener: () => void): () => void {
  libraryListeners.add(listener);
  return () => {
    libraryListeners.delete(listener);
  };
}

/** Bumps whenever any icon's tags change. */
export function getIconLibraryVersion(): number {
  return libraryVersion;
}

function replaceTags(index: number, tags: readonly IconTag[]): boolean {
  const current = SPIRAL_ICON_LIST[index]!;
  if (
    current.tags.length === tags.length &&
    current.tags.every((tag, i) => tag === tags[i])
  ) {
    return false;
  }
  const next = { ...current, tags };
  SPIRAL_ICON_LIST[index] = next;
  SPIRAL_ICON_BY_ID.set(next.id, next);
  return true;
}

/** Set one icon's tags in memory. Returns false for unknown ids. */
export function setLibraryIconTags(
  id: string,
  tags: readonly string[],
): boolean {
  const index = SPIRAL_ICON_LIST.findIndex((icon) => icon.id === id);
  if (index < 0) return false;
  if (replaceTags(index, normalizeIconTags(tags))) {
    iconTags = { ...iconTags, [id]: normalizeIconTags(tags) };
    notifyLibraryChanged();
  }
  return true;
}

/** Replace every icon's tags from a table (used when `iconTags.json` reloads). */
export function applyIconTagTable(table: Readonly<IconTagTable>): void {
  iconTags = table;
  let changed = false;
  SPIRAL_ICON_LIST.forEach((icon, index) => {
    if (replaceTags(index, normalizeIconTags(table[icon.id] ?? []))) {
      changed = true;
    }
  });
  if (changed) notifyLibraryChanged();
}

if (import.meta.hot) {
  import.meta.hot.accept("./iconTags.json", (mod) => {
    const table = (mod as { default?: IconTagTable } | undefined)?.default;
    if (table) applyIconTagTable(table);
  });
}

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
