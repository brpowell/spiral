import {
  getTrackListPreferences as fetchTrackListPreferences,
  saveTrackListPreferences as persistTrackListPreferences,
} from "../../lib/tauri";
import type { TrackListColumnId } from "./types";
import { defaultHiddenColumns } from "./types";

const LEGACY_STORAGE_KEY = "spiral-track-list-preferences";

export interface TrackListPreferences {
  columnWidths: Partial<Record<TrackListColumnId, number>>;
  hiddenColumns: TrackListColumnId[];
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
]);

export function defaultTrackListPreferences(): TrackListPreferences {
  return {
    columnWidths: {},
    hiddenColumns: defaultHiddenColumns("library"),
  };
}

function defaultPreferences(): TrackListPreferences {
  return defaultTrackListPreferences();
}

function normalizePreferences(
  raw: Partial<TrackListPreferences> | null | undefined,
): TrackListPreferences {
  const defaults = defaultPreferences();
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

  return { columnWidths, hiddenColumns };
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
        fromDisk.hiddenColumns.length > 0;

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

    cached = defaultPreferences();
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
  presetId: import("./types").TrackListPresetId,
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
  Record<import("./types").TrackListPresetId, TrackListColumnId[]>
> = {
  library: [
    "artist",
    "album",
    "albumArtist",
    "year",
    "genre",
    "discNumber",
  ],
};
