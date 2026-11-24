import type { TrackId, TrackListId } from "@/types/track";
export type CheckAllState = "none" | "some" | "all";

/** Tri-state for a select-all header checkbox. */
export function checkAllState(
  orderedIds: TrackListId[],
  checkedIds: TrackListId[],
): CheckAllState {
  if (orderedIds.length === 0) return "none";
  const checked = new Set(checkedIds);
  const count = orderedIds.filter((id) => checked.has(id)).length;
  if (count === 0) return "none";
  if (count === orderedIds.length) return "all";
  return "some";
}

export function toggleTrackChecked(
  trackId: TrackId,
  orderedIds: TrackListId[],
  checkedIds: TrackListId[],
  checked: boolean,
): TrackListId[] {
  const set = new Set(checkedIds);
  if (checked) {
    set.add(trackId);
  } else {
    set.delete(trackId);
  }
  return orderedIds.filter((id) => set.has(id));
}

export function setAllTracksChecked(
  orderedIds: TrackListId[],
  checked: boolean,
): TrackListId[] {
  return checked ? [...orderedIds] : [];
}
