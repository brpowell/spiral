import { describe, expect, it } from "vitest";
import {
  checkAllState,
  setAllTracksChecked,
  toggleTrackChecked,
} from "./trackCheckSelection";

describe("trackCheckSelection", () => {
  const ordered = [1, 2, 3];

  it("reports check-all state", () => {
    expect(checkAllState(ordered, [])).toBe("none");
    expect(checkAllState(ordered, [1, 2])).toBe("some");
    expect(checkAllState(ordered, [1, 2, 3])).toBe("all");
  });

  it("toggles individual tracks preserving order", () => {
    expect(toggleTrackChecked(2, ordered, [1], true)).toEqual([1, 2]);
    expect(toggleTrackChecked(1, ordered, [1, 2], false)).toEqual([2]);
  });

  it("selects or clears all tracks", () => {
    expect(setAllTracksChecked(ordered, true)).toEqual(ordered);
    expect(setAllTracksChecked(ordered, false)).toEqual([]);
  });
});
