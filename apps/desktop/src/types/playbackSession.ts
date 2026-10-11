import type { RepeatMode } from "./track";

export interface PlaybackSession {
  playContextIds: number[];
  manualQueueIds: number[];
  currentTrackId: number | null;
  positionSeconds: number;
  shuffle: boolean;
  repeatMode: RepeatMode;
}
