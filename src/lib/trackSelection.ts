export interface TrackSelectionModifiers {
  shiftKey: boolean;
  metaKey: boolean;
}

export interface TrackSelectionResult {
  selectedIds: number[];
  anchorId: number | null;
}

/** Apply click selection with optional shift-range and cmd/ctrl toggle. */
export function applyTrackSelection(
  clickedId: number,
  orderedIds: number[],
  currentIds: number[],
  anchorId: number | null,
  modifiers: TrackSelectionModifiers,
): TrackSelectionResult {
  if (modifiers.shiftKey && anchorId != null) {
    const anchorIdx = orderedIds.indexOf(anchorId);
    const clickIdx = orderedIds.indexOf(clickedId);
    if (anchorIdx >= 0 && clickIdx >= 0) {
      const [start, end] =
        anchorIdx < clickIdx ? [anchorIdx, clickIdx] : [clickIdx, anchorIdx];
      return {
        selectedIds: orderedIds.slice(start, end + 1),
        anchorId,
      };
    }
  }

  if (modifiers.metaKey) {
    const selected = new Set(currentIds);
    if (selected.has(clickedId)) {
      selected.delete(clickedId);
    } else {
      selected.add(clickedId);
    }
    const selectedIds = orderedIds.filter((id) => selected.has(id));
    return {
      selectedIds,
      anchorId: clickedId,
    };
  }

  return { selectedIds: [clickedId], anchorId: clickedId };
}

/** Tracks to act on from context menu: selection if anchor is selected, else the row. */
export function tracksForContextAction(
  trackId: number,
  selectedIds: number[],
  libraryTrackIds: Set<number>,
): number[] {
  if (selectedIds.includes(trackId) && selectedIds.length > 1) {
    return selectedIds.filter((id) => libraryTrackIds.has(id));
  }
  return [trackId];
}
