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
import { buildPlaybackOrder } from "../lib/playbackOrder";
import { findPlaybackTrack } from "../lib/playbackTrack";
import { groupTracksIntoAlbums } from "../lib/albums";
import { groupTracksIntoArtists, type ArtistBrowseMode } from "../lib/artists";
import { pickAndImportLibraryPaths, startLibraryImport } from "../lib/libraryImport";
import { isCdImportBlockingPlayback } from "../lib/cdImportGuard";
import { showQueueAddedToast, showQueueAddedToastForTracks } from "../lib/queueToast";
import { seekRatioToPositionSeconds } from "../lib/playbackSeek";
import { parseRepeatMode, prunePlaybackSession } from "../lib/playbackSession";
import {
  closeListen,
  closeListenForHandoff,
  openListen,
  pauseListenAccumulation,
  resumeListenAccumulation,
  type ListenCompletion,
  type ListenEventPayload,
} from "../lib/listenSession";
import { requiresPcmPlayback } from "../lib/supportedAudio";
import { usePlaybackSettingsStore } from "./usePlaybackSettingsStore";
import {
  getLibrary,
  getPlaybackSession,
  recordListenEvent,
  removeTrack,
} from "../lib/tauri";
import {
  applyTrackSelection,
  type TrackSelectionModifiers,
} from "../lib/trackSelection";
import {
  cycleRepeatMode,
  toggleRepeatMode,
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
import { fileExists } from "../lib/artPath";
import {
  mergeLibraryClientState,
  isMissingFileError,
  withTrackMissingFile,
} from "../lib/missingFileTrack";
import { showPlaybackFileMissingToast } from "../lib/playbackToast";
import {
  findNextPlayableInOrder,
  getNextSkippingKnownUnplayable,
  isTrackKnownUnplayable,
  type PlaybackNextIdFn,
} from "../lib/playbackSkip";
import type { PlayableRef } from "../types/playable";
import type { PlaybackSource } from "../lib/playback";
import type { CrossfadeVisualState } from "../lib/playback";
import type { PlaybackState, RepeatMode, Track } from "../types/track";

export type TrackEditorTab = "details" | "file" | "lyrics";

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
  /** Outgoing/incoming track blend while a crossfade is underway. */
  crossfadeVisual: CrossfadeVisualState | null;
  volume: number;
  muted: boolean;
  balance: number;
  repeatMode: RepeatMode;
  shuffle: boolean;
  importError: string | null;
  editingTrackIds: number[];
  trackEditorInitialTab: TrackEditorTab;
  editingAlbumKey: string | null;
  editingArtistKey: string | null;
  editingArtistBrowseMode: ArtistBrowseMode;
  /** Bumped when lyrics are saved so now-playing UI can refetch. */
  lyricsRevisionByTrackId: Record<number, number>;

  loadLibrary: (options?: { preservePlayback?: boolean }) => Promise<void>;
  stagePendingImportTracks: (tracks: Track[]) => void;
  applyImportTrackUpdates: (
    activations: { pendingId: number; track: Track }[],
    removedPendingIds: number[],
  ) => void;
  addToLibrary: () => Promise<void>;
  importFromPaths: (paths: string[]) => void;
  playTrack: (
    id: number,
    options?: PlaybackAdvanceOptions,
  ) => Promise<void>;
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
  setBalance: (balance: number) => void;
  toggleMute: () => void;
  addToQueue: (ids: number[]) => void;
  addCdToQueue: (driveId: string, tracks: Track[]) => void;
  removeFromQueue: (id: number) => void;
  clearSetList: () => void;
  cycleRepeat: () => void;
  toggleRepeat: () => void;
  toggleShuffle: () => void;
  clearImportError: () => void;
  openTrackEditor: (
    ids: number | number[],
    options?: { tab?: TrackEditorTab },
  ) => void;
  closeTrackEditor: () => void;
  openAlbumEditor: (albumKey: string) => void;
  closeAlbumEditor: () => void;
  openArtistEditor: (artistKey: string, browseMode: ArtistBrowseMode) => void;
  closeArtistEditor: () => void;
  updateTrackInLibrary: (track: Track) => void;
  updateTracksInLibrary: (tracks: Track[]) => void;
  notifyTrackLyricsUpdated: (trackId: number) => void;
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

function applyActiveTrackHandoff(
  set: (
    partial:
      | Partial<PlayerState>
      | ((state: PlayerState) => Partial<PlayerState>),
  ) => void,
  get: () => PlayerState,
  incomingPlayable: PlayableRef,
  incomingTrackListId: number,
): void {
  const outgoingId = get().currentTrackId;
  if (outgoingId !== null && !isCdTrackListId(outgoingId)) {
    // Crossfade / auto handoff — close outgoing once (onEnd is suppressed).
    // Near-complete listens count as natural_end, not skipped.
    const payload = closeListenForHandoff(
      audio.getPositionSeconds(),
      audio.getDurationSeconds() || undefined,
    );
    if (payload) persistListenEvent(payload, get);
  }

  set((current) => ({
    currentPlayable: incomingPlayable,
    currentTrackId: incomingTrackListId,
    positionSeconds: audio.getPositionSeconds(),
    seekPreviewRatio: null,
    manualQueueIds: current.manualQueueIds.filter(
      (trackId) => trackId !== incomingTrackListId,
    ),
    library:
      incomingPlayable.type === "library"
        ? current.library.map((track) =>
            track.id === incomingPlayable.trackId
              ? withTrackMissingFile(track, false)
              : track,
          )
        : current.library,
    ...(incomingPlayable.type === "library"
      ? { cdDriveId: null, playbackTracks: [] }
      : {}),
  }));

  if (incomingPlayable.type === "library") {
    const track = get().library.find((t) => t.id === incomingPlayable.trackId);
    openListen(incomingPlayable.trackId, track?.durationSeconds ?? null, true);
  }
}

let positionInterval: ReturnType<typeof setTimeout> | null = null;

function stopPositionPoll(
  set?: (
    partial:
      | Partial<PlayerState>
      | ((state: PlayerState) => Partial<PlayerState>),
  ) => void,
): void {
  if (positionInterval !== null) {
    clearTimeout(positionInterval);
    positionInterval = null;
  }
  set?.({ crossfadeVisual: null });
}

function positionPollIntervalMs(
  get: () => PlayerState,
  positionSeconds: number,
): number {
  if (audio.isCrossfadeInProgress()) return 75;

  const settings = usePlaybackSettingsStore.getState();
  if (!settings.crossfadeEnabled || !audio.isCrossfadeControllerActive()) {
    return 500;
  }

  const state = get();
  if (state.playbackState !== "playing") return 500;

  const duration = audio.getDurationSeconds();
  if (!duration) return 500;

  const remaining = duration - positionSeconds;
  if (remaining <= settings.crossfadeSeconds + 1) return 75;
  return 500;
}

function tryScheduleCrossfade(
  set: (
    partial:
      | Partial<PlayerState>
      | ((state: PlayerState) => Partial<PlayerState>),
  ) => void,
  get: () => PlayerState,
  positionSeconds: number,
): void {
  const settings = usePlaybackSettingsStore.getState();
  if (!settings.crossfadeEnabled || !audio.isCrossfadeControllerActive()) {
    return;
  }
  if (audio.isCrossfadeInProgress()) return;

  const state = get();
  if (state.playbackState !== "playing" || state.currentTrackId === null) {
    return;
  }
  if (!state.currentPlayable) return;

  const order = getPlaybackOrder(get);
  const nextId = getNextSkippingKnownUnplayable(
    order,
    state.currentTrackId,
    state.repeatMode,
    state.library,
    getAutoplayNextId,
  );
  if (nextId === null) return;

  const nextPlayable: PlayableRef = { type: "library", trackId: nextId };
  const ctx = buildCrossfadeScheduleContext(get, set, nextPlayable, nextId);
  if (!ctx) return;

  audio.maybeScheduleCrossfade({ ...ctx, positionSeconds });
}

function buildCrossfadeScheduleContext(
  get: () => PlayerState,
  set: (
    partial:
      | Partial<PlayerState>
      | ((state: PlayerState) => Partial<PlayerState>),
  ) => void,
  nextPlayable: PlayableRef,
  nextTrackId: number,
): Parameters<typeof audio.startCrossfadeNow>[0] | null {
  const settings = usePlaybackSettingsStore.getState();
  const state = get();
  const currentPlayable = state.currentPlayable;
  if (!currentPlayable) return null;

  const currentSource = resolvePlaybackSource(currentPlayable, state.library);
  const nextSource = resolvePlaybackSource(nextPlayable, state.library);
  if (!currentSource || !nextSource) return null;
  if (!audio.canHowlerCrossfade(currentSource, nextSource)) return null;

  const outgoingDuration = audio.getDurationSeconds();
  if (!outgoingDuration) return null;

  return {
    crossfadeSeconds: settings.crossfadeSeconds,
    currentPlayable,
    currentTrackId: state.currentTrackId!,
    currentSource,
    nextPlayable,
    nextSource,
    nextTrackId,
    repeatMode: state.repeatMode,
    volume: state.volume,
    muted: state.muted,
    balance: state.balance,
    outgoingDuration,
    positionSeconds: audio.getPositionSeconds(),
    onActiveTrackChange: ({ incomingPlayable, incomingTrackListId }) => {
      applyActiveTrackHandoff(set, get, incomingPlayable, incomingTrackListId);
    },
  };
}

function getManualAdvanceFromTrackId(get: () => PlayerState): number | null {
  const crossfadeTarget = audio.getCrossfadeIncomingTrackId();
  if (crossfadeTarget !== null) return crossfadeTarget;
  return get().currentTrackId;
}

function tryStartManualCrossfade(
  set: (
    partial:
      | Partial<PlayerState>
      | ((state: PlayerState) => Partial<PlayerState>),
  ) => void,
  get: () => PlayerState,
  nextPlayable: PlayableRef,
  nextTrackId: number,
): boolean {
  const settings = usePlaybackSettingsStore.getState();
  if (!settings.crossfadeEnabled || !settings.crossfadeOnSkip) return false;
  if (!audio.isCrossfadeControllerActive()) return false;

  const state = get();
  if (state.playbackState !== "playing" || state.currentTrackId === null) {
    return false;
  }
  if (state.repeatMode === "one") return false;

  const ctx = buildCrossfadeScheduleContext(get, set, nextPlayable, nextTrackId);
  if (!ctx) return false;

  audio.startCrossfadeNow(ctx);
  return true;
}

function stopPlaybackAtQueueEnd(
  set: (
    partial:
      | Partial<PlayerState>
      | ((state: PlayerState) => Partial<PlayerState>),
  ) => void,
): void {
  stopPositionPoll(set);
  set({
    playbackState: "stopped",
    positionSeconds: 0,
    seekPreviewRatio: null,
    crossfadeVisual: null,
  });
}

function handleQueueEnd(
  set: (
    partial:
      | Partial<PlayerState>
      | ((state: PlayerState) => Partial<PlayerState>),
  ) => void,
): void {
  const settings = usePlaybackSettingsStore.getState();
  if (
    settings.crossfadeEnabled &&
    audio.isCrossfadeControllerActive() &&
    !audio.isCrossfadeInProgress()
  ) {
    const duration = audio.getDurationSeconds();
    const fadeSec = audio.effectiveFadeSeconds(duration, settings.crossfadeSeconds);
    audio.fadeOutAndStop(fadeSec, () => {
      stopPlaybackAtQueueEnd(set);
    });
    return;
  }

  stopPlaybackAtQueueEnd(set);
}

function startPositionPoll(
  set: (
    partial:
      | Partial<PlayerState>
      | ((state: PlayerState) => Partial<PlayerState>),
  ) => void,
  get: () => PlayerState,
): void {
  stopPositionPoll(set);

  const tick = () => {
    const positionSeconds = audio.getPositionSeconds();
    const crossfadeVisual = usePlaybackSettingsStore.getState()
      .crossfadeVisualEnabled
      ? audio.getCrossfadeVisualState()
      : null;
    set({ positionSeconds, crossfadeVisual });
    tryScheduleCrossfade(set, get, positionSeconds);

    const intervalMs = positionPollIntervalMs(get, positionSeconds);
    positionInterval = setTimeout(tick, intervalMs);
  };

  positionInterval = setTimeout(tick, positionPollIntervalMs(get, get().positionSeconds));
}

interface PlaybackAdvanceOptions {
  /** When true, skip missing tracks and continue through the set list. */
  advanceOnMissing?: boolean;
  getNextId?: PlaybackNextIdFn;
}

interface PlayResolvedPlayableOptions extends PlaybackAdvanceOptions {
  playContextIds?: number[];
  playbackTracks?: Track[];
  cdDriveId?: string | null;
}

function shouldUseCrossfadeController(
  source: PlaybackSource,
  state: PlayerState,
  playable: PlayableRef,
): boolean {
  const settings = usePlaybackSettingsStore.getState();
  if (!settings.crossfadeEnabled) return false;
  if (
    source.kind !== "file" ||
    requiresPcmPlayback(source.path, source.codec)
  ) {
    return false;
  }

  const isRepeatOneReplay =
    state.repeatMode === "one" &&
    playable.type === "library" &&
    state.currentPlayable?.type === "library" &&
    playable.trackId === state.currentPlayable.trackId;
  if (isRepeatOneReplay) return false;

  return true;
}

let playResolvedGeneration = 0;

function setLibraryTrackMissingFile(
  set: (
    partial:
      | Partial<PlayerState>
      | ((state: PlayerState) => Partial<PlayerState>),
  ) => void,
  trackId: number,
  missing: boolean,
): void {
  set((state) => ({
    library: state.library.map((track) =>
      track.id === trackId ? withTrackMissingFile(track, missing) : track,
    ),
  }));
}

function handlePlaybackFileMissing(
  set: (
    partial:
      | Partial<PlayerState>
      | ((state: PlayerState) => Partial<PlayerState>),
  ) => void,
  get: () => PlayerState,
  trackId: number,
  options?: { toast?: boolean },
): void {
  setLibraryTrackMissingFile(set, trackId, true);
  if (options?.toast === false) return;
  const track = get().library.find((item) => item.id === trackId);
  if (track) {
    showPlaybackFileMissingToast(track);
  }
}

function shouldPreserveCurrentPlayback(
  get: () => PlayerState,
  targetTrackListId: number,
): boolean {
  const state = get();
  return (
    state.playbackState === "playing" &&
    state.currentTrackId !== null &&
    state.currentTrackId !== targetTrackListId &&
    audio.isPlaying()
  );
}

async function advanceToPlayableInOrder(
  set: (
    partial:
      | Partial<PlayerState>
      | ((state: PlayerState) => Partial<PlayerState>),
  ) => void,
  get: () => PlayerState,
  fromTrackId: number,
  getNextId: PlaybackNextIdFn,
): Promise<void> {
  const state = get();
  const order = getPlaybackOrder(get);
  const nextId = await findNextPlayableInOrder(
    order,
    fromTrackId,
    state.repeatMode,
    state.library,
    getNextId,
    {
      onDiscoveredMissing: (trackId) => {
        handlePlaybackFileMissing(set, get, trackId, { toast: false });
      },
    },
  );

  if (nextId === null) {
    if (!audio.isPlaying()) {
      stopPositionPoll(set);
      set({
        playbackState: "stopped",
        positionSeconds: 0,
        seekPreviewRatio: null,
      });
    }
    return;
  }

  await playResolvedPlayable(
    { type: "library", trackId: nextId },
    set,
    get,
    { advanceOnMissing: true, getNextId },
  );
}

async function handleMissingLibraryPlayback(
  set: (
    partial:
      | Partial<PlayerState>
      | ((state: PlayerState) => Partial<PlayerState>),
  ) => void,
  get: () => PlayerState,
  trackId: number,
  trackListId: number,
  generation: number,
  options?: PlayResolvedPlayableOptions,
): Promise<void> {
  handlePlaybackFileMissing(set, get, trackId);
  if (!options?.advanceOnMissing) {
    if (shouldPreserveCurrentPlayback(get, trackListId)) return;
    return;
  }
  if (generation !== playResolvedGeneration) return;
  await advanceToPlayableInOrder(
    set,
    get,
    trackId,
    options.getNextId ?? getAutoplayNextId,
  );
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
  const generation = ++playResolvedGeneration;

  set({ importError: null });

  if (source.kind === "file" && playable.type === "library") {
    const exists = await fileExists(source.path);
    if (generation !== playResolvedGeneration) return;
    if (!exists) {
      await handleMissingLibraryPlayback(
        set,
        get,
        playable.trackId,
        trackListId,
        generation,
        options,
      );
      return;
    }
  }

  try {
    const useCrossfade = shouldUseCrossfadeController(
      source,
      state,
      playable,
    );

    if (useCrossfade) {
      await audio.crossfadeLoadAndPlay(source, {
        volume: state.volume,
        muted: state.muted,
        balance: state.balance,
      });
    } else {
      await audio.loadSource(source);
      if (generation !== playResolvedGeneration) return;
      audio.setVolume(state.volume);
      audio.setMuted(state.muted);
      audio.setBalance(state.balance);
      audio.play();
    }

    if (generation !== playResolvedGeneration) return;

    if (playable.type === "library") {
      const track = get().library.find((t) => t.id === playable.trackId);
      const previous = openListen(
        playable.trackId,
        track?.durationSeconds ?? null,
        true,
      );
      if (previous) persistListenEvent(previous, get);
    } else {
      flushListenClose("skipped", get);
    }

    set((current) => ({
      currentPlayable: playable,
      currentTrackId: trackListId,
      playbackState: "playing",
      positionSeconds: 0,
      seekPreviewRatio: null,
      manualQueueIds: current.manualQueueIds.filter(
        (trackId) => trackId !== trackListId,
      ),
      library:
        playable.type === "library"
          ? current.library.map((track) =>
              track.id === playable.trackId
                ? withTrackMissingFile(track, false)
                : track,
            )
          : current.library,
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
    startPositionPoll(set, get);
  } catch (err) {
    if (generation !== playResolvedGeneration) return;
    const message = err instanceof Error ? err.message : String(err);
    console.error("Playback failed:", err);
    if (playable.type === "library" && isMissingFileError(err)) {
      await handleMissingLibraryPlayback(
        set,
        get,
        playable.trackId,
        trackListId,
        generation,
        options,
      );
      return;
    }
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
  set: (
    partial:
      | Partial<PlayerState>
      | ((state: PlayerState) => Partial<PlayerState>),
  ) => void,
  get: () => PlayerState,
): Promise<void> {
  const track = library.find((t) => t.id === id);
  if (!track) return;

  set({ importError: null });
  try {
    const exists = await fileExists(track.filePath);
    if (!exists) {
      handlePlaybackFileMissing(set, get, id);
      return;
    }

    await audio.load(track.filePath);
    set({
      currentTrackId: id,
      playbackState: "paused",
      positionSeconds: 0,
      seekPreviewRatio: null,
      library: library.map((item) =>
        item.id === id ? withTrackMissingFile(item, false) : item,
      ),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Failed to load track:", err);
    if (isMissingFileError(err)) {
      handlePlaybackFileMissing(set, get, id);
      return;
    }
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
    set({ library: mergeLibraryClientState(state.library, library) });
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
    stopPositionPoll(set);
    set({
      library: mergeLibraryClientState(state.library, library),
      playContextIds,
      manualQueueIds,
      currentTrackId: null,
      playbackState: "stopped",
      positionSeconds: 0,
      seekPreviewRatio: null,
    });
    return;
  }

  const priorTrack =
    state.currentTrackId !== null
      ? state.library.find((track) => track.id === state.currentTrackId)
      : undefined;
  const updatedTrack =
    currentTrackId !== null
      ? library.find((track) => track.id === currentTrackId)
      : undefined;
  const filePathChanged =
    priorTrack != null &&
    updatedTrack != null &&
    priorTrack.filePath !== updatedTrack.filePath &&
    !isTrackImporting(updatedTrack);

  set({
    library: mergeLibraryClientState(state.library, library),
    playContextIds,
    manualQueueIds,
    currentTrackId,
  });

  if (!filePathChanged || updatedTrack == null) return;

  const wasPlaying = state.playbackState === "playing";
  const positionSeconds = state.positionSeconds;

  void (async () => {
    try {
      await audio.load(updatedTrack.filePath);
      if (positionSeconds > 0) {
        const duration = updatedTrack.durationSeconds ?? 0;
        if (duration > 0) {
          audio.seek(Math.min(positionSeconds / duration, 1));
        }
      }
      if (wasPlaying) {
        audio.play();
        startPositionPoll(set, get);
        set({ playbackState: "playing" });
      } else {
        stopPositionPoll(set);
        set({ playbackState: "paused", positionSeconds });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("Failed to reload converted track:", err);
      audio.unload();
      stopPositionPoll(set);
      if (isMissingFileError(err)) {
        setLibraryTrackMissingFile(set, updatedTrack.id, true);
      }
      set({
        playbackState: "stopped",
        positionSeconds: 0,
        seekPreviewRatio: null,
        importError: `Playback failed after convert: ${message}`,
      });
    }
  })();
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

function persistListenEvent(
  payload: ListenEventPayload,
  get: () => PlayerState,
): void {
  const track = get().library.find((t) => t.id === payload.trackId);
  if (!track) return;

  void recordListenEvent(payload)
    .then((result) => {
      if (!result.counted) return;
      get().updateTrackInLibrary({
        ...track,
        playCount: result.playCount,
        lastPlayedAt: result.lastPlayedAt || null,
      });
    })
    .catch((err) => {
      console.error("recordListenEvent failed:", err);
    });
}

function flushListenClose(
  completion: ListenCompletion,
  get: () => PlayerState,
): void {
  const payload = closeListen(completion);
  if (payload) persistListenEvent(payload, get);
}

/** Flush any open library listen (e.g. app quit). */
export async function flushOpenListenOnQuit(): Promise<void> {
  const payload = closeListen("interrupted");
  if (!payload) return;
  try {
    await recordListenEvent(payload);
  } catch (err) {
    console.error("recordListenEvent on quit failed:", err);
  }
}

export const usePlayerStore = create<PlayerState>((set, get) => {
  audio.onEnd(() => {
    if (audio.consumeCrossfadeHandledEnd()) return;

    const { currentTrackId, repeatMode } = get();
    if (!currentTrackId) {
      stopPositionPoll(set);
      set({ playbackState: "stopped", positionSeconds: 0, seekPreviewRatio: null });
      return;
    }

    if (!isCdTrackListId(currentTrackId)) {
      flushListenClose("natural_end", get);
    }

    const order = getPlaybackOrder(get);
    const nextId = getNextSkippingKnownUnplayable(
      order,
      currentTrackId,
      repeatMode,
      get().library,
      getAutoplayNextId,
    );
    if (nextId !== null) {
      void get().playTrack(nextId, {
        advanceOnMissing: true,
        getNextId: getAutoplayNextId,
      });
      return;
    }

    handleQueueEnd(set);
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
    crossfadeVisual: null,
    volume: 1,
    muted: false,
    balance: 0,
    repeatMode: "off",
    shuffle: false,
    importError: null,
    editingTrackIds: [],
    trackEditorInitialTab: "details",
    editingAlbumKey: null,
    editingArtistKey: null,
    editingArtistBrowseMode: "discography",
    lyricsRevisionByTrackId: {},

    loadLibrary: async (options) => {
      try {
        const loaded = await getLibrary();
        const state = get();
        const library = mergeLibraryClientState(state.library, loaded);
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
      await pickAndImportLibraryPaths();
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
      stopPositionPoll(set);
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

    playTrack: async (id, options) => {
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

      if (isTrackKnownUnplayable(track)) {
        handlePlaybackFileMissing(set, get, id);
        if (!options?.advanceOnMissing) {
          if (shouldPreserveCurrentPlayback(get, id)) return;
          return;
        }
        await advanceToPlayableInOrder(
          set,
          get,
          id,
          options.getNextId ?? getAutoplayNextId,
        );
        return;
      }

      const hadContext = get().playContextIds.length > 0;
      if (!hadContext && get().library.length > 0) {
        set({ playContextIds: interactiveLibraryIds(get().library) });
      }
      if (!hadContext && get().shuffle && get().playContextIds.length > 1) {
        set({ playContextIds: shuffleTrackList(get().playContextIds, id) });
      }

      await playResolvedPlayable(
        { type: "library", trackId: id },
        set,
        get,
        {
          advanceOnMissing: options?.advanceOnMissing,
          getNextId: options?.getNextId,
        },
      );
    },

    pause: () => {
      audio.pause();
      stopPositionPoll(set);
      pauseListenAccumulation();
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
      resumeListenAccumulation();
      set({ playbackState: "playing" });
      startPositionPoll(set, get);
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
        startPositionPoll(set, get);
        return;
      }

      stopPositionPoll(set);
      pauseListenAccumulation();
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
      const fromTrackId = getManualAdvanceFromTrackId(get);
      const { repeatMode } = get();
      const order = getPlaybackOrder(get);
      if (!fromTrackId || order.length === 0) return;

      const now = Date.now();
      const isQuickSecondPress =
        now - lastPreviousPressAt < PREVIOUS_DOUBLE_TAP_MS;
      lastPreviousPressAt = now;

      if (isQuickSecondPress) {
        const prevId = getNextSkippingKnownUnplayable(
          order,
          fromTrackId,
          repeatMode,
          get().library,
          getManualPreviousId,
        );
        if (prevId !== null) {
          const prevPlayable: PlayableRef = { type: "library", trackId: prevId };
          if (tryStartManualCrossfade(set, get, prevPlayable, prevId)) {
            return;
          }
          void get().playTrack(prevId, {
            advanceOnMissing: true,
            getNextId: getManualPreviousId,
          });
        }
        return;
      }

      get().seek(0);
    },

    nextTrack: () => {
      const fromTrackId = getManualAdvanceFromTrackId(get);
      const { repeatMode } = get();
      const order = getPlaybackOrder(get);
      if (!fromTrackId || order.length === 0) return;
      const nextId = getNextSkippingKnownUnplayable(
        order,
        fromTrackId,
        repeatMode,
        get().library,
        getManualNextId,
      );
      if (nextId !== null) {
        const nextPlayable: PlayableRef = { type: "library", trackId: nextId };
        if (tryStartManualCrossfade(set, get, nextPlayable, nextId)) {
          return;
        }
        void get().playTrack(nextId, {
          advanceOnMissing: true,
          getNextId: getManualNextId,
        });
      }
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

    setBalance: (balance) => {
      const clamped = Math.max(-1, Math.min(1, balance));
      audio.setBalance(clamped);
      set({ balance: clamped });
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

      const setListWasEmpty =
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
        if (setListWasEmpty) {
          void primeTrackPaused(addedIds[0], get().library, set, get);
        }
      }
    },

    addCdToQueue: (driveId, tracks) => {
      if (tracks.length === 0 || isCdImportBlockingPlayback(driveId)) return;

      const playbackTracks = cdPlaybackTracks(driveId, tracks);
      const ids = playbackTracks.map((track) => track.id);
      const state = get();
      const setListWasEmpty =
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
      if (setListWasEmpty) {
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

    clearSetList: () => {
      const { currentTrackId } = get();
      if (currentTrackId !== null) {
        audio.unload();
        stopPositionPoll(set);
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

    toggleRepeat: () =>
      set((state) => ({ repeatMode: toggleRepeatMode(state.repeatMode) })),

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

    openTrackEditor: (ids, options) => {
      const list = (Array.isArray(ids) ? ids : [ids])
        .filter((id) => !isPendingTrackId(id))
        .filter((id, index, all) => all.indexOf(id) === index);
      if (list.length === 0) return;
      set({
        editingTrackIds: list,
        trackEditorInitialTab: options?.tab ?? "details",
        editingAlbumKey: null,
        editingArtistKey: null,
      });
    },
    closeTrackEditor: () =>
      set({ editingTrackIds: [], trackEditorInitialTab: "details" }),
    openAlbumEditor: (albumKey) =>
      set({
        editingAlbumKey: albumKey,
        editingTrackIds: [],
        trackEditorInitialTab: "details",
        editingArtistKey: null,
      }),
    closeAlbumEditor: () => set({ editingAlbumKey: null }),
    openArtistEditor: (artistKey, browseMode) =>
      set({
        editingArtistKey: artistKey,
        editingArtistBrowseMode: browseMode,
        editingTrackIds: [],
        trackEditorInitialTab: "details",
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
    notifyTrackLyricsUpdated: (trackId) =>
      set((s) => ({
        lyricsRevisionByTrackId: {
          ...s.lyricsRevisionByTrackId,
          [trackId]: (s.lyricsRevisionByTrackId[trackId] ?? 0) + 1,
        },
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
        stopPositionPoll(set);
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
