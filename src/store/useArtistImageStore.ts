import { create } from "zustand";
import {
  artistImagesToRecord,
} from "../lib/artistArt";
import type { ArtistBrowseMode } from "../lib/artists";
import {
  getArtistImages,
  renameArtistImageKey as renameArtistImageKeyApi,
  saveArtistImage as saveArtistImageApi,
} from "../lib/tauri";

interface ArtistImageState {
  imagesByKey: Record<string, string>;
  loadArtistImages: () => Promise<void>;
  saveArtistImage: (
    artistKey: string,
    browseMode: ArtistBrowseMode,
    artPath: string | null,
  ) => Promise<void>;
  renameArtistImageKey: (
    oldKey: string,
    newKey: string,
    browseMode: ArtistBrowseMode,
  ) => Promise<void>;
}

export const useArtistImageStore = create<ArtistImageState>((set) => ({
  imagesByKey: {},

  loadArtistImages: async () => {
    const images = await getArtistImages();
    set({ imagesByKey: artistImagesToRecord(images) });
  },

  saveArtistImage: async (artistKey, browseMode, artPath) => {
    const otherMode: ArtistBrowseMode =
      browseMode === "discography" ? "performers" : "discography";
    await saveArtistImageApi(artistKey, browseMode, artPath);
    await saveArtistImageApi(artistKey, otherMode, artPath);
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

  renameArtistImageKey: async (oldKey, newKey, browseMode) => {
    const otherMode: ArtistBrowseMode =
      browseMode === "discography" ? "performers" : "discography";
    await renameArtistImageKeyApi(oldKey, newKey, browseMode);
    await renameArtistImageKeyApi(oldKey, newKey, otherMode);
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
