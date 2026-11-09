// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useBackgroundTasksStore } from "@/store/useBackgroundTasksStore";
import { showMissingTrackSkippedToast } from "./playbackToast";

function labels() {
  return useBackgroundTasksStore.getState().tasks.map((task) => task.label);
}

describe("showMissingTrackSkippedToast", () => {
  let now = 1_000_000;

  beforeEach(() => {
    // Each test's skips start a run of their own.
    now += 60_000;
    vi.useFakeTimers({ now });
    useBackgroundTasksStore.setState({ tasks: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("counts a run of skips in one toast", () => {
    showMissingTrackSkippedToast({ id: 1, title: "One" });
    expect(labels()).toEqual(["File not found"]);
    vi.advanceTimersByTime(1500);
    showMissingTrackSkippedToast({ id: 2, title: "Two" });
    vi.advanceTimersByTime(1500);
    showMissingTrackSkippedToast({ id: 3, title: "Three" });
    expect(labels()).toEqual(["3 tracks skipped"]);
  });

  it("counts a track met twice in a run once", () => {
    showMissingTrackSkippedToast({ id: 1, title: "One" });
    showMissingTrackSkippedToast({ id: 1, title: "One" });
    expect(labels()).toEqual(["File not found"]);
  });

  it("starts over after a pause", () => {
    showMissingTrackSkippedToast({ id: 1, title: "One" });
    showMissingTrackSkippedToast({ id: 2, title: "Two" });
    vi.advanceTimersByTime(5000);
    showMissingTrackSkippedToast({ id: 3, title: "Three" });
    expect(labels()).toEqual(["File not found"]);
  });
});
