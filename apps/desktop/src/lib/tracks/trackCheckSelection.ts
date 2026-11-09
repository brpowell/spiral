export type CheckAllState = "none" | "some" | "all";

/** Tri-state for a select-all header checkbox. */
export function checkAllState(
  orderedIds: number[],
  checkedIds: number[],
): CheckAllState {
  if (orderedIds.length === 0) return "none";
  const checked = new Set(checkedIds);
  const count = orderedIds.filter((id) => checked.has(id)).length;
  if (count === 0) return "none";
  if (count === orderedIds.length) return "all";
  return "some";
}

export function toggleTrackChecked(
  trackId: number,
  orderedIds: number[],
  checkedIds: number[],
  checked: boolean,
): number[] {
  const set = new Set(checkedIds);
  if (checked) {
    set.add(trackId);
  } else {
    set.delete(trackId);
  }
  return orderedIds.filter((id) => set.has(id));
}

export function setAllTracksChecked(
  orderedIds: number[],
  checked: boolean,
): number[] {
  return checked ? [...orderedIds] : [];
}
