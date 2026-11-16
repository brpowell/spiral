import { beforeEach, describe, expect, it, vi } from "vitest";
import { type GenreDesign } from "@/lib/genres/genreDesign";
import { useGenreDesignStore } from "./useGenreDesignStore";

const design: GenreDesign = {
  mode: "design",
  background: "#336699",
  backgroundEnd: null,
  icon: "note",
};

describe("useGenreDesignStore", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {},
    });
    useGenreDesignStore.setState({ designs: {} });
  });

  it("sets and clears a design", () => {
    useGenreDesignStore.getState().setDesign("rock", design);
    expect(useGenreDesignStore.getState().designs).toEqual({ rock: design });

    useGenreDesignStore.getState().setDesign("rock", null);
    expect(useGenreDesignStore.getState().designs).toEqual({});
  });

  it("carries a design across a rename", () => {
    useGenreDesignStore.getState().setDesign("rock", design);
    useGenreDesignStore.getState().renameKey("rock", "metal");
    expect(useGenreDesignStore.getState().designs).toEqual({ metal: design });
  });

  it("applies one design to many genres, or clears them", () => {
    useGenreDesignStore.getState().setDesign("keep", design);
    useGenreDesignStore.getState().applyToAll(["rock", "jazz"], design);
    expect(Object.keys(useGenreDesignStore.getState().designs).sort()).toEqual([
      "jazz",
      "keep",
      "rock",
    ]);

    useGenreDesignStore.getState().applyToAll(["rock", "jazz"], null);
    expect(useGenreDesignStore.getState().designs).toEqual({ keep: design });
  });
});
