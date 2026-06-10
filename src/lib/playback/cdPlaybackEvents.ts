export const CD_PLAYBACK_POSITION_EVENT = "cd-playback-position";
export const CD_PLAYBACK_ENDED_EVENT = "cd-playback-ended";
export const CD_PLAYBACK_ERROR_EVENT = "cd-playback-error";
export const CD_PLAYBACK_PCM_EVENT = "cd-playback-pcm";
export const CD_PLAYBACK_FLUSH_EVENT = "cd-playback-flush";

export interface CdPlaybackTrackKey {
  driveId: string;
  trackNumber: number;
}

export interface CdPlaybackStarted {
  durationSeconds: number;
  sampleRate: number;
  channels: number;
}

export interface CdPlaybackPositionPayload extends CdPlaybackTrackKey {
  positionSeconds: number;
  durationSeconds: number;
  isPlaying: boolean;
}

export interface CdPlaybackTrackPayload extends CdPlaybackTrackKey {
  message?: string;
}

export interface CdPlaybackPcmPayload extends CdPlaybackTrackKey {
  channels: number;
  pcmB64: string;
}

export type CdPlaybackFlushPayload = CdPlaybackTrackKey;

export function isCdPlaybackTrack(
  track: CdPlaybackTrackKey | null,
  payload: CdPlaybackTrackKey,
): boolean {
  return (
    track !== null &&
    track.driveId === payload.driveId &&
    track.trackNumber === payload.trackNumber
  );
}
