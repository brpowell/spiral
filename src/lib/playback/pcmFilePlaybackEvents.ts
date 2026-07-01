export const PCM_FILE_PLAYBACK_POSITION_EVENT = "file-playback-position";
export const PCM_FILE_PLAYBACK_ENDED_EVENT = "file-playback-ended";
export const PCM_FILE_PLAYBACK_PCM_EVENT = "file-playback-pcm";
export const PCM_FILE_PLAYBACK_FLUSH_EVENT = "file-playback-flush";

export interface PcmFileSessionKey {
  sessionId: number;
}

export interface PcmFilePlaybackStarted {
  sessionId: number;
  durationSeconds: number;
  sampleRate: number;
  channels: number;
}

export interface PcmFilePlaybackPositionPayload extends PcmFileSessionKey {
  positionSeconds: number;
  durationSeconds: number;
  isPlaying: boolean;
}

export interface PcmFilePlaybackPcmPayload extends PcmFileSessionKey {
  channels: number;
  pcmB64: string;
}

export function isPcmFileSession(
  session: PcmFileSessionKey | null,
  payload: PcmFileSessionKey,
): boolean {
  return session !== null && session.sessionId === payload.sessionId;
}
