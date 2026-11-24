import type { RepeatMode, TrackListId } from "./track";

export interface PlaybackSession {
  playContextIds: TrackListId[];
  manualQueueIds: TrackListId[];
  currentTrackId: TrackListId | null;
  positionSeconds: number;
  shuffle: boolean;
  repeatMode: RepeatMode;
}
