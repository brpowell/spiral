import type { Track } from "../types/track";

export interface PlaybackTrackLookup {
  library: Track[];
  playbackTracks: Track[];
  /** Ephemeral CD rows queued before playback starts. */
  cdQueueTracks?: Track[];
  currentTrackId: number | null;
}

/** Resolve the row for now-playing UI from library or ephemeral CD list rows. */
export function findPlaybackTrack(
  lookup: PlaybackTrackLookup,
): Track | undefined {
  if (lookup.currentTrackId === null) return undefined;

  const sources = [
    lookup.playbackTracks,
    lookup.cdQueueTracks ?? [],
    lookup.library,
  ];
  for (const source of sources) {
    const track = source.find((item) => item.id === lookup.currentTrackId);
    if (track) return track;
  }

  return undefined;
}
