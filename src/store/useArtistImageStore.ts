import { create } from "zustand";
import { applyArtistImages } from "../lib/artistArt";
import type { Artist } from "../types/artist";
import {
  getArtistImages,
  renameArtistImageKey as renameArtistImageKeyApi,
  saveArtistImage as saveArtistImageApi,
} from "../lib/tauri";

interface ArtistImageState {
  imagesByKey: Record<string, string>;
  loadArtistImages: () => Promise<void>;
  saveArtistImage: (artistKey: string, artPath: string | null) => Promise<void>;
  renameArtistImageKey: (oldKey: string, newKey: string) => Promise<void>;
}

export const useArtistImageStore = create<ArtistImageState>((set) => ({
  imagesByKey: {},

  loadArtistImages: async () => {
    const images = await getArtistImages();
    const imagesByKey: Record<string, string> = {};
    for (const image of images) {
      imagesByKey[image.artistKey] = image.artPath;
    }
    set({ imagesByKey });
  },

  saveArtistImage: async (artistKey, artPath) => {
    await saveArtistImageApi(artistKey, artPath);
    set((state) => {
      const imagesByKey = { ...state.imagesByKey };
      if (artPath) {
        imagesByKey[artistKey] = artPath;
      } else {
        delete imagesByKey[artistKey];
      }
      return { imagesByKey };
    });
  },

  renameArtistImageKey: async (oldKey, newKey) => {
    await renameArtistImageKeyApi(oldKey, newKey);
    set((state) => {
      const path = state.imagesByKey[oldKey];
      if (!path) return state;
      const imagesByKey = { ...state.imagesByKey };
      delete imagesByKey[oldKey];
      imagesByKey[newKey] = path;
      return { imagesByKey };
    });
  },
}));

export function withArtistImages(
  artists: Artist[],
  imagesByKey: Record<string, string>,
): Artist[] {
  return applyArtistImages(artists, imagesByKey);
}
