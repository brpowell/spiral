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
  stateAfterCloseCd,
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
  cdDriveId: string | null;
  albumReturnContext: DetailReturnContext | null;
  artistReturnContext: DetailReturnContext | null;
  playlistReturnContext: DetailReturnContext | null;
  cdReturnContext: DetailReturnContext | null;
  setView: (view: NavView) => void;
  setArtistBrowseMode: (mode: ArtistBrowseMode) => void;
  openAlbum: (key: string) => void;
  closeAlbum: () => void;
  openArtist: (key: string) => void;
  closeArtist: () => void;
  openPlaylist: (id: number) => void;
  closePlaylist: () => void;
  openCdDrive: (id: string) => void;
  closeCdDrive: () => void;
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
  cdDriveId: null,
  albumReturnContext: null,
  artistReturnContext: null,
  playlistReturnContext: null,
  cdReturnContext: null,

  setView: (view) =>
    set({
      view,
      albumKey: null,
      artistKey: null,
      playlistId: null,
      cdDriveId: null,
      albumReturnContext: null,
      artistReturnContext: null,
      playlistReturnContext: null,
      cdReturnContext: null,
    }),

  setArtistBrowseMode: (artistBrowseMode) => {
    saveArtistBrowseMode(artistBrowseMode);
    set({ artistBrowseMode });
  },

  openAlbum: (albumKey) =>
    set((state) => ({
      albumKey,
      playlistId: null,
      artistKey: null,
      cdDriveId: null,
      albumReturnContext: captureReturnContext(state, playlistsForCapture()),
    })),

  closeAlbum: () =>
    set((state) => stateAfterCloseAlbum(state.albumReturnContext)),

  openArtist: (artistKey) =>
    set((state) => ({
      artistKey,
      albumKey: null,
      playlistId: null,
      cdDriveId: null,
      artistReturnContext: captureReturnContext(state, playlistsForCapture()),
    })),

  closeArtist: () =>
    set((state) => stateAfterCloseArtist(state.artistReturnContext)),

  openPlaylist: (playlistId) =>
    set((state) => ({
      playlistId,
      albumKey: null,
      artistKey: null,
      cdDriveId: null,
      albumReturnContext: null,
      artistReturnContext: null,
      playlistReturnContext: captureReturnContext(state, playlistsForCapture()),
    })),

  closePlaylist: () =>
    set((state) => stateAfterClosePlaylist(state.playlistReturnContext)),

  openCdDrive: (cdDriveId) =>
    set((state) => ({
      cdDriveId,
      albumKey: null,
      artistKey: null,
      playlistId: null,
      cdReturnContext: { kind: "sidebar", view: state.view },
    })),

  closeCdDrive: () =>
    set((state) => stateAfterCloseCd(state.cdReturnContext)),
}));
