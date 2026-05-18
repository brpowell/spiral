import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  defaultTrackListPreferences,
  getCachedTrackListPreferences,
  loadTrackListPreferences,
  saveTrackListPreferences,
  hiddenColumnsForPreset,
  type TrackListPreferences,
} from "./trackListPreferences";
import {
  DEFAULT_COLUMN_WIDTHS,
  MIN_COLUMN_WIDTHS,
  TRACK_LIST_PRESETS,
  type TrackListColumnDef,
  type TrackListColumnId,
  type TrackListPresetId,
} from "./types";

const ACTIONS_COLUMN_WIDTH_PX = 36;

function buildGridTemplate(
  columns: TrackListColumnDef[],
  widths: Partial<Record<TrackListColumnId, number>>,
): string {
  const parts = columns.map((col) => {
    const w = widths[col.id] ?? DEFAULT_COLUMN_WIDTHS[col.id] ?? 80;
    return `${w}px`;
  });
  parts.push("minmax(0, 1fr)");
  parts.push("2.25rem");
  return parts.join(" ");
}

export function computeMinTableWidth(
  columns: TrackListColumnDef[],
  widths: Partial<Record<TrackListColumnId, number>>,
): number {
  return (
    columns.reduce((sum, col) => {
      const w = widths[col.id] ?? DEFAULT_COLUMN_WIDTHS[col.id] ?? 80;
      return sum + w;
    }, 0) + ACTIONS_COLUMN_WIDTH_PX
  );
}

function initialPreferences(): TrackListPreferences {
  return getCachedTrackListPreferences() ?? defaultTrackListPreferences();
}

export function useTrackListColumns(presetId: TrackListPresetId) {
  const preset = TRACK_LIST_PRESETS[presetId];
  const [prefs, setPrefs] = useState<TrackListPreferences>(initialPreferences);
  const [loaded, setLoaded] = useState(() => getCachedTrackListPreferences() != null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSaveRef = useRef<TrackListPreferences | null>(null);

  const flushSave = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const pending = pendingSaveRef.current;
    if (!pending) return;
    pendingSaveRef.current = null;
    void saveTrackListPreferences(pending);
  }, []);

  const scheduleSave = useCallback((next: TrackListPreferences) => {
    pendingSaveRef.current = next;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      const pending = pendingSaveRef.current;
      if (!pending) return;
      pendingSaveRef.current = null;
      void saveTrackListPreferences(pending);
    }, 250);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadTrackListPreferences().then((loadedPrefs) => {
      if (cancelled) return;
      setPrefs(loadedPrefs);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
      flushSave();
    };
  }, [flushSave]);

  const hiddenSet = useMemo(
    () => hiddenColumnsForPreset(presetId, prefs),
    [presetId, prefs],
  );

  const visibleColumns = useMemo(
    () => preset.columns.filter((col) => !hiddenSet.has(col.id)),
    [preset.columns, hiddenSet],
  );

  const hideableColumns = useMemo(
    () => preset.columns.filter((col) => col.hideable),
    [preset.columns],
  );

  const gridTemplateColumns = useMemo(
    () => buildGridTemplate(visibleColumns, prefs.columnWidths),
    [visibleColumns, prefs.columnWidths],
  );

  const minTableWidth = useMemo(
    () => computeMinTableWidth(visibleColumns, prefs.columnWidths),
    [visibleColumns, prefs.columnWidths],
  );

  const setColumnWidth = useCallback(
    (columnId: TrackListColumnId, width: number) => {
      const min = MIN_COLUMN_WIDTHS[columnId] ?? 48;
      const clamped = Math.max(min, Math.round(width));
      setPrefs((prev) => {
        const next = {
          ...prev,
          columnWidths: { ...prev.columnWidths, [columnId]: clamped },
        };
        scheduleSave(next);
        return next;
      });
    },
    [scheduleSave],
  );

  const toggleColumnVisibility = useCallback(
    (columnId: TrackListColumnId) => {
      setPrefs((prev) => {
        const hidden = new Set(prev.hiddenColumns);
        if (hidden.has(columnId)) {
          hidden.delete(columnId);
        } else {
          hidden.add(columnId);
        }
        const next = { ...prev, hiddenColumns: [...hidden] };
        pendingSaveRef.current = null;
        if (saveTimerRef.current) {
          clearTimeout(saveTimerRef.current);
          saveTimerRef.current = null;
        }
        void saveTrackListPreferences(next);
        return next;
      });
    },
    [],
  );

  const isColumnVisible = useCallback(
    (columnId: TrackListColumnId) => !hiddenSet.has(columnId),
    [hiddenSet],
  );

  return {
    preset,
    visibleColumns,
    hideableColumns,
    gridTemplateColumns,
    minTableWidth,
    columnWidths: prefs.columnWidths,
    setColumnWidth,
    toggleColumnVisibility,
    isColumnVisible,
    flushSave,
    loaded,
  };
}
