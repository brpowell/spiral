import { useMemo } from "react";
import { useReducedMotion } from "framer-motion";
import { findPlaybackTrack } from "../lib/playbackTrack";
import { usePlaybackSettingsStore } from "../store/usePlaybackSettingsStore";
import { usePlayerStore } from "../store/usePlayerStore";
import { useAssetUrl } from "./useAssetUrl";

/** Current / crossfading now-playing tracks and resolved art URLs. */
export function useNowPlayingDisplay() {
  const library = usePlayerStore((s) => s.library);
  const playbackTracks = usePlayerStore((s) => s.playbackTracks);
  const currentTrackId = usePlayerStore((s) => s.currentTrackId);
  const crossfadeVisual = usePlayerStore((s) => s.crossfadeVisual);
  const crossfadeVisualEnabled = usePlaybackSettingsStore(
    (s) => s.crossfadeVisualEnabled,
  );
  const showCrossfadeVisual =
    crossfadeVisual !== null && crossfadeVisualEnabled;
  const crossfadeProgress = crossfadeVisual?.progress ?? 0;
  const reduceMotion = useReducedMotion() ?? false;

  const currentTrack = useMemo(
    () => findPlaybackTrack({ library, playbackTracks, currentTrackId }),
    [library, playbackTracks, currentTrackId],
  );

  const outgoingTrack = useMemo(
    () =>
      showCrossfadeVisual && crossfadeVisual
        ? findPlaybackTrack({
            library,
            playbackTracks,
            currentTrackId: crossfadeVisual.outgoingTrackId,
          })
        : undefined,
    [showCrossfadeVisual, crossfadeVisual, library, playbackTracks],
  );

  const incomingTrack = useMemo(
    () =>
      showCrossfadeVisual && crossfadeVisual
        ? findPlaybackTrack({
            library,
            playbackTracks,
            currentTrackId: crossfadeVisual.incomingTrackId,
          })
        : undefined,
    [showCrossfadeVisual, crossfadeVisual, library, playbackTracks],
  );

  const displayTrack = showCrossfadeVisual
    ? crossfadeProgress >= 0.5
      ? (incomingTrack ?? currentTrack)
      : (outgoingTrack ?? currentTrack)
    : currentTrack;

  const outgoingArtSrc = useAssetUrl(
    showCrossfadeVisual ? outgoingTrack?.artPath : null,
  );
  const incomingArtSrc = useAssetUrl(
    showCrossfadeVisual ? incomingTrack?.artPath : null,
  );
  const artSrc = useAssetUrl(displayTrack?.artPath);

  return {
    currentTrack,
    outgoingTrack,
    incomingTrack,
    displayTrack,
    showCrossfadeVisual,
    crossfadeProgress,
    reduceMotion,
    artSrc,
    outgoingArtSrc,
    incomingArtSrc,
  };
}

export type NowPlayingDisplay = ReturnType<typeof useNowPlayingDisplay>;
