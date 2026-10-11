import { applyArtPathToCdTracks } from "./cdTracks";
import { useCdStore } from "../store/useCdStore";
import { usePlayerStore } from "../store/usePlayerStore";
import type { Track } from "../types/track";

export function cdHeroArtPath(driveId: string): string | null {
  return useCdStore.getState().heroArtByDriveId[driveId] ?? null;
}

export function cdPlaybackTracks(driveId: string, tracks: Track[]): Track[] {
  return applyArtPathToCdTracks(tracks, cdHeroArtPath(driveId));
}

export function syncCdHeroArtToPlayback(
  driveId: string,
  artPath: string | null,
): void {
  usePlayerStore.setState((state) => {
    const patch: Partial<typeof state> = {};
    if (state.cdDriveId === driveId && state.playbackTracks.length > 0) {
      patch.playbackTracks = applyArtPathToCdTracks(
        state.playbackTracks,
        artPath,
      );
    }
    if (state.cdQueueContext?.driveId === driveId) {
      patch.cdQueueContext = {
        driveId,
        tracks: applyArtPathToCdTracks(state.cdQueueContext.tracks, artPath),
      };
    }
    return Object.keys(patch).length > 0 ? patch : state;
  });
}
