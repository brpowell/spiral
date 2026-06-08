import { create } from "zustand";
import type { ArtistBrowseMode } from "../lib/artists";
import {
  loadArtistBrowseMode,
  saveArtistBrowseMode,
} from "../lib/artistBrowsePreferences";
import {
  captureReturnContext,
  stateAfterCloseAlbum,
  stateAfterCloseArtist,
  stateAfterClosePlaylist,
  type DetailReturnContext,
} from "../lib/navigationReturn";
import { usePlaylistStore } from "./usePlaylistStore";

export type NavView = "albums" | "library" | "artists";

interface NavigationState {
  view: NavView;
  albumKey: string | null;
  artistKey: string | null;
  artistBrowseMode: ArtistBrowseMode;
  playlistId: number | null;
  albumReturnContext: DetailReturnContext | null;
  artistReturnContext: DetailReturnContext | null;
  playlistReturnContext: DetailReturnContext | null;
  setView: (view: NavView) => void;
  setArtistBrowseMode: (mode: ArtistBrowseMode) => void;
  openAlbum: (key: string) => void;
  closeAlbum: () => void;
  openArtist: (key: string) => void;
  closeArtist: () => void;
  openPlaylist: (id: number) => void;
  closePlaylist: () => void;
}

function playlistsForCapture() {
  return usePlaylistStore.getState().playlists;
}

export const useNavigationStore = create<NavigationState>((set) => ({
  view: "library",
  albumKey: null,
  artistKey: null,
  artistBrowseMode: loadArtistBrowseMode(),
  playlistId: null,
  albumReturnContext: null,
  artistReturnContext: null,
  playlistReturnContext: null,

  setView: (view) =>
    set({
      view,
      albumKey: null,
      artistKey: null,
      playlistId: null,
      albumReturnContext: null,
      artistReturnContext: null,
      playlistReturnContext: null,
    }),

  setArtistBrowseMode: (artistBrowseMode) => {
    saveArtistBrowseMode(artistBrowseMode);
    set({
      artistBrowseMode,
      artistKey: null,
      artistReturnContext: null,
    });
  },

  openAlbum: (albumKey) =>
    set((state) => ({
      albumKey,
      playlistId: null,
      artistKey: null,
      albumReturnContext: captureReturnContext(state, playlistsForCapture()),
    })),

  closeAlbum: () =>
    set((state) => stateAfterCloseAlbum(state.albumReturnContext)),

  openArtist: (artistKey) =>
    set((state) => ({
      artistKey,
      albumKey: null,
      playlistId: null,
      artistReturnContext: captureReturnContext(state, playlistsForCapture()),
    })),

  closeArtist: () =>
    set((state) => stateAfterCloseArtist(state.artistReturnContext)),

  openPlaylist: (playlistId) =>
    set((state) => ({
      playlistId,
      albumKey: null,
      artistKey: null,
      albumReturnContext: null,
      artistReturnContext: null,
      playlistReturnContext: captureReturnContext(state, playlistsForCapture()),
    })),

  closePlaylist: () =>
    set((state) => stateAfterClosePlaylist(state.playlistReturnContext)),
}));
