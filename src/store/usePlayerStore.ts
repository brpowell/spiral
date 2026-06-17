import { create } from "zustand";
import * as audio from "../lib/playback";
import { cdPlaybackTracks } from "../lib/cdPlaybackArt";
import {
  isCdTrackListId,
  cdTrackNumberFromListId,
  playableRefFromTrackListId,
  resolvePlaybackSource,
  trackListIdForPlayable,
} from "../lib/playback";
import { buildPlaybackOrder } from "../lib/activeTrackList";
import { findPlaybackTrack } from "../lib/playbackTrack";
import { groupTracksIntoAlbums } from "../lib/albums";
import { groupTracksIntoArtists, type ArtistBrowseMode } from "../lib/artists";
import { startLibraryImport } from "../lib/libraryImport";
import { isCdImportBlockingPlayback } from "../lib/cdImportGuard";
import { showQueueAddedToast, showQueueAddedToastForTracks } from "../lib/queueToast";
import { seekRatioToPositionSeconds } from "../lib/playbackSeek";
import { parseRepeatMode, prunePlaybackSession } from "../lib/playbackSession";
import {
  getLibrary,
  getPlaybackSession,
  pickLibraryPaths,
  recordTrackPlay,
  removeTrack,
} from "../lib/tauri";
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
import {
  isPendingTrackId,
  isTrackImporting,
} from "../lib/pendingImportTrack";
import type { PlayableRef } from "../types/playable";
import type { PlaybackState, RepeatMode, Track } from "../types/track";

interface PlayerState {
  library: Track[];
  playContextIds: number[];
  manualQueueIds: number[];
  currentTrackId: number | null;
  currentPlayable: PlayableRef | null;
  /** When playing from a CD, the active drive and synthetic track rows. */
  cdDriveId: string | null;
  playbackTracks: Track[];
  /** CD rows added to the manual queue before playback begins. */
  cdQueueContext: { driveId: string; tracks: Track[] } | null;
  selectedTrackIds: number[];
  selectionAnchorId: number | null;
  playbackState: PlaybackState;
  positionSeconds: number;
  /** Non-null while the user is scrubbing; shared by seek bar and skin time display. */
  seekPreviewRatio: number | null;
  volume: number;
  muted: boolean;
  repeatMode: RepeatMode;
  shuffle: boolean;
  importError: string | null;
  editingTrackIds: number[];
  editingAlbumKey: string | null;
  editingArtistKey: string | null;
  editingArtistBrowseMode: ArtistBrowseMode;

  loadLibrary: (options?: { preservePlayback?: boolean }) => Promise<void>;
  stagePendingImportTracks: (tracks: Track[]) => void;
  applyImportTrackUpdates: (
    activations: { pendingId: number; track: Track }[],
    removedPendingIds: number[],
  ) => void;
  addToLibrary: () => Promise<void>;
  importFromPaths: (paths: string[]) => void;
  playTrack: (id: number) => Promise<void>;
  playTracks: (ids: number[], startId: number) => Promise<void>;
  playCdTracks: (
    driveId: string,
    tracks: Track[],
    startTrackNumber: number,
  ) => Promise<void>;
  stopCdPlaybackForDrive: (driveId: string) => void;
  selectTracksInList: (
    id: number,
    orderedIds: number[],
    modifiers: TrackSelectionModifiers,
  ) => void;
  clearSelection: () => void;
  pause: () => void;
  resume: () => void;
  recoverPlaybackAfterWake: () => Promise<void>;
  togglePlayPause: () => void;
  seek: (ratio: number) => void;
  beginSeekPreview: () => void;
  updateSeekPreview: (ratio: number) => void;
  commitSeekPreview: (ratio: number) => void;
  seekRelative: (deltaSeconds: number) => void;
  previousTrack: () => void;
  nextTrack: () => void;
  setVolume: (volume: number) => void;
  toggleMute: () => void;
  addToQueue: (ids: number[]) => void;
  addCdToQueue: (driveId: string, tracks: Track[]) => void;
  removeFromQueue: (id: number) => void;
  clearTrackList: () => void;
  cycleRepeat: () => void;
  toggleShuffle: () => void;
  clearImportError: () => void;
  openTrackEditor: (ids: number | number[]) => void;
  closeTrackEditor: () => void;
  openAlbumEditor: (albumKey: string) => void;
  closeAlbumEditor: () => void;
  openArtistEditor: (artistKey: string, browseMode: ArtistBrowseMode) => void;
  closeArtistEditor: () => void;
  updateTrackInLibrary: (track: Track) => void;
  updateTracksInLibrary: (tracks: Track[]) => void;
  removeTrackFromLibrary: (
    id: number,
    deleteFromDisk: boolean,
  ) => Promise<void>;
  removeTracksFromLibrary: (
    ids: number[],
    deleteFromDisk: boolean,
  ) => Promise<void>;
}

