import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GenreBackground } from "@/lib/genres/genreBackground";
import { useGenreBackgroundStore } from "./useGenreBackgroundStore";

const red: GenreBackground = { start: "#ff0000", end: null };

describe("useGenreBackgroundStore", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
    useGenreBackgroundStore.setState({ backgrounds: {} });
  });

  it("sets and clears a background", () => {
    useGenreBackgroundStore.getState().setBackground("rock", red);
    expect(useGenreBackgroundStore.getState().backgrounds).toEqual({
      rock: red,
    });
    useGenreBackgroundStore.getState().setBackground("rock", null);
    expect(useGenreBackgroundStore.getState().backgrounds).toEqual({});
  });

  it("carries a background across a rename", () => {
    useGenreBackgroundStore.getState().setBackground("rock", red);
    useGenreBackgroundStore.getState().renameKey("rock", "metal");
    expect(useGenreBackgroundStore.getState().backgrounds).toEqual({
      metal: red,
    });
  });
});
