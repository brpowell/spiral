import { create } from "zustand";
import {
  backgroundsAfterRename,
  loadGenreBackgrounds,
  saveGenreBackgrounds,
  type GenreBackground,
  type GenreBackgrounds,
} from "@/lib/genres/genreBackground";

interface GenreBackgroundState {
  backgrounds: GenreBackgrounds;
  /** Set a genre's background, or pass null to go back to the theme palette. */
  setBackground: (key: string, background: GenreBackground | null) => void;
  /** Carry a background across a rename or merge. */
  renameKey: (oldKey: string, newKey: string) => void;
}

export const useGenreBackgroundStore = create<GenreBackgroundState>(
  (set, get) => ({
    backgrounds: loadGenreBackgrounds(),

    setBackground: (key, background) => {
      const { [key]: _removed, ...rest } = get().backgrounds;
      const backgrounds = background ? { ...rest, [key]: background } : rest;
      saveGenreBackgrounds(backgrounds);
      set({ backgrounds });
    },

    renameKey: (oldKey, newKey) => {
      const backgrounds = backgroundsAfterRename(
        get().backgrounds,
        oldKey,
        newKey,
      );
      if (backgrounds === get().backgrounds) return;
      saveGenreBackgrounds(backgrounds);
      set({ backgrounds });
    },
  }),
);

/** A genre's chosen background, or null when it uses the theme palette. */
export function useGenreBackground(key: string): GenreBackground | null {
  return useGenreBackgroundStore((s) => s.backgrounds[key] ?? null);
}
