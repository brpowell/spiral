import { create } from "zustand";
import {
  defaultDesignForGenre,
  designsAfterApplyToAll,
  designsAfterRename,
  loadGenreDesigns,
  saveGenreDesigns,
  type GenreDesign,
  type GenreDesigns,
} from "@/lib/genres/genreDesign";

interface GenreDesignState {
  designs: GenreDesigns;
  /** Set a genre's design, or pass null to go back to the plain look. */
  setDesign: (key: string, design: GenreDesign | null) => void;
  /**
   * Give every genre in `keys` this design, or pass null to send them all back
   * to their generated look. One write, however many genres.
   */
  applyToAll: (keys: readonly string[], design: GenreDesign | null) => void;
  /** Carry a design across a rename or merge (see `designsAfterRename`). */
  renameKey: (oldKey: string, newKey: string) => void;
}

export const useGenreDesignStore = create<GenreDesignState>((set, get) => ({
  designs: loadGenreDesigns(),

  setDesign: (key, design) => {
    const { [key]: _removed, ...rest } = get().designs;
    const designs = design ? { ...rest, [key]: design } : rest;
    saveGenreDesigns(designs);
    set({ designs });
  },

  applyToAll: (keys, design) => {
    const designs = designsAfterApplyToAll(get().designs, keys, design);
    saveGenreDesigns(designs);
    set({ designs });
  },

  renameKey: (oldKey, newKey) => {
    const designs = designsAfterRename(get().designs, oldKey, newKey);
    if (designs === get().designs) return;
    saveGenreDesigns(designs);
    set({ designs });
  },
}));

/** A genre's design: its customization, or the look generated from its key. */
export function useGenreDesign(key: string): GenreDesign {
  const custom = useGenreDesignStore((s) => s.designs[key]);
  return custom ?? defaultDesignForGenre(key);
}
