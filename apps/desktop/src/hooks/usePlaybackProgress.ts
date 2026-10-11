import * as audio from "../lib/playback";
import { usePlayerStore } from "../store/usePlayerStore";

/**
 * Seek interaction for a progress control. Does not subscribe to the playhead,
 * so a playing track does not re-render the caller.
 */
export function usePlaybackProgress(durationSeconds: number) {
  const currentTrackId = usePlayerStore((s) => s.currentTrackId);
  const seekPreviewRatio = usePlayerStore((s) => s.seekPreviewRatio);
  const beginSeekPreview = usePlayerStore((s) => s.beginSeekPreview);
  const updateSeekPreview = usePlayerStore((s) => s.updateSeekPreview);
  const commitSeekPreview = usePlayerStore((s) => s.commitSeekPreview);

  const isSeeking = seekPreviewRatio !== null;
  const seekValue =
    seekPreviewRatio ??
    (durationSeconds > 0 ? audio.getPositionSeconds() / durationSeconds : 0);

  const handleSeekEnd = (value: number) => {
    if (usePlayerStore.getState().seekPreviewRatio === null) return;
    commitSeekPreview(value);
  };

  return {
    isSeeking,
    seekValue,
    durationSeconds,
    disabled: currentTrackId === null,
    handleSeekStart: beginSeekPreview,
    handleSeekChange: updateSeekPreview,
    handleSeekEnd,
  };
}

/**
 * Playhead sampled by the player store (~2Hz). Re-renders only this caller.
 * Skin windows do not own the audio clock, so they follow the synced store.
 * Library chrome should paint from {@link subscribePlaybackClock} instead.
 */
export function usePlayheadSeconds(enabled = true): number {
  const positionSeconds = usePlayerStore((s) => s.positionSeconds);
  return enabled ? positionSeconds : 0;
}
