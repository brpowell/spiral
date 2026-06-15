import {
  getTrackListPreferences as fetchTrackListPreferences,
  saveTrackListPreferences as persistTrackListPreferences,
} from "../../lib/tauri";
import type { TrackListColumnDef, TrackListColumnId, TrackListPresetId } from "./types";
import { defaultHiddenColumns, TRACK_LIST_PRESETS } from "./types";

const LEGACY_STORAGE_KEY = "spiral-track-list-preferences";

export interface TrackListPreferences {
  columnWidths: Partial<Record<TrackListColumnId, number>>;
  hiddenColumns: TrackListColumnId[];
  columnOrderByPreset: Partial<Record<TrackListPresetId, TrackListColumnId[]>>;
}

const VALID_COLUMN_IDS = new Set<TrackListColumnId>([
  "index",
  "trackNumber",
  "title",
  "artist",
  "album",
  "albumArtist",
  "duration",
  "year",
  "genre",
  "discNumber",
  "dateAdded",
  "playCount",
]);

export function defaultTrackListPreferences(): TrackListPreferences {
  return {
    columnWidths: {},
    hiddenColumns: defaultHiddenColumns("library"),
    columnOrderByPreset: {},
  };
}

function normalizePreferences(
  raw: Partial<TrackListPreferences> | null | undefined,
): TrackListPreferences {
  const defaults = defaultTrackListPreferences();
  if (!raw) return defaults;

  const columnWidths: Partial<Record<TrackListColumnId, number>> = {};
  if (raw.columnWidths) {
    for (const [key, value] of Object.entries(raw.columnWidths)) {
      if (
        VALID_COLUMN_IDS.has(key as TrackListColumnId) &&
        typeof value === "number" &&
        Number.isFinite(value)
      ) {
        columnWidths[key as TrackListColumnId] = Math.round(value);
      }
    }
  }

  const hiddenColumns = Array.isArray(raw.hiddenColumns)
    ? raw.hiddenColumns.filter((id): id is TrackListColumnId =>
        VALID_COLUMN_IDS.has(id as TrackListColumnId),
      )
    : defaults.hiddenColumns;

  const columnOrderByPreset: Partial<
    Record<TrackListPresetId, TrackListColumnId[]>
  > = {};
  const orderRaw = raw.columnOrderByPreset;
  if (orderRaw && typeof orderRaw === "object") {
    for (const [presetKey, ids] of Object.entries(orderRaw)) {
      if (!Array.isArray(ids)) continue;
      const preset = presetKey as TrackListPresetId;
      if (!(preset in TRACK_LIST_PRESETS)) continue;
      const validIds = new Set(TRACK_LIST_PRESETS[preset].columns.map((c) => c.id));
      const filtered = ids.filter(
        (id): id is TrackListColumnId =>
          VALID_COLUMN_IDS.has(id as TrackListColumnId) && validIds.has(id),
      );
      if (filtered.length > 0) {
        columnOrderByPreset[preset] = filtered;
      }
    }
  }

  return { columnWidths, hiddenColumns, columnOrderByPreset };
}

export function columnIdsForPreset(
  presetId: TrackListPresetId,
  prefs: TrackListPreferences,
): TrackListColumnId[] {
  const preset = TRACK_LIST_PRESETS[presetId];
  const saved = prefs.columnOrderByPreset[presetId];
  if (!saved?.length) return preset.columns.map((col) => col.id);

  const presetIds = preset.columns.map((col) => col.id);
  const presetIdSet = new Set(presetIds);
  const result: TrackListColumnId[] = [];
  const seen = new Set<TrackListColumnId>();

  for (const id of saved) {
    if (presetIdSet.has(id) && !seen.has(id)) {
      result.push(id);
      seen.add(id);
    }
  }
  for (const id of presetIds) {
    if (!seen.has(id)) {
      result.push(id);
      seen.add(id);
    }
  }
  return result;
}

