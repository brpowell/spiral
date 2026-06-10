import { useMemo } from "react";
import { buildPlaybackOrder } from "./activeTrackList";
import { findPlaybackTrack } from "./playbackTrack";
import { getManualNextId } from "./playbackQueue";
import { formatMetadataLine, playbackStatus } from "./skinMetadataLine";
import { useSkinModeAlwaysOnTop } from "./skinModeAlwaysOnTop";
import { useAssetUrl } from "../hooks/useAssetUrl";
import { usePlayerStore } from "../store/usePlayerStore";
import type { SkinBindPath } from "../types/skin";

export type SkinBindValue = string | number | boolean | null;

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

  return useMemo((): SkinBindValue => {
    if (!path) return null;

    switch (path as SkinBindPath) {
      case "track.title":
        return currentTrack?.title ?? "";
      case "track.artist":
        return currentTrack?.artist ?? null;
      case "track.metadataLine":
        if (!currentTrack) return "";
        return formatMetadataLine(
          playbackStatus(playbackState),
          currentTrack.artist,
          currentTrack.title,
        );
      case "track.album":
        return currentTrack?.album ?? null;
      case "track.artUrl":
        return artUrl;
      case "track.durationSeconds":
        return currentTrack?.durationSeconds ?? null;
      case "player.isPlaying":
        return playbackState === "playing";
      case "player.notPlaying":
        return playbackState !== "playing";
      case "player.playbackState":
        return playbackState;
      case "player.positionSeconds":
        return positionSeconds;
      case "player.repeatMode":
        return repeatMode;
      case "player.shuffle":
        return shuffle;
      case "player.volume":
        return volume;
      case "player.muted":
        return muted;
      case "player.canGoPrevious":
        return canGoPrevious;
      case "player.canGoNext":
        return canGoNext;
      case "queue.length":
        return activeQueue.length;
      case "player.hasTrack":
        return currentTrackId !== null;
      case "skin.alwaysOnTop":
        return alwaysOnTop;
      default:
        return null;
    }
  }, [
    path,
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
