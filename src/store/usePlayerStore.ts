import { create } from "zustand";
import * as audio from "../lib/audio";
import { buildPlaybackOrder } from "../lib/activeTrackList";
import { startLibraryImport } from "../lib/libraryImport";
import { showQueueAddedToast } from "../lib/queueToast";
import { parseRepeatMode, prunePlaybackSession } from "../lib/playbackSession";
import { getLibrary, getPlaybackSession, pickLibraryPaths, removeTrack } from "../lib/tauri";
import {
  applyTrackSelection,
  type TrackSelectionModifiers,
} from "../lib/trackSelection";
import {
  cycleRepeatMode,
  getAutoplayNextId,
  getManualNextId,
  getManualPreviousId,
  shuffleNewTrackList,
  shuffleTrackList,
} from "../lib/playbackQueue";
import type { PlaybackState, RepeatMode, Track } from "../types/track";

interface PlayerState {
  library: Track[];
  playContextIds: number[];
  manualQueueIds: number[];
  currentTrackId: number | null;
  selectedTrackIds: number[];
  selectionAnchorId: number | null;
  playbackState: PlaybackState;
  positionSeconds: number;
  volume: number;
  muted: boolean;
  repeatMode: RepeatMode;
  shuffle: boolean;
  importError: string | null;
  editingTrackId: number | null;

  loadLibrary: () => Promise<void>;
  addToLibrary: () => Promise<void>;
  importFromPaths: (paths: string[]) => void;
  playTrack: (id: number) => Promise<void>;
  playTracks: (ids: number[], startId: number) => Promise<void>;
  selectTracksInList: (
    id: number,
    orderedIds: number[],
    modifiers: TrackSelectionModifiers,
  ) => void;
  clearSelection: () => void;
  pause: () => void;
  resume: () => void;
  togglePlayPause: () => void;
  seek: (ratio: number) => void;
  seekRelative: (deltaSeconds: number) => void;
  previousTrack: () => void;
  nextTrack: () => void;
  setVolume: (volume: number) => void;
  toggleMute: () => void;
  addToQueue: (ids: number[]) => void;
  removeFromQueue: (id: number) => void;
  clearTrackList: () => void;
  cycleRepeat: () => void;
  toggleShuffle: () => void;
  clearImportError: () => void;
  openTrackEditor: (id: number) => void;
  closeTrackEditor: () => void;
  updateTrackInLibrary: (track: Track) => void;
  removeTrackFromLibrary: (id: number, deleteFromDisk: boolean) => Promise<void>;
  removeTracksFromLibrary: (
    ids: number[],
    deleteFromDisk: boolean,
  ) => Promise<void>;
}

function getPlaybackOrder(get: () => PlayerState): number[] {
  const { manualQueueIds, playContextIds, library, currentTrackId } = get();
  return buildPlaybackOrder(
    manualQueueIds,
    playContextIds,
    library,
    currentTrackId,
  );
}

function pruneIdsMany(ids: number[], removed: Set<number>): number[] {
  return ids.filter((id) => !removed.has(id));
}

let positionInterval: ReturnType<typeof setInterval> | null = null;

function stopPositionPoll(): void {
  if (positionInterval !== null) {
    clearInterval(positionInterval);
    positionInterval = null;
  }
}

function startPositionPoll(
  set: (partial: Partial<PlayerState>) => void,
): void {
  stopPositionPoll();
  positionInterval = setInterval(() => {
    set({ positionSeconds: audio.getPositionSeconds() });
  }, 500);
}

async function restorePlaybackSession(
  library: Track[],
  set: (partial: Partial<PlayerState> | ((state: PlayerState) => Partial<PlayerState>)) => void,
): Promise<void> {
  let session;
  try {
    session = await getPlaybackSession();
  } catch (err) {
    console.error("getPlaybackSession failed:", err);
    return;
  }
  if (!session) return;

  const pruned = prunePlaybackSession(session, library);
  const playbackPrefs = {
    shuffle: session.shuffle,
    repeatMode: parseRepeatMode(session.repeatMode),
  };

  if (!pruned) {
    set(playbackPrefs);
    return;
  }

  set({
    ...playbackPrefs,
    playContextIds: pruned.playContextIds,
    manualQueueIds: pruned.manualQueueIds,
  });

  if (pruned.currentTrackId === null) return;

  const track = library.find((t) => t.id === pruned.currentTrackId);
  if (!track) return;

  try {
    await audio.load(track.filePath);
    const duration = audio.getDurationSeconds();
    const position =
      duration > 0
        ? Math.min(pruned.positionSeconds, duration)
        : 0;
    if (position > 0 && duration > 0) {
      audio.seek(position / duration);
    }
    set({
      currentTrackId: pruned.currentTrackId,
      selectedTrackIds: [pruned.currentTrackId],
      selectionAnchorId: pruned.currentTrackId,
      playbackState: "paused",
      positionSeconds: position,
    });
  } catch (err) {
    console.error("Failed to restore playback session:", err);
    set({
      currentTrackId: pruned.currentTrackId,
      selectedTrackIds: [pruned.currentTrackId],
      selectionAnchorId: pruned.currentTrackId,
      playbackState: "stopped",
      positionSeconds: 0,
    });
  }
}