export function columnsForPreset(
  presetId: TrackListPresetId,
  prefs: TrackListPreferences,
): TrackListColumnDef[] {
  const preset = TRACK_LIST_PRESETS[presetId];
  const columnById = new Map(preset.columns.map((col) => [col.id, col]));
  return columnIdsForPreset(presetId, prefs).flatMap((id) => {
    const col = columnById.get(id);
    return col ? [col] : [];
  });
}

export function reorderColumnIds(
  order: TrackListColumnId[],
  fromId: TrackListColumnId,
  toId: TrackListColumnId,
  lockedId: TrackListColumnId,
): TrackListColumnId[] {
  if (fromId === lockedId || toId === lockedId) return order;
  const fromIndex = order.indexOf(fromId);
  const toIndex = order.indexOf(toId);
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return order;

  const next = [...order];
  next.splice(fromIndex, 1);
  next.splice(toIndex, 0, fromId);

  const lockedIndex = next.indexOf(lockedId);
  if (lockedIndex > 0) {
    next.splice(lockedIndex, 1);
    next.unshift(lockedId);
  }
  return next;
}

function readLegacyLocalStorage(): TrackListPreferences | null {
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return null;
    return normalizePreferences(JSON.parse(raw) as Partial<TrackListPreferences>);
  } catch {
    return null;
  }
}

function clearLegacyLocalStorage(): void {
  try {
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    // ignore
  }
}

let cached: TrackListPreferences | null = null;
let loadPromise: Promise<TrackListPreferences> | null = null;

export function getCachedTrackListPreferences(): TrackListPreferences | null {
  return cached;
}

export function loadTrackListPreferences(): Promise<TrackListPreferences> {
  if (cached) return Promise.resolve(cached);
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    try {
      const fromDisk = normalizePreferences(
        await fetchTrackListPreferences() as Partial<TrackListPreferences>,
      );
      const hasDiskData =
        Object.keys(fromDisk.columnWidths).length > 0 ||
        fromDisk.hiddenColumns.length > 0 ||
        Object.keys(fromDisk.columnOrderByPreset).length > 0;

      if (hasDiskData) {
        cached = fromDisk;
        return fromDisk;
      }
    } catch (err) {
      console.error("Failed to load track list preferences:", err);
    }

    const legacy = readLegacyLocalStorage();
    if (legacy) {
      cached = legacy;
      try {
        await persistTrackListPreferences(legacy);
        clearLegacyLocalStorage();
      } catch (err) {
        console.error("Failed to migrate track list preferences:", err);
      }
      return legacy;
    }

    cached = defaultTrackListPreferences();
    return cached;
  })().finally(() => {
    loadPromise = null;
  });

  return loadPromise;
}

export async function saveTrackListPreferences(
  prefs: TrackListPreferences,
): Promise<void> {
  const normalized = normalizePreferences(prefs);
  cached = normalized;
  try {
    await persistTrackListPreferences(normalized);
  } catch (err) {
    console.error("Failed to save track list preferences:", err);
  }
}

export function hiddenColumnsForPreset(
  presetId: TrackListPresetId,
  prefs: TrackListPreferences,
): Set<TrackListColumnId> {
  const hideable = new Set(
    TRACK_LIST_HIDEABLE_BY_PRESET[presetId] ?? [],
  );
  const hidden = new Set<TrackListColumnId>();
  for (const id of prefs.hiddenColumns) {
    if (hideable.has(id)) hidden.add(id);
  }
  return hidden;
}

const TRACK_LIST_HIDEABLE_BY_PRESET: Partial<
  Record<TrackListPresetId, TrackListColumnId[]>
> = {
  library: [
    "artist",
    "album",
    "albumArtist",
    "year",
    "genre",
    "discNumber",
    "trackNumber",
    "dateAdded",
    "playCount",
  ],
  cd: ["artist"],
};
