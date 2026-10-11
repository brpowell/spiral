import { create } from "zustand";
import { refreshArtDisplay } from "../lib/artDisplayCache";
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

export const useArtistImageStore = create<ArtistImageState>((set, get) => ({
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
    const previous = get().imagesByKey[artistKey];
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
    refreshArtDisplay([previous, artPath]);
  },

  renameArtistImageKey: async (oldKey, newKey) => {
    const oldPath = get().imagesByKey[oldKey];
    const newPath = await renameArtistImageKeyApi(oldKey, newKey);
    set((state) => {
      const imagesByKey = { ...state.imagesByKey };
      delete imagesByKey[oldKey];
      if (newPath) {
        imagesByKey[newKey] = newPath;
      } else {
        delete imagesByKey[newKey];
      }
      return { imagesByKey };
    });
    refreshArtDisplay([oldPath, newPath]);
  },
}));
