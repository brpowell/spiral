import { create } from "zustand";

export type NavView = "albums" | "library" | "artists" | "playlists";

interface NavigationState {
  view: NavView;
  albumKey: string | null;
  playlistId: number | null;
  setView: (view: NavView) => void;
  openAlbum: (key: string) => void;
  closeAlbum: () => void;
  openPlaylist: (id: number) => void;
  closePlaylist: () => void;
}

export const useNavigationStore = create<NavigationState>((set) => ({
  view: "library",
  albumKey: null,
  playlistId: null,

  setView: (view) => set({ view, albumKey: null, playlistId: null }),

  openAlbum: (albumKey) =>
    set({ view: "albums", albumKey, playlistId: null }),

  closeAlbum: () => set({ albumKey: null }),

  openPlaylist: (playlistId) =>
    set({ playlistId, albumKey: null }),

  closePlaylist: () => set({ playlistId: null }),
}));
