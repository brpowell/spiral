import { useMemo } from "react";
import { buildPlaybackOrder } from "./activeTrackList";
import { findPlaybackTrack } from "./playbackTrack";
import { getManualNextId } from "./playbackQueue";
import { formatMetadataLine, playbackStatus } from "./skinMetadataLine";
import { useSkinModeAlwaysOnTop } from "./skinModeAlwaysOnTop";
import { useAssetUrl } from "../hooks/useAssetUrl";
import { usePlayerStore } from "../store/usePlayerStore";
import type { PlayableRef } from "../types/playable";
import type { SkinBindPath } from "../types/skin";

export type SkinBindValue = string | number | boolean | null;

export interface SkinBindState {
  currentTrack: ReturnType<typeof findPlaybackTrack> | null;
  artUrl: string | null;
  playbackState: ReturnType<typeof usePlayerStore.getState>["playbackState"];
  positionSeconds: number;
  repeatMode: ReturnType<typeof usePlayerStore.getState>["repeatMode"];
  shuffle: boolean;
  volume: number;
  muted: boolean;
  canGoPrevious: boolean;
  canGoNext: boolean;
  activeQueueLength: number;
  currentTrackId: number | null;
  alwaysOnTop: boolean;
  currentPlayable: PlayableRef | null;
}

export function evaluateSkinBind(
  path: SkinBindPath,
  state: SkinBindState,
): SkinBindValue {
  const { currentTrack } = state;

  switch (path) {
    case "track.title":
      return currentTrack?.title ?? "";
    case "track.artist":
      return currentTrack?.artist ?? null;
    case "track.metadataLine":
      if (!currentTrack) return "";
      return formatMetadataLine(
        playbackStatus(state.playbackState),
        currentTrack.artist,
        currentTrack.title,
      );
    case "track.album":
      return currentTrack?.album ?? null;
    case "track.artUrl":
      return state.artUrl;
    case "track.durationSeconds":
      return currentTrack?.durationSeconds ?? null;
    case "player.isPlaying":
      return state.playbackState === "playing";
    case "player.notPlaying":
      return state.playbackState !== "playing";
    case "player.playbackState":
      return state.playbackState;
    case "player.positionSeconds":
      return state.positionSeconds;
    case "player.repeatMode":
      return state.repeatMode;
    case "player.shuffle":
      return state.shuffle;
    case "player.volume":
      return state.volume;
    case "player.muted":
      return state.muted;
    case "player.canGoPrevious":
      return state.canGoPrevious;
    case "player.canGoNext":
      return state.canGoNext;
    case "queue.length":
      return state.activeQueueLength;
    case "player.hasTrack":
      return state.currentTrackId !== null;
    case "skin.alwaysOnTop":
      return state.alwaysOnTop;
    case "playback.source":
      if (!state.currentPlayable) return null;
      return state.currentPlayable.type === "cd" ? "cd" : "file";
    default:
      return null;
  }
}

export function useSkinBindValue(path: string | undefined): SkinBindValue {
  const alwaysOnTop = useSkinModeAlwaysOnTop();
  const library = usePlayerStore((s) => s.library);
  const playbackTracks = usePlayerStore((s) => s.playbackTracks);
  const currentTrackId = usePlayerStore((s) => s.currentTrackId);
  const playbackState = usePlayerStore((s) => s.playbackState);
  const positionSeconds = usePlayerStore((s) => s.positionSeconds);
  const repeatMode = usePlayerStore((s) => s.repeatMode);
  const shuffle = usePlayerStore((s) => s.shuffle);
  const volume = usePlayerStore((s) => s.volume);
  const muted = usePlayerStore((s) => s.muted);
  const playContextIds = usePlayerStore((s) => s.playContextIds);
  const manualQueueIds = usePlayerStore((s) => s.manualQueueIds);
  const currentPlayable = usePlayerStore((s) => s.currentPlayable);

  const currentTrack = useMemo(
    () =>
      findPlaybackTrack({ library, playbackTracks, currentTrackId }) ?? null,
    [library, playbackTracks, currentTrackId],
  );

  const artUrl = useAssetUrl(currentTrack?.artPath);

  const activeQueue = useMemo(
    () =>
      buildPlaybackOrder(
        manualQueueIds,
        playContextIds,
        library,
        currentTrackId,
      ),
    [manualQueueIds, playContextIds, library, currentTrackId],
  );

  const canGoPrevious = currentTrackId !== null;
  const canGoNext =
    currentTrackId !== null &&
    activeQueue.length > 0 &&
    getManualNextId(activeQueue, currentTrackId, repeatMode) !== null;

  const bindState = useMemo(
    (): SkinBindState => ({
      currentTrack,
      artUrl,
      playbackState,
      positionSeconds,
      repeatMode,
      shuffle,
      volume,
      muted,
      canGoPrevious,
      canGoNext,
      activeQueueLength: activeQueue.length,
      currentTrackId,
      alwaysOnTop,
      currentPlayable,
    }),
    [
      currentTrack,
      artUrl,
      playbackState,
      positionSeconds,
      repeatMode,
      shuffle,
      volume,
      muted,
      canGoPrevious,
      canGoNext,
      activeQueue.length,
      currentTrackId,
      alwaysOnTop,
      currentPlayable,
    ],
  );

  return useMemo((): SkinBindValue => {
    if (!path) return null;
    return evaluateSkinBind(path as SkinBindPath, bindState);
  }, [
    path,
    bindState,
  ]);
}

/** True when `visibleWhen` bind is truthy (or unset). */
export function useSkinVisible(visibleWhen: string | undefined): boolean {
  const value = useSkinBindValue(visibleWhen);
  if (!visibleWhen) return true;
  return Boolean(value);
}

/** Disabled when `disabledWhen` bind is falsy (for canGo* / hasTrack style guards). */
export function useSkinDisabled(disabledWhen: string | undefined): boolean {
  const value = useSkinBindValue(disabledWhen);
  if (!disabledWhen) return false;
  return !value;
}
