// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePlayerStore } from "./usePlayerStore";

const album = [1, 2, 3, 4, 5, 6, 7, 8];

function setContext(playContextIds: number[], currentTrackId: number | null) {
  usePlayerStore.setState({
    playContextIds,
    sequentialContextIds: null,
    manualQueueIds: [],
    currentTrackId,
    shuffle: false,
  });
}

describe("toggleShuffle", () => {
  beforeEach(() => {
    setContext(album, 3);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("restores the sequential set list when shuffle is turned off", () => {
    usePlayerStore.getState().toggleShuffle();
    const shuffled = usePlayerStore.getState().playContextIds;
    expect([...shuffled].sort((a, b) => a - b)).toEqual(album);
    // Already-played tracks and the current one keep their place.
    expect(shuffled.slice(0, 3)).toEqual([1, 2, 3]);

    usePlayerStore.getState().toggleShuffle();
    const state = usePlayerStore.getState();
    expect(state.shuffle).toBe(false);
    expect(state.playContextIds).toEqual(album);
    expect(state.sequentialContextIds).toBeNull();
  });

  it("restores the order from a list that was shuffled when playback started", () => {
    // Shuffle already on when a track is double-clicked: the context is
    // built shuffled with the clicked track first.
    usePlayerStore.setState({ shuffle: true });
    void usePlayerStore.getState().playTracks(album, 4);
    const state = usePlayerStore.getState();
    expect(state.playContextIds[0]).toBe(4);
    expect(state.sequentialContextIds).toEqual(album);

    state.toggleShuffle();
    expect(usePlayerStore.getState().playContextIds).toEqual(album);
  });

  it("keeps the current order when the set list changed while shuffled", () => {
    usePlayerStore.getState().toggleShuffle();
    const shuffled = usePlayerStore.getState().playContextIds;
    const trimmed = shuffled.filter((id) => id !== 8);
    usePlayerStore.setState({ playContextIds: trimmed });

    usePlayerStore.getState().toggleShuffle();
    expect(usePlayerStore.getState().playContextIds).toEqual(trimmed);
  });

  it("does nothing to an empty set list", () => {
    setContext([], null);
    usePlayerStore.getState().toggleShuffle();
    usePlayerStore.getState().toggleShuffle();
    expect(usePlayerStore.getState().playContextIds).toEqual([]);
  });
});
