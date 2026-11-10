import { beforeEach, describe, expect, it } from "vitest";
import { usePlayerStore } from "./usePlayerStore";

describe("genre editor state", () => {
  beforeEach(() => {
    usePlayerStore.setState({
      editingGenreKey: null,
      editingArtistKey: null,
      editingAlbumKey: null,
      editingTrackIds: [],
    });
  });

  it("opens and closes", () => {
    usePlayerStore.getState().openGenreEditor("rock");
    expect(usePlayerStore.getState().editingGenreKey).toBe("rock");
    usePlayerStore.getState().closeGenreEditor();
    expect(usePlayerStore.getState().editingGenreKey).toBeNull();
  });

  it("closes other editors when opened, and is closed by them", () => {
    usePlayerStore.setState({ editingArtistKey: "a", editingAlbumKey: "b" });
    usePlayerStore.getState().openGenreEditor("rock");
    expect(usePlayerStore.getState().editingArtistKey).toBeNull();
    expect(usePlayerStore.getState().editingAlbumKey).toBeNull();

    usePlayerStore.getState().openArtistEditor("a", "performers");
    expect(usePlayerStore.getState().editingGenreKey).toBeNull();

    usePlayerStore.getState().openGenreEditor("rock");
    usePlayerStore.getState().openAlbumEditor("b");
    expect(usePlayerStore.getState().editingGenreKey).toBeNull();
  });
});
