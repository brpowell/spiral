import { create } from "zustand";
import {
  backgroundsAfterRename,
  clearLegacyGenreBackgrounds,
  fromBackgroundRecord,
  readLegacyGenreBackgrounds,
  toBackgroundRecord,
  type GenreBackground,
  type GenreBackgrounds,
} from "@/lib/genres/genreBackground";
import {
  getGenreSettings,
  importGenreBackgrounds,
  renameGenreSettingsKey,
  setGenreBackgrounds,
} from "@/lib/tauri";

interface GenreBackgroundState {
  backgrounds: GenreBackgrounds;
  /**
   * Load the backgrounds from the library database. Backgrounds an earlier
   * version kept in local storage are imported into it first, once.
   */
  load: () => Promise<void>;
  /** Set a genre's background, or pass null to go back to the theme palette. */
  setBackground: (key: string, background: GenreBackground | null) => void;
  /** Set the same background on every given genre (null: the theme gradient). */
  setBackgrounds: (keys: string[], background: GenreBackground | null) => void;
  /** Carry a background across a rename or merge. */
  renameKey: (oldKey: string, newKey: string) => void;
}

export const useGenreBackgroundStore = create<GenreBackgroundState>(
  (set, get) => {
    // The screen updates at once; the database follows. If a write fails, show
    // what the database actually holds.
    const persist = (write: Promise<unknown>) => {
      void write.catch((err) => {
        console.warn("Failed to save genre settings:", err);
        void get().load();
      });
    };

    return {
      backgrounds: {},

      load: async () => {
        const legacy = Object.entries(readLegacyGenreBackgrounds()).flatMap(
          ([key, background]) => {
            const record = toBackgroundRecord(background);
            return record ? [[key, record] as const] : [];
          },
        );
        if (legacy.length > 0) {
          await importGenreBackgrounds(legacy);
          clearLegacyGenreBackgrounds();
        }
        const backgrounds: GenreBackgrounds = {};
        for (const row of await getGenreSettings()) {
          const background = fromBackgroundRecord(row.background);
          if (background) backgrounds[row.genreKey] = background;
        }
        set({ backgrounds });
      },

      setBackground: (key, background) =>
        get().setBackgrounds([key], background),

      setBackgrounds: (keys, background) => {
        const backgrounds = { ...get().backgrounds };
        for (const key of keys) {
          if (background) backgrounds[key] = background;
          else delete backgrounds[key];
        }
        set({ backgrounds });
        persist(setGenreBackgrounds(keys, toBackgroundRecord(background)));
      },

      renameKey: (oldKey, newKey) => {
        const backgrounds = backgroundsAfterRename(
          get().backgrounds,
          oldKey,
          newKey,
        );
        if (backgrounds === get().backgrounds) return;
        set({ backgrounds });
        persist(renameGenreSettingsKey(oldKey, newKey));
      },
    };
  },
);

/** A genre's chosen background, or null when it uses the theme palette. */
export function useGenreBackground(key: string): GenreBackground | null {
  return useGenreBackgroundStore((s) => s.backgrounds[key] ?? null);
}