function cdPlayContextIds(state: PlayerState): number[] {
  if (state.playContextIds.length > 0) return state.playContextIds;
  if (state.cdDriveId == null || state.playbackTracks.length === 0) {
    return state.playContextIds;
  }
  return state.playbackTracks.map((track) => track.id);
}

function getPlaybackOrder(get: () => PlayerState): number[] {
  const state = get();
  return buildPlaybackOrder(
    state.manualQueueIds,
    cdPlayContextIds(state),
    state.library,
    state.currentTrackId,
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

function startPositionPoll(set: (partial: Partial<PlayerState>) => void): void {
  stopPositionPoll();
  positionInterval = setInterval(() => {
    set({ positionSeconds: audio.getPositionSeconds() });
  }, 500);
}

interface PlayResolvedPlayableOptions {
  playContextIds?: number[];
  playbackTracks?: Track[];
  cdDriveId?: string | null;
}

async function playResolvedPlayable(
  playable: PlayableRef,
  set: (
    partial:
      | Partial<PlayerState>
      | ((state: PlayerState) => Partial<PlayerState>),
  ) => void,
  get: () => PlayerState,
  options?: PlayResolvedPlayableOptions,
): Promise<void> {
  if (playable.type === "cd" && isCdImportBlockingPlayback(playable.driveId)) {
    return;
  }

  const state = get();
  const source = resolvePlaybackSource(playable, state.library);
  if (!source) {
    set({
      playbackState: "stopped",
      importError: "Playback failed: track not found",
    });
    return;
  }

  const trackListId = trackListIdForPlayable(playable);

  set({ importError: null });
  try {
    await audio.loadSource(source);
    // Loading may switch engines — make sure the new one has the user's
    // volume/mute state before audio starts.
    audio.setVolume(state.volume);
    audio.setMuted(state.muted);
    audio.play();
    set((current) => ({
      currentPlayable: playable,
      currentTrackId: trackListId,
      playbackState: "playing",
      positionSeconds: 0,
      seekPreviewRatio: null,
      manualQueueIds: current.manualQueueIds.filter(
        (trackId) => trackId !== trackListId,
      ),
      ...(options?.playContextIds !== undefined
        ? { playContextIds: options.playContextIds }
        : {}),
      ...(options?.playbackTracks !== undefined
        ? { playbackTracks: options.playbackTracks }
        : {}),
      ...(options?.cdDriveId !== undefined ? { cdDriveId: options.cdDriveId } : {}),
      ...(playable.type === "library"
        ? { cdDriveId: null, playbackTracks: [] }
        : {}),
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
}

async function primeCdTrackPaused(
  driveId: string,
  tracks: Track[],
  trackId: number,
  set: (partial: Partial<PlayerState>) => void,
): Promise<void> {
  const trackNumber = cdTrackNumberFromListId(trackId);
  const playable = { type: "cd" as const, driveId, trackNumber };
  const playbackTracks = cdPlaybackTracks(driveId, tracks);
  set({ importError: null });
  try {
    await audio.loadSource({
      kind: "cd",
      driveId,
      trackNumber,
    });
    set({
      currentPlayable: playable,
      currentTrackId: trackId,
      cdDriveId: driveId,
      playbackTracks,
      playbackState: "paused",
      positionSeconds: 0,
      seekPreviewRatio: null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Failed to load CD track:", err);
    set({
      playbackState: "stopped",
      importError: `Playback failed: ${message}`,
    });
  }
}

async function primeTrackPaused(
  id: number,
  library: Track[],
  set: (partial: Partial<PlayerState>) => void,
): Promise<void> {
  const track = library.find((t) => t.id === id);
  if (!track) return;

  set({ importError: null });
  try {
    await audio.load(track.filePath);
    set({
      currentTrackId: id,
      playbackState: "paused",
      positionSeconds: 0,
      seekPreviewRatio: null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Failed to load track:", err);
    set({
      playbackState: "stopped",
      importError: `Playback failed: ${message}`,
    });
  }
}

const PREVIOUS_DOUBLE_TAP_MS = 2_000;
let lastPreviousPressAt = 0;

function prunePlaybackIds(ids: number[], libraryIds: Set<number>): number[] {
  return ids.filter((id) => libraryIds.has(id));
}

function prunePendingIds(ids: number[]): number[] {
  return ids.filter((id) => !isPendingTrackId(id));
}

function interactiveLibraryIds(library: Track[]): number[] {
  return library.filter((t) => !isTrackImporting(t)).map((t) => t.id);
}

function refreshLibraryPreservingPlayback(
  library: Track[],
  set: (
    partial:
      | Partial<PlayerState>
      | ((state: PlayerState) => Partial<PlayerState>),
  ) => void,
  get: () => PlayerState,
): void {
  const state = get();
  if (state.cdDriveId !== null) {
    set({ library });
    return;
  }

  const libraryIds = new Set(library.map((t) => t.id));
  const playContextIds = prunePlaybackIds(state.playContextIds, libraryIds);
  const manualQueueIds = prunePlaybackIds(state.manualQueueIds, libraryIds);
  const currentTrackId =
    state.currentTrackId !== null && libraryIds.has(state.currentTrackId)
      ? state.currentTrackId
      : null;

  if (state.currentTrackId !== null && currentTrackId === null) {
    audio.unload();
    stopPositionPoll();
    set({
      library,
      playContextIds,
      manualQueueIds,
      currentTrackId: null,
      playbackState: "stopped",
      positionSeconds: 0,
      seekPreviewRatio: null,
    });
    return;
  }

  set({
    library,
    playContextIds,
    manualQueueIds,
    currentTrackId,
  });
}

async function restorePlaybackSession(
  library: Track[],
  set: (
    partial:
      | Partial<PlayerState>
      | ((state: PlayerState) => Partial<PlayerState>),
  ) => void,
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
      duration > 0 ? Math.min(pruned.positionSeconds, duration) : 0;
    if (position > 0 && duration > 0) {
      audio.seek(position / duration);
    }
    set({
      currentTrackId: pruned.currentTrackId,
      playbackState: "paused",
      positionSeconds: position,
    });
  } catch (err) {
    console.error("Failed to restore playback session:", err);
    set({
      currentTrackId: pruned.currentTrackId,
      playbackState: "stopped",
      positionSeconds: 0,
      seekPreviewRatio: null,
    });
  }
}

function recordCompletedPlay(trackId: number, get: () => PlayerState): void {
  const track = get().library.find((t) => t.id === trackId);
  if (!track) return;

  void recordTrackPlay(trackId)
    .then((playCount) => {
      get().updateTrackInLibrary({ ...track, playCount });
    })
    .catch((err) => {
      console.error("recordTrackPlay failed:", err);
    });
}

export const usePlayerStore = create<PlayerState>((set, get) => {
  audio.onEnd(() => {
    const { currentTrackId, repeatMode } = get();
    if (!currentTrackId) {
      stopPositionPoll();
      set({ playbackState: "stopped", positionSeconds: 0, seekPreviewRatio: null });
      return;
    }

    if (!isCdTrackListId(currentTrackId)) {
      recordCompletedPlay(currentTrackId, get);
    }

    const order = getPlaybackOrder(get);
    const nextId = getAutoplayNextId(order, currentTrackId, repeatMode);
    if (nextId !== null) {
      void get().playTrack(nextId);
      return;
    }

    stopPositionPoll();
    set({ playbackState: "stopped", positionSeconds: 0, seekPreviewRatio: null });
  });

  return {
    library: [],
    playContextIds: [],
    manualQueueIds: [],
    currentTrackId: null,
    currentPlayable: null,
    cdDriveId: null,
    playbackTracks: [],
    cdQueueContext: null,
    selectedTrackIds: [],
    selectionAnchorId: null,
    playbackState: "stopped",
    positionSeconds: 0,
    seekPreviewRatio: null,
    volume: 1,
    muted: false,
    repeatMode: "off",
    shuffle: false,
    importError: null,
    editingTrackIds: [],
    editingAlbumKey: null,
    editingArtistKey: null,
    editingArtistBrowseMode: "discography",

    loadLibrary: async (options) => {
      try {
        const library = await getLibrary();
        if (options?.preservePlayback) {
          refreshLibraryPreservingPlayback(library, set, get);
          return;
        }
        set({ library });
        await restorePlaybackSession(library, set);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("loadLibrary failed:", err);
        set({ importError: `Failed to load library: ${message}` });
      }
    },

    stagePendingImportTracks: (tracks) => {
      if (tracks.length === 0) return;
      set((state) => ({
        library: [...state.library, ...tracks],
        selectedTrackIds: prunePendingIds(state.selectedTrackIds),
        selectionAnchorId: isPendingTrackId(state.selectionAnchorId ?? -1)
          ? null
          : state.selectionAnchorId,
        playContextIds: prunePendingIds(state.playContextIds),
        manualQueueIds: prunePendingIds(state.manualQueueIds),
      }));
    },

    applyImportTrackUpdates: (activations, removedPendingIds) => {
      if (activations.length === 0 && removedPendingIds.length === 0) return;

      const removeSet = new Set(removedPendingIds);
      const activationMap = new Map(
        activations.map((entry) => [entry.pendingId, entry.track]),
      );

      set((state) => {
        const library = state.library
          .filter((t) => !removeSet.has(t.id))
          .map((t) => {
            const activated = activationMap.get(t.id);
            return activated
              ? { ...activated, importSourcePath: t.importSourcePath }
              : t;
          });

        let selectedTrackIds = state.selectedTrackIds;
        let selectionAnchorId = state.selectionAnchorId;
        let playContextIds = state.playContextIds;
        let manualQueueIds = state.manualQueueIds;
        let currentTrackId = state.currentTrackId;

        for (const { pendingId, track } of activations) {
          selectedTrackIds = selectedTrackIds.map((id) =>
            id === pendingId ? track.id : id,
          );
          if (selectionAnchorId === pendingId) selectionAnchorId = track.id;
          playContextIds = playContextIds.map((id) =>
            id === pendingId ? track.id : id,
          );
          manualQueueIds = manualQueueIds.map((id) =>
            id === pendingId ? track.id : id,
          );
          if (currentTrackId === pendingId) currentTrackId = track.id;
        }

        for (const pendingId of removedPendingIds) {
          selectedTrackIds = selectedTrackIds.filter((id) => id !== pendingId);
          if (selectionAnchorId === pendingId) selectionAnchorId = null;
          playContextIds = playContextIds.filter((id) => id !== pendingId);
          manualQueueIds = manualQueueIds.filter((id) => id !== pendingId);
          if (currentTrackId === pendingId) currentTrackId = null;
        }

        return {
          library,
          selectedTrackIds,
          selectionAnchorId,
          playContextIds,
          manualQueueIds,
          currentTrackId,
        };
      });
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
      if (isPendingTrackId(id)) return;
      const { selectedTrackIds, selectionAnchorId } = get();
      const interactiveIds = orderedIds.filter((trackId) => !isPendingTrackId(trackId));
      const result = applyTrackSelection(
        id,
        interactiveIds,
        selectedTrackIds,
        selectionAnchorId,
        modifiers,
      );
      set({
        selectedTrackIds: result.selectedIds.filter((trackId) => !isPendingTrackId(trackId)),
        selectionAnchorId:
          result.anchorId != null && isPendingTrackId(result.anchorId)
            ? null
            : result.anchorId,
      });
    },

    clearSelection: () =>
      set({ selectedTrackIds: [], selectionAnchorId: null }),

    playTracks: async (ids, startId) => {
      const playableIds = ids.filter((id) => !isPendingTrackId(id));
      if (playableIds.length === 0) return;
      if (!playableIds.includes(startId) || isPendingTrackId(startId)) return;
      const ordered = get().shuffle
        ? shuffleNewTrackList(playableIds, startId)
        : playableIds;
      set({ playContextIds: ordered, cdDriveId: null, playbackTracks: [] });
      await get().playTrack(startId);
    },

    playCdTracks: async (driveId, tracks, startTrackNumber) => {
      if (tracks.length === 0) return;
      const startId = trackListIdForPlayable({
        type: "cd",
        driveId,
        trackNumber: startTrackNumber,
      });
      const playbackTracks = cdPlaybackTracks(driveId, tracks);
      const orderedIds = playbackTracks.map((track) => track.id);
      if (!orderedIds.includes(startId)) return;

      const contextIds = get().shuffle
        ? shuffleNewTrackList(orderedIds, startId)
        : orderedIds;

      await playResolvedPlayable(
        { type: "cd", driveId, trackNumber: startTrackNumber },
        set,
        get,
        {
          playContextIds: contextIds,
          playbackTracks,
          cdDriveId: driveId,
        },
      );
    },

    stopCdPlaybackForDrive: (driveId) => {
      const state = get();
      const playingFromDrive =
        state.cdDriveId === driveId ||
        (state.currentPlayable?.type === "cd" &&
          state.currentPlayable.driveId === driveId);
      if (!playingFromDrive) return;

      audio.unload();
      stopPositionPoll();
      set({
        cdDriveId: null,
        playbackTracks: [],
        currentPlayable: null,
        playContextIds: [],
        currentTrackId: null,
        playbackState: "stopped",
        positionSeconds: 0,
        seekPreviewRatio: null,
      });
    },

    playTrack: async (id) => {
      if (isPendingTrackId(id)) return;

      if (isCdTrackListId(id)) {
        const state = get();
        const driveId =
          state.cdDriveId ??
          (state.cdQueueContext?.tracks.some((track) => track.id === id)
            ? state.cdQueueContext.driveId
            : null);
        const playable = playableRefFromTrackListId(id, driveId);
        if (!playable) return;

        const cdTracks =
          state.playbackTracks.length > 0 && state.cdDriveId === driveId
            ? state.playbackTracks
            : state.cdQueueContext?.driveId === driveId
              ? state.cdQueueContext.tracks
              : state.playbackTracks;

        const playContextIds = cdPlayContextIds({
          ...state,
          cdDriveId: driveId,
          playbackTracks: cdTracks,
        });

        await playResolvedPlayable(playable, set, get, {
          cdDriveId: driveId,
          playbackTracks: cdTracks,
          ...(playContextIds.length > 0 ? { playContextIds } : {}),
        });
        return;
      }

      const track = get().library.find((t) => t.id === id);
      if (!track || isTrackImporting(track)) return;

      const hadContext = get().playContextIds.length > 0;
      if (!hadContext && get().library.length > 0) {
        set({ playContextIds: interactiveLibraryIds(get().library) });
      }
      if (!hadContext && get().shuffle && get().playContextIds.length > 1) {
        set({ playContextIds: shuffleTrackList(get().playContextIds, id) });
      }

      await playResolvedPlayable({ type: "library", trackId: id }, set, get);
    },

    pause: () => {
      audio.pause();
      stopPositionPoll();
      set({ playbackState: "paused" });
    },

    resume: () => {
      const state = get();
      if (
        state.currentPlayable?.type === "cd" &&
        isCdImportBlockingPlayback(state.currentPlayable.driveId)
      ) {
        return;
      }
      audio.play();
      set({ playbackState: "playing" });
      startPositionPoll(set);
    },

    recoverPlaybackAfterWake: async () => {
      const state = get();
      if (state.currentPlayable?.type === "cd") return;

      const track =
        state.currentTrackId === null
          ? undefined
          : state.library.find((item) => item.id === state.currentTrackId);

      const result = await audio.recoverAfterWake({
        wasPlaying: state.playbackState === "playing",
        positionSeconds: state.positionSeconds,
        filePath: track?.filePath ?? null,
      });

      if (state.playbackState !== "playing") return;

      if (result.alreadyHealthy) {
        return;
      }

      if (result.restarted) {
        startPositionPoll(set);
        return;
      }

      stopPositionPoll();
      set({ playbackState: "paused" });
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
      const state = get();
      audio.seek(ratio);
      const fromAudio = audio.getPositionSeconds();
      const positionSeconds =
        fromAudio > 0
          ? fromAudio
          : seekRatioToPositionSeconds(
              state.library,
              state.currentTrackId,
              ratio,
              state.playbackTracks,
            );
      set({
        positionSeconds,
        seekPreviewRatio: null,
      });
    },

    beginSeekPreview: () => {
      const state = get();
      let duration = audio.getDurationSeconds();
      if (!duration) {
        duration =
          findPlaybackTrack({
            library: state.library,
            playbackTracks: state.playbackTracks,
            currentTrackId: state.currentTrackId,
          })?.durationSeconds ?? 0;
      }
      const ratio =
        duration > 0 ? state.positionSeconds / duration : 0;
      set({ seekPreviewRatio: ratio });
    },

    updateSeekPreview: (ratio) => {
      set({ seekPreviewRatio: ratio });
    },

    commitSeekPreview: (ratio) => {
      get().seek(ratio);
    },

    seekRelative: (deltaSeconds) => {
      const state = get();
      if (!state.currentTrackId) return;
      let duration = audio.getDurationSeconds();
      if (!duration) {
        duration =
          findPlaybackTrack({
            library: state.library,
            playbackTracks: state.playbackTracks,
            currentTrackId: state.currentTrackId,
          })?.durationSeconds ?? 0;
      }
      if (!duration) return;
      const position = audio.getPositionSeconds();
      const next = Math.max(0, Math.min(duration, position + deltaSeconds));
      audio.seek(next / duration);
      set({ positionSeconds: next, seekPreviewRatio: null });
    },

    previousTrack: () => {
      const { currentTrackId, repeatMode } = get();
      const order = getPlaybackOrder(get);
      if (!currentTrackId || order.length === 0) return;

      const now = Date.now();
      const isQuickSecondPress =
        now - lastPreviousPressAt < PREVIOUS_DOUBLE_TAP_MS;
      lastPreviousPressAt = now;

      if (isQuickSecondPress) {
        const prevId = getManualPreviousId(order, currentTrackId, repeatMode);
        if (prevId !== null) void get().playTrack(prevId);
        return;
      }

      get().seek(0);
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
      const state = get();
      const libraryIds = new Set(
        state.library.filter((t) => !isTrackImporting(t)).map((t) => t.id),
      );
      const valid = ids.filter((id) => libraryIds.has(id));
      if (valid.length === 0) return;

      const trackListWasEmpty =
        state.currentTrackId === null &&
        state.playContextIds.length === 0 &&
        state.manualQueueIds.length === 0;

      let addedIds: number[] = [];
      set((s) => {
        const existing = new Set(s.manualQueueIds);
        const toAdd = valid.filter((id) => !existing.has(id));
        if (toAdd.length === 0) return s;
        addedIds = toAdd;
        return { manualQueueIds: [...s.manualQueueIds, ...toAdd] };
      });

      if (addedIds.length > 0) {
        showQueueAddedToast(addedIds, get().library);
        if (trackListWasEmpty) {
          void primeTrackPaused(addedIds[0], get().library, set);
        }
      }
    },

    addCdToQueue: (driveId, tracks) => {
      if (tracks.length === 0 || isCdImportBlockingPlayback(driveId)) return;

      const playbackTracks = cdPlaybackTracks(driveId, tracks);
      const ids = playbackTracks.map((track) => track.id);
      const state = get();
      const trackListWasEmpty =
        state.currentTrackId === null &&
        state.playContextIds.length === 0 &&
        state.manualQueueIds.length === 0;

      let addedIds: number[] = [];
      set((s) => {
        const existing = new Set(s.manualQueueIds);
        const toAdd = ids.filter((id) => !existing.has(id));
        if (toAdd.length === 0) return s;
        addedIds = toAdd;
        return {
          manualQueueIds: [...s.manualQueueIds, ...toAdd],
          cdQueueContext: { driveId, tracks: playbackTracks },
        };
      });

      if (addedIds.length === 0) return;

      const addedTracks = playbackTracks.filter((track) =>
        addedIds.includes(track.id),
      );
      showQueueAddedToastForTracks(addedTracks);
      if (trackListWasEmpty) {
        void primeCdTrackPaused(driveId, playbackTracks, addedIds[0], set);
      }
    },

    removeFromQueue: (id) => {
      set((state) => ({
        manualQueueIds: state.manualQueueIds.filter(
          (trackId) => trackId !== id,
        ),
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
        currentPlayable: null,
        cdDriveId: null,
        playbackTracks: [],
        cdQueueContext: null,
        playbackState: "stopped",
        positionSeconds: 0,
        seekPreviewRatio: null,
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

    openTrackEditor: (ids) => {
      const list = (Array.isArray(ids) ? ids : [ids])
        .filter((id) => !isPendingTrackId(id))
        .filter((id, index, all) => all.indexOf(id) === index);
      if (list.length === 0) return;
      set({
        editingTrackIds: list,
        editingAlbumKey: null,
        editingArtistKey: null,
      });
    },
    closeTrackEditor: () => set({ editingTrackIds: [] }),
    openAlbumEditor: (albumKey) =>
      set({
        editingAlbumKey: albumKey,
        editingTrackIds: [],
        editingArtistKey: null,
      }),
    closeAlbumEditor: () => set({ editingAlbumKey: null }),
    openArtistEditor: (artistKey, browseMode) =>
      set({
        editingArtistKey: artistKey,
        editingArtistBrowseMode: browseMode,
        editingTrackIds: [],
        editingAlbumKey: null,
      }),
    closeArtistEditor: () => set({ editingArtistKey: null }),
    updateTrackInLibrary: (track) =>
      set((s) => ({
        library: s.library.map((t) => (t.id === track.id ? track : t)),
      })),
    updateTracksInLibrary: (tracks) =>
      set((s) => {
        const byId = new Map(tracks.map((t) => [t.id, t]));
        return {
          library: s.library.map((t) => byId.get(t.id) ?? t),
        };
      }),

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

      const library = state.library.filter((t) => !removed.has(t.id));
      const editingAlbumKey =
        state.editingAlbumKey != null &&
        groupTracksIntoAlbums(library).some(
          (a) => a.key === state.editingAlbumKey,
        )
          ? state.editingAlbumKey
          : null;
      const editingArtistKey =
        state.editingArtistKey != null &&
        groupTracksIntoArtists(library, state.editingArtistBrowseMode).some(
          (a) => a.key === state.editingArtistKey,
        )
          ? state.editingArtistKey
          : null;

      set({
        library,
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
        editingTrackIds: state.editingTrackIds.filter((id) => !removed.has(id)),
        editingAlbumKey,
        editingArtistKey,
      });
    },
  };
});
