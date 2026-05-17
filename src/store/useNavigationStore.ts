import { create } from "zustand";

export type NavView = "albums" | "library" | "artists" | "playlists";

interface NavigationState {
  view: NavView;
  albumKey: string | null;
  setView: (view: NavView) => void;
  openAlbum: (key: string) => void;
  closeAlbum: () => void;
}

export const useNavigationStore = create<NavigationState>((set) => ({
  view: "library",
  albumKey: null,

  setView: (view) => set({ view, albumKey: null }),

  openAlbum: (albumKey) => set({ view: "albums", albumKey }),

  closeAlbum: () => set({ albumKey: null }),
}));