export const usePlayerStore = create<PlayerState>((set, get) => {
  audio.onEnd(() => {
    const { currentTrackId, repeatMode } = get();
    if (!currentTrackId) {
      stopPositionPoll();
      set({ playbackState: "stopped", positionSeconds: 0 });
      return;
    }

    const order = getPlaybackOrder(get);
    const nextId = getAutoplayNextId(order, currentTrackId, repeatMode);
    if (nextId !== null) {
      void get().playTrack(nextId);
      return;
    }

    stopPositionPoll();
    set({ playbackState: "stopped", positionSeconds: 0 });
  });

  return {
    library: [],
    playContextIds: [],
    manualQueueIds: [],
    currentTrackId: null,
    selectedTrackIds: [],
    selectionAnchorId: null,
    playbackState: "stopped",
    positionSeconds: 0,
    volume: 1,
    muted: false,
    repeatMode: "off",
    shuffle: false,
    importError: null,
    editingTrackId: null,

    loadLibrary: async () => {
      try {
        const library = await getLibrary();
        set({ library });
        await restorePlaybackSession(library, set);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("loadLibrary failed:", err);
        set({ importError: `Failed to load library: ${message}` });
      }
    },

    importFromPaths: (paths) => {
      startLibraryImport(paths);
    },

    addToLibrary: async () => {
      set({ importError: null });
      try {
        const paths = await pickLibraryPaths();
        if (paths.length === 0) return;
        startLibraryImport(paths);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        set({ importError: `Import failed: ${message}` });
      }
    },

    selectTracksInList: (id, orderedIds, modifiers) => {
      const { selectedTrackIds, selectionAnchorId } = get();
      const result = applyTrackSelection(
        id,
        orderedIds,
        selectedTrackIds,
        selectionAnchorId,
        modifiers,
      );
      set({
        selectedTrackIds: result.selectedIds,
        selectionAnchorId: result.anchorId,
      });
    },

    clearSelection: () =>
      set({ selectedTrackIds: [], selectionAnchorId: null }),

    playTracks: async (ids, startId) => {
      if (ids.length === 0) return;
      if (!ids.includes(startId)) return;
      const ordered = get().shuffle
        ? shuffleNewTrackList(ids, startId)
        : ids;
      set({
        playContextIds: ordered,
        selectedTrackIds: [startId],
        selectionAnchorId: startId,
      });
      await get().playTrack(startId);
    },

    playTrack: async (id) => {
      const track = get().library.find((t) => t.id === id);
      if (!track) return;

      const hadContext = get().playContextIds.length > 0;
      if (!hadContext && get().library.length > 0) {
        const libraryIds = get().library.map((t) => t.id);
        set({ playContextIds: libraryIds });
      }
      if (!hadContext && get().shuffle && get().playContextIds.length > 1) {
        set({ playContextIds: shuffleTrackList(get().playContextIds, id) });
      }

      set({ importError: null });
      try {
        await audio.load(track.filePath);
        audio.play();
        set((state) => ({
          currentTrackId: id,
          selectedTrackIds: [id],
          selectionAnchorId: id,
          playbackState: "playing",
          positionSeconds: 0,
          manualQueueIds: state.manualQueueIds.filter((trackId) => trackId !== id),
        }));
        startPositionPoll(set);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("Playback failed:", err);
        set({
          playbackState: "stopped",
          importError: `Playback failed: ${message}`,
        });
      }
    },

    pause: () => {
      audio.pause();
      stopPositionPoll();
      set({ playbackState: "paused" });
    },

    resume: () => {
      audio.play();
      set({ playbackState: "playing" });
      startPositionPoll(set);
    },

    togglePlayPause: () => {
      const { playbackState, currentTrackId } = get();
      if (playbackState === "playing") {
        get().pause();
      } else if (currentTrackId && playbackState === "paused") {
        get().resume();
      } else if (currentTrackId) {
        void get().playTrack(currentTrackId);
      }
    },

    seek: (ratio) => {
      audio.seek(ratio);
      set({ positionSeconds: audio.getPositionSeconds() });
    },

    seekRelative: (deltaSeconds) => {
      if (!get().currentTrackId) return;
      const duration = audio.getDurationSeconds();
      if (!duration) return;
      const position = audio.getPositionSeconds();
      const next = Math.max(0, Math.min(duration, position + deltaSeconds));
      audio.seek(next / duration);
      set({ positionSeconds: next });
    },

    previousTrack: () => {
      const { currentTrackId, repeatMode } = get();
      const order = getPlaybackOrder(get);
      if (!currentTrackId || order.length === 0) return;
      const prevId = getManualPreviousId(order, currentTrackId, repeatMode);
      if (prevId !== null) void get().playTrack(prevId);
    },

    nextTrack: () => {
      const { currentTrackId, repeatMode } = get();
      const order = getPlaybackOrder(get);
      if (!currentTrackId || order.length === 0) return;
      const nextId = getManualNextId(order, currentTrackId, repeatMode);
      if (nextId !== null) void get().playTrack(nextId);
    },

    setVolume: (volume) => {
      const clamped = Math.max(0, Math.min(1, volume));
      const muted = get().muted;
      if (!muted) {
        audio.setVolume(clamped);
      }
      if (clamped > 0 && muted) {
        audio.setMuted(false);
        audio.setVolume(clamped);
        set({ volume: clamped, muted: false });
        return;
      }
      set({ volume: clamped });
    },

    toggleMute: () => {
      const muted = !get().muted;
      audio.setMuted(muted);
      if (!muted) {
        audio.setVolume(get().volume);
      }
      set({ muted });
    },

    addToQueue: (ids) => {
      const libraryIds = new Set(get().library.map((t) => t.id));
      const valid = ids.filter((id) => libraryIds.has(id));
      if (valid.length === 0) return;

      let addedIds: number[] = [];
      set((state) => {
        const existing = new Set(state.manualQueueIds);
        const toAdd = valid.filter((id) => !existing.has(id));
        if (toAdd.length === 0) return state;
        addedIds = toAdd;
        return { manualQueueIds: [...state.manualQueueIds, ...toAdd] };
      });

      if (addedIds.length > 0) {
        showQueueAddedToast(addedIds, get().library);
      }
    },

    removeFromQueue: (id) => {
      set((state) => ({
        manualQueueIds: state.manualQueueIds.filter((trackId) => trackId !== id),
      }));
    },

    clearTrackList: () => {
      const { currentTrackId } = get();
      if (currentTrackId !== null) {
        audio.unload();
        stopPositionPoll();
      }
      set({
        playContextIds: [],
        manualQueueIds: [],
        currentTrackId: null,
        playbackState: "stopped",
        positionSeconds: 0,
      });
    },

    cycleRepeat: () =>
      set((state) => ({ repeatMode: cycleRepeatMode(state.repeatMode) })),

    toggleShuffle: () => {
      const state = get();
      const next = !state.shuffle;
      if (!next) {
        set({ shuffle: false });
        return;
      }
      if (state.playContextIds.length === 0) {
        set({ shuffle: true });
        return;
      }
      set({
        shuffle: true,
        playContextIds: shuffleTrackList(
          state.playContextIds,
          state.currentTrackId,
        ),
      });
    },

    clearImportError: () => set({ importError: null }),

    openTrackEditor: (id) => set({ editingTrackId: id }),
    closeTrackEditor: () => set({ editingTrackId: null }),
    updateTrackInLibrary: (track) =>
      set((s) => ({
        library: s.library.map((t) => (t.id === track.id ? track : t)),
      })),

    removeTrackFromLibrary: async (id, deleteFromDisk) => {
      await get().removeTracksFromLibrary([id], deleteFromDisk);
    },

    removeTracksFromLibrary: async (ids, deleteFromDisk) => {
      const unique = [...new Set(ids)];
      if (unique.length === 0) return;

      for (const id of unique) {
        await removeTrack(id, deleteFromDisk);
      }

      const state = get();
      const removed = new Set(unique);
      const wasCurrent =
        state.currentTrackId !== null && removed.has(state.currentTrackId);

      if (wasCurrent) {
        audio.unload();
        stopPositionPoll();
      }

      set({
        library: state.library.filter((t) => !removed.has(t.id)),
        playContextIds: pruneIdsMany(state.playContextIds, removed),
        manualQueueIds: pruneIdsMany(state.manualQueueIds, removed),
        currentTrackId:
          state.currentTrackId !== null && removed.has(state.currentTrackId)
            ? null
            : state.currentTrackId,
        selectedTrackIds: pruneIdsMany(state.selectedTrackIds, removed),
        selectionAnchorId:
          state.selectionAnchorId !== null &&
          removed.has(state.selectionAnchorId)
            ? null
            : state.selectionAnchorId,
        playbackState: wasCurrent ? "stopped" : state.playbackState,
        positionSeconds: wasCurrent ? 0 : state.positionSeconds,
        editingTrackId:
          state.editingTrackId !== null && removed.has(state.editingTrackId)
            ? null
            : state.editingTrackId,
      });
    },
  };
});
