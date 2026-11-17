import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GenreBackground } from "@/lib/genres/genreBackground";
import {
  getGenreSettings,
  renameGenreSettingsKey,
  setGenreBackgrounds,
} from "@/lib/tauri";
import { useGenreBackgroundStore } from "./useGenreBackgroundStore";

vi.mock("@/lib/tauri", () => ({
  getGenreSettings: vi.fn(),
  renameGenreSettingsKey: vi.fn(),
  setGenreBackgrounds: vi.fn(),
}));

const red: GenreBackground = { start: "#ff0000", end: null };
const redRecord = { kind: "color", start: "#ff0000", end: null };

describe("useGenreBackgroundStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getGenreSettings).mockResolvedValue([]);
    vi.mocked(setGenreBackgrounds).mockResolvedValue();
    vi.mocked(renameGenreSettingsKey).mockResolvedValue();
    useGenreBackgroundStore.setState({ backgrounds: {} });
  });

  it("sets and clears a background, saving each to the database", () => {
    useGenreBackgroundStore.getState().setBackground("rock", red);
    expect(useGenreBackgroundStore.getState().backgrounds).toEqual({
      rock: red,
    });
    expect(setGenreBackgrounds).toHaveBeenLastCalledWith(["rock"], redRecord);

    useGenreBackgroundStore.getState().setBackground("rock", null);
    expect(useGenreBackgroundStore.getState().backgrounds).toEqual({});
    expect(setGenreBackgrounds).toHaveBeenLastCalledWith(["rock"], null);
  });

  it("sets one background on many genres, or clears them", () => {
    const store = useGenreBackgroundStore.getState();
    store.setBackgrounds(["rock", "jazz"], red);
    expect(useGenreBackgroundStore.getState().backgrounds).toEqual({
      rock: red,
      jazz: red,
    });
    expect(setGenreBackgrounds).toHaveBeenLastCalledWith(
      ["rock", "jazz"],
      redRecord,
    );
    store.setBackgrounds(["rock", "jazz"], null);
    expect(useGenreBackgroundStore.getState().backgrounds).toEqual({});
  });

  it("carries a background across a rename", () => {
    useGenreBackgroundStore.getState().setBackground("rock", red);
    useGenreBackgroundStore.getState().renameKey("rock", "metal");
    expect(useGenreBackgroundStore.getState().backgrounds).toEqual({
      metal: red,
    });
    expect(renameGenreSettingsKey).toHaveBeenCalledWith("rock", "metal");
  });

  it("loads backgrounds from the database", async () => {
    vi.mocked(getGenreSettings).mockResolvedValue([
      { genreKey: "rock", background: redRecord as never },
      {
        genreKey: "jazz",
        background: { kind: "themeSolid", start: null, end: null },
      },
      { genreKey: "pop", background: null },
    ]);
    await useGenreBackgroundStore.getState().load();
    expect(useGenreBackgroundStore.getState().backgrounds).toEqual({
      rock: red,
      jazz: { theme: "solid" },
    });
  });
});
