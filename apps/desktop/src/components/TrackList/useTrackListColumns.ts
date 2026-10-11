import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  defaultTrackListPreferences,
  getCachedTrackListPreferences,
  loadTrackListPreferences,
  saveTrackListPreferences,
  hiddenColumnsForPreset,
  hiddenColumnIdsForPreset,
  columnsForPreset,
  columnIdsForPreset,
  reorderColumnIds,
  type TrackListPreferences,
} from "./trackListPreferences";
import {
  DEFAULT_COLUMN_WIDTHS,
  MIN_COLUMN_WIDTHS,
  TRACK_LIST_PRESETS,
  type TrackListColumnId,
  type TrackListPresetId,
} from "./types";

export function computeMinTableWidth(
  columns: { id: TrackListColumnId }[],
  widths: Partial<Record<TrackListColumnId, number>>,
): number {
  const ACTIONS_COLUMN_WIDTH_PX = 36;
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

  const orderedColumns = useMemo(
    () => columnsForPreset(presetId, prefs),
    [presetId, prefs],
  );

  const visibleColumns = useMemo(
    () => orderedColumns.filter((col) => !hiddenSet.has(col.id)),
    [orderedColumns, hiddenSet],
  );

  const hideableColumns = useMemo(
    () => orderedColumns.filter((col) => col.hideable),
    [orderedColumns],
  );

  const canReorderColumns =
    preset.columns.filter((col) => col.id !== preset.indexColumn).length >= 2;

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

  const commitHiddenColumns = useCallback(
    (prev: TrackListPreferences, hidden: Set<TrackListColumnId>) => {
      const next = {
        ...prev,
        hiddenColumnsByPreset: {
          ...prev.hiddenColumnsByPreset,
          [presetId]: [...hidden],
        },
      };
      pendingSaveRef.current = null;
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      void saveTrackListPreferences(next);
      return next;
    },
    [presetId],
  );

  const toggleColumnVisibility = useCallback(
    (columnId: TrackListColumnId) => {
      setPrefs((prev) => {
        const hidden = new Set(hiddenColumnIdsForPreset(presetId, prev));
        if (hidden.has(columnId)) {
          hidden.delete(columnId);
        } else {
          hidden.add(columnId);
        }
        return commitHiddenColumns(prev, hidden);
      });
    },
    [commitHiddenColumns, presetId],
  );

  const hideColumn = useCallback(
    (columnId: TrackListColumnId) => {
      setPrefs((prev) => {
        const hidden = new Set(hiddenColumnIdsForPreset(presetId, prev));
        if (hidden.has(columnId)) return prev;
        hidden.add(columnId);
        return commitHiddenColumns(prev, hidden);
      });
    },
    [commitHiddenColumns, presetId],
  );

  const isColumnVisible = useCallback(
    (columnId: TrackListColumnId) => !hiddenSet.has(columnId),
    [hiddenSet],
  );

  const reorderColumns = useCallback(
    (fromId: TrackListColumnId, toId: TrackListColumnId) => {
      if (fromId === preset.indexColumn || toId === preset.indexColumn) return;
      setPrefs((prev) => {
        const currentIds = columnIdsForPreset(presetId, prev);
        const nextIds = reorderColumnIds(
          currentIds,
          fromId,
          toId,
          preset.indexColumn,
        );
        if (nextIds.every((id, i) => id === currentIds[i])) return prev;
        const next = {
          ...prev,
          columnOrderByPreset: {
            ...prev.columnOrderByPreset,
            [presetId]: nextIds,
          },
        };
        scheduleSave(next);
        return next;
      });
    },
    [preset.indexColumn, presetId, scheduleSave],
  );

  return {
    preset,
    visibleColumns,
    hideableColumns,
    columnWidths: prefs.columnWidths,
    setColumnWidth,
    toggleColumnVisibility,
    hideColumn,
    isColumnVisible,
    reorderColumns,
    canReorderColumns,
    flushSave,
  };
}
