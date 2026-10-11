import { beforeEach, describe, expect, it, vi } from "vitest";

const saveArtistImageApi = vi.fn();
const refreshArtDisplay = vi.fn();

vi.mock("../lib/tauri", () => ({
  getArtistImages: vi.fn(),
  saveArtistImage: (...args: unknown[]) => saveArtistImageApi(...args),
  renameArtistImageKey: vi.fn(),
}));

vi.mock("../lib/artDisplayCache", () => ({
  refreshArtDisplay: (...args: unknown[]) => refreshArtDisplay(...args),
}));

import { useArtistImageStore } from "./useArtistImageStore";

describe("useArtistImageStore.saveArtistImage", () => {
  beforeEach(() => {
    saveArtistImageApi.mockReset().mockResolvedValue(undefined);
    refreshArtDisplay.mockReset();
    useArtistImageStore.setState({ imagesByKey: {} });
  });

  it("refreshes previous and next art paths so same-path overwrites rehydrate", async () => {
    const portrait = "/lib/Artwork/artists/Radiohead/portrait.jpg";
    useArtistImageStore.setState({
      imagesByKey: { Radiohead: portrait },
    });

    await useArtistImageStore.getState().saveArtistImage("Radiohead", portrait);

    expect(saveArtistImageApi).toHaveBeenCalledWith("Radiohead", portrait);
    expect(refreshArtDisplay).toHaveBeenCalledWith([portrait, portrait]);
    expect(useArtistImageStore.getState().imagesByKey.Radiohead).toBe(portrait);
  });

  it("refreshes the previous path when clearing a portrait", async () => {
    const portrait = "/lib/Artwork/artists/Radiohead/portrait.jpg";
    useArtistImageStore.setState({
      imagesByKey: { Radiohead: portrait },
    });

    await useArtistImageStore.getState().saveArtistImage("Radiohead", null);

    expect(refreshArtDisplay).toHaveBeenCalledWith([portrait, null]);
    expect(
      useArtistImageStore.getState().imagesByKey.Radiohead,
    ).toBeUndefined();
  });
});
