import { beforeEach, describe, expect, it, vi } from "vitest";
import { stopPlaybackForLibraryRelocate } from "./libraryRelocatePlayback";
import { usePlayerStore } from "../store/usePlayerStore";

describe("stopPlaybackForLibraryRelocate", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("clears the set list so mid-playback audio stops before a library switch", () => {
    const clearSetList = vi.fn();
    usePlayerStore.setState({ clearSetList });

    stopPlaybackForLibraryRelocate();

    expect(clearSetList).toHaveBeenCalledOnce();
  });
});
