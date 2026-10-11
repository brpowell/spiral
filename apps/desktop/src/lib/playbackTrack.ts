import type { Track } from "../types/track";

export interface PlaybackTrackLookup {
  library: Track[];
  playbackTracks: Track[];
  /** Ephemeral CD rows queued before playback starts. */
  cdQueueTracks?: Track[];
  currentTrackId: number | null;
}

export type PlaybackTrackIndex = Omit<PlaybackTrackLookup, "currentTrackId">;

/**
 * Id → track, matching {@link findPlaybackTrack} precedence
 * (playback rows, then CD queue, then library).
 */
export function indexPlaybackTracks(
  lookup: PlaybackTrackIndex,
): Map<number, Track> {
  const map = new Map<number, Track>();
  for (const track of lookup.library) {
    map.set(track.id, track);
  }
  for (const track of lookup.cdQueueTracks ?? []) {
    map.set(track.id, track);
  }
  for (const track of lookup.playbackTracks) {
    map.set(track.id, track);
  }
  return map;
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
