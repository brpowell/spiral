export const CD_PLAYBACK_POSITION_EVENT = "cd-playback-position";
export const CD_PLAYBACK_ENDED_EVENT = "cd-playback-ended";
export const CD_PLAYBACK_ERROR_EVENT = "cd-playback-error";
export const CD_PLAYBACK_PCM_EVENT = "cd-playback-pcm";
export const CD_PLAYBACK_FLUSH_EVENT = "cd-playback-flush";

export interface CdPlaybackSessionKey {
  sessionId: number;
}

export interface CdPlaybackTrackKey extends CdPlaybackSessionKey {
  driveId: string;
  trackNumber: number;
}

export interface CdPlaybackStarted {
  sessionId: number;
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

export function isCdPlaybackSession(
  session: CdPlaybackSessionKey | null,
  payload: CdPlaybackSessionKey,
): boolean {
  return session !== null && session.sessionId === payload.sessionId;
}
