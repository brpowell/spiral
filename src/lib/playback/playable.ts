import {
  cdTrackListId,
  cdTrackNumberFromListId,
  isCdTrackListId,
} from "../cdTracks";
import type { PlayableRef } from "../../types/playable";
import type { Track } from "../../types/track";
import type { PlaybackSource } from "./types";

export { isCdTrackListId, cdTrackNumberFromListId };

export function trackListIdForPlayable(playable: PlayableRef): number {
  if (playable.type === "library") return playable.trackId;
  return cdTrackListId(playable.trackNumber);
}

export function playableRefFromTrackListId(
  id: number,
  cdDriveId: string | null,
): PlayableRef | null {
  if (isCdTrackListId(id)) {
    if (!cdDriveId) return null;
    return {
      type: "cd",
      driveId: cdDriveId,
      trackNumber: cdTrackNumberFromListId(id),
    };
  }
  return { type: "library", trackId: id };
}

export function resolvePlaybackSource(
  playable: PlayableRef,
  library: Track[],
): PlaybackSource | null {
  if (playable.type === "library") {
    const track = library.find((item) => item.id === playable.trackId);
    if (!track?.filePath) return null;
    return { kind: "file", path: track.filePath };
  }

  return {
    kind: "cd",
    driveId: playable.driveId,
    trackNumber: playable.trackNumber,
  };
}
