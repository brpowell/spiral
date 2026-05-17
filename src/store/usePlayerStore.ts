import { create } from "zustand";
import * as audio from "../lib/audio";
import { startLibraryImport } from "../lib/libraryImport";
import { getLibrary, pickLibraryPaths, removeTrack } from "../lib/tauri";
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
  queue: number[];
  currentTrackId: number | null;
  selectedTrackId: number | null;
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
  selectTrack: (id: number | null) => void;
  pause: () => void;
  resume: () => void;
  togglePlayPause: () => void;
  seek: (ratio: number) => void;
  seekRelative: (deltaSeconds: number) => void;
  previousTrack: () => void;
  nextTrack: () => void;
  setVolume: (volume: number) => void;
  toggleMute: () => void;
  setQueue: (ids: number[]) => void;
  cycleRepeat: () => void;
  toggleShuffle: () => void;
  clearImportError: () => void;
  openTrackEditor: (id: number) => void;
  closeTrackEditor: () => void;
  updateTrackInLibrary: (track: Track) => void;
  removeTrackFromLibrary: (id: number, deleteFromDisk: boolean) => Promise<void>;
}

function ensureQueue(set: (partial: Partial<PlayerState>) => void, get: () => PlayerState): number[] {
  const { queue, library } = get();
  if (queue.length > 0) return queue;
  const ids = library.map((t) => t.id);
  if (ids.length > 0) {
    set({ queue: ids });
  }
  return ids;
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

export const usePlayerStore = create<PlayerState>((set, get) => {
  audio.onEnd(() => {
    const { currentTrackId, repeatMode } = get();
    if (!currentTrackId) {
      stopPositionPoll();
      set({ playbackState: "stopped", positionSeconds: 0 });
      return;
    }

    const queue = ensureQueue(set, get);
    const nextId = getAutoplayNextId(queue, currentTrackId, repeatMode);
    if (nextId !== null) {
      void get().playTrack(nextId);
      return;
    }

    stopPositionPoll();
    set({ playbackState: "stopped", positionSeconds: 0 });
  });

  return {
    library: [],
    queue: [],
    currentTrackId: null,
    selectedTrackId: null,
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

    selectTrack: (id) => set({ selectedTrackId: id }),

    playTracks: async (ids, startId) => {
      if (ids.length === 0) return;
      if (!ids.includes(startId)) return;
      const ordered = get().shuffle
        ? shuffleNewTrackList(ids, startId)
        : ids;
      set({ queue: ordered, selectedTrackId: startId });
      await get().playTrack(startId);
    },

    playTrack: async (id) => {
      const track = get().library.find((t) => t.id === id);
      if (!track) return;

      const hadQueue = get().queue.length > 0;
      ensureQueue(set, get);
      if (!hadQueue && get().shuffle && get().queue.length > 1) {
        set({ queue: shuffleTrackList(get().queue, id) });
      }
      set({ importError: null });
      try {
        await audio.load(track.filePath);
        audio.play();
        set({
          currentTrackId: id,
          selectedTrackId: id,
          playbackState: "playing",
          positionSeconds: 0,
        });
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
      const queue = ensureQueue(set, get);
      if (!currentTrackId || queue.length === 0) return;
      const prevId = getManualPreviousId(queue, currentTrackId, repeatMode);
      if (prevId !== null) void get().playTrack(prevId);
    },

    nextTrack: () => {
      const { currentTrackId, repeatMode } = get();
      const queue = ensureQueue(set, get);
      if (!currentTrackId || queue.length === 0) return;
      const nextId = getManualNextId(queue, currentTrackId, repeatMode);
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

    setQueue: (ids) => set({ queue: ids }),
    cycleRepeat: () =>
      set((state) => ({ repeatMode: cycleRepeatMode(state.repeatMode) })),
    toggleShuffle: () => {
      const state = get();
      const next = !state.shuffle;
      if (!next) {
        set({ shuffle: false });
        return;
      }
      if (state.queue.length === 0) {
        set({ shuffle: true });
        return;
      }
      set({
        shuffle: true,
        queue: shuffleTrackList(state.queue, state.currentTrackId),
      });
    },
    clearImportError: () => set({ importError: null }),

    openTrackEditor: (id) => set({ editingTrackId: id }),
    closeTrackEditor: () => set({ editingTrackId: null }),
    updateTrackInLibrary: (track) =>
      set((state) => ({
        library: state.library.map((t) => (t.id === track.id ? track : t)),
      })),

    removeTrackFromLibrary: async (id, deleteFromDisk) => {
      await removeTrack(id, deleteFromDisk);
      const state = get();
      const wasCurrent = state.currentTrackId === id;
      if (wasCurrent) {
        audio.unload();
        stopPositionPoll();
      }
      set({
        library: state.library.filter((t) => t.id !== id),
        queue: state.queue.filter((trackId) => trackId !== id),
        currentTrackId: wasCurrent ? null : state.currentTrackId,
        selectedTrackId:
          state.selectedTrackId === id ? null : state.selectedTrackId,
        playbackState: wasCurrent ? "stopped" : state.playbackState,
        positionSeconds: wasCurrent ? 0 : state.positionSeconds,
        editingTrackId: state.editingTrackId === id ? null : state.editingTrackId,
      });
    },
  };
});
