import { create } from "zustand";
import {
  addTracksToPlaylist as addTracksToPlaylistApi,
  removeTracksFromPlaylist as removeTracksFromPlaylistApi,
  reorderPlaylistTracks as reorderPlaylistTracksApi,
  createPlaylist as createPlaylistApi,
  deletePlaylist as deletePlaylistApi,
  getPlaylists,
  touchPlaylist as touchPlaylistApi,
  updatePlaylist as updatePlaylistApi,
} from "../lib/tauri";
import type { Playlist } from "../types/playlist";
import type { PlaylistImageUpdate } from "../lib/tauri";

export type PlaylistEditorTarget = number | "new" | null;

interface PlaylistState {
  playlists: Playlist[];
  editingPlaylistId: PlaylistEditorTarget;
  pendingTrackIdsForNewPlaylist: number[];

  loadPlaylists: () => Promise<void>;
  openPlaylistEditor: (target: number | "new", pendingTrackIds?: number[]) => void;
  closePlaylistEditor: () => void;
  createPlaylist: (
    title: string,
    description: string | null,
    image: PlaylistImageUpdate,
  ) => Promise<number>;
  updatePlaylist: (
    id: number,
    title: string,
    description: string | null,
    image: PlaylistImageUpdate,
  ) => Promise<void>;
  addTracksToPlaylist: (playlistId: number, trackIds: number[]) => Promise<void>;
  removeTracksFromPlaylist: (
    playlistId: number,
    trackIds: number[],
  ) => Promise<void>;
  reorderPlaylistTracks: (
    playlistId: number,
    trackIds: number[],
  ) => Promise<void>;
  touchPlaylist: (id: number) => Promise<void>;
  deletePlaylist: (id: number) => Promise<void>;
}

export const usePlaylistStore = create<PlaylistState>((set, get) => ({
  playlists: [],
  editingPlaylistId: null,
  pendingTrackIdsForNewPlaylist: [],

  loadPlaylists: async () => {
    const playlists = await getPlaylists();
    set({ playlists });
  },

  openPlaylistEditor: (target, pendingTrackIds) => {
    set({
      editingPlaylistId: target,
      pendingTrackIdsForNewPlaylist: pendingTrackIds ?? [],
    });
  },

  closePlaylistEditor: () => {
    set({
      editingPlaylistId: null,
      pendingTrackIdsForNewPlaylist: [],
    });
  },

  createPlaylist: async (title, description, image) => {
    const id = await createPlaylistApi(title, description, image);
    const { pendingTrackIdsForNewPlaylist } = get();
    if (pendingTrackIdsForNewPlaylist.length > 0) {
      await addTracksToPlaylistApi(id, pendingTrackIdsForNewPlaylist);
    }
    await get().loadPlaylists();
    set({ pendingTrackIdsForNewPlaylist: [] });
    return id;
  },

  updatePlaylist: async (id, title, description, image) => {
    await updatePlaylistApi(id, title, description, image);
    await get().loadPlaylists();
  },

  addTracksToPlaylist: async (playlistId, trackIds) => {
    await addTracksToPlaylistApi(playlistId, trackIds);
    await get().loadPlaylists();
  },

  removeTracksFromPlaylist: async (playlistId, trackIds) => {
    await removeTracksFromPlaylistApi(playlistId, trackIds);
    await get().loadPlaylists();
  },

  reorderPlaylistTracks: async (playlistId, trackIds) => {
    set((state) => ({
      playlists: state.playlists.map((p) =>
        p.id === playlistId ? { ...p, trackIds } : p,
      ),
    }));
    await reorderPlaylistTracksApi(playlistId, trackIds);
    await get().loadPlaylists();
  },

  touchPlaylist: async (id) => {
    await touchPlaylistApi(id);
    await get().loadPlaylists();
  },

  deletePlaylist: async (id) => {
    await deletePlaylistApi(id);
    const { editingPlaylistId } = get();
    await get().loadPlaylists();
    if (editingPlaylistId === id) {
      set({ editingPlaylistId: null });
    }
  },
}));
