import { useEffect, useLayoutEffect, useState } from "react";
import * as audio from "../lib/playback";
import { isSkinModeWindow } from "../lib/windowRole";
import { usePlayerStore } from "../store/usePlayerStore";

/**
 * The engine playhead is authoritative and monotonic; the store only samples it
 * every ~500ms. Adopt a store value only when it differs by more than a poll
 * interval — that means a real discontinuity (seek, track change) rather than
 * poll lag, which would otherwise rewind the RAF position for a frame.
 */
const POSITION_DISCONTINUITY_SECONDS = 0.5;

export function usePlaybackProgress(durationSeconds: number) {
  const currentTrackId = usePlayerStore((s) => s.currentTrackId);
  const playbackState = usePlayerStore((s) => s.playbackState);
  const positionSeconds = usePlayerStore((s) => s.positionSeconds);
  const seekPreviewRatio = usePlayerStore((s) => s.seekPreviewRatio);
  const beginSeekPreview = usePlayerStore((s) => s.beginSeekPreview);
  const updateSeekPreview = usePlayerStore((s) => s.updateSeekPreview);
  const commitSeekPreview = usePlayerStore((s) => s.commitSeekPreview);

  const [livePosition, setLivePosition] = useState(0);

  const isSeeking = seekPreviewRatio !== null;
  const seekValue =
    seekPreviewRatio ??
    (durationSeconds > 0 ? positionSeconds / durationSeconds : 0);

  // Adopt store commits (seek, track change) before paint.
  useLayoutEffect(() => {
    setLivePosition((current) =>
      Math.abs(positionSeconds - current) > POSITION_DISCONTINUITY_SECONDS
        ? positionSeconds
        : current,
    );
  }, [positionSeconds]);

  useEffect(() => {
    if (playbackState !== "playing" || isSeeking || isSkinModeWindow()) {
      return;
    }

    let frame = 0;
    const tick = () => {
      setLivePosition(audio.getPositionSeconds());
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playbackState, isSeeking, currentTrackId]);

  const displayPosition = isSeeking
    ? seekValue * durationSeconds
    : playbackState === "playing"
      ? livePosition
      : positionSeconds;

  const progress = durationSeconds > 0 ? displayPosition / durationSeconds : 0;

  const handleSeekEnd = (value: number) => {
    if (usePlayerStore.getState().seekPreviewRatio === null) return;
    commitSeekPreview(value);
  };

  return {
    isSeeking,
    seekValue,
    progress,
    displayPosition,
    durationSeconds,
    disabled: currentTrackId === null,
    handleSeekStart: beginSeekPreview,
    handleSeekChange: updateSeekPreview,
    handleSeekEnd,
  };
}
