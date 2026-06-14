import { cdTrackNumberFromListId } from "./cdTracks";
import { usePlayerStore } from "../store/usePlayerStore";
import type { CdDisc } from "../types/cd";
import type { Track } from "../types/track";

/** Build a disc snapshot from active CD playback when drive reads must be deferred. */
export function discFromActivePlayback(driveId: string): CdDisc | null {
  const { cdDriveId, playbackTracks, cdQueueContext } = usePlayerStore.getState();

  let tracks: Track[] | null = null;
  if (cdDriveId === driveId && playbackTracks.length > 0) {
    tracks = playbackTracks;
  } else if (
    cdQueueContext?.driveId === driveId &&
    cdQueueContext.tracks.length > 0
  ) {
    tracks = cdQueueContext.tracks;
  }

  if (tracks == null || tracks.length === 0) return null;

  const first = tracks[0];
  return {
    driveId,
    discId: null,
    album: first.album,
    artist: first.albumArtist ?? first.artist,
    tracks: tracks.map((track) => ({
      number: track.trackNumber ?? cdTrackNumberFromListId(track.id),
      title: track.title,
      artist: track.artist,
      durationSeconds: track.durationSeconds,
    })),
  };
}
