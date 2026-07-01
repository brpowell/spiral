import { PcmStreamPipeline } from "./pcmStreamPipeline";
import {
  CD_PLAYBACK_FLUSH_EVENT,
  CD_PLAYBACK_PCM_EVENT,
  type CdPlaybackPcmPayload,
  type CdPlaybackTrackKey,
  isCdPlaybackTrack,
} from "./cdPlaybackEvents";

const cdPcmConfig = {
  ackCommand: "ack_cd_playback_pcm",
  pcmEvent: CD_PLAYBACK_PCM_EVENT,
  flushEvent: CD_PLAYBACK_FLUSH_EVENT,
  matchSession: isCdPlaybackTrack,
  getChannels: (payload: CdPlaybackPcmPayload) => payload.channels,
  getPcmB64: (payload: CdPlaybackPcmPayload) => payload.pcmB64,
} as const;

/** CD-specific wrapper around the shared PCM stream pipeline. */
export class CdPcmPipeline {
  private readonly pipeline = new PcmStreamPipeline<
    CdPlaybackTrackKey,
    CdPlaybackPcmPayload
  >(cdPcmConfig);

  async prepare(
    track: CdPlaybackTrackKey,
    sampleRate: number,
    channels: number,
  ): Promise<void> {
    await this.pipeline.prepare(track, sampleRate, channels);
  }

  async resumeContext(): Promise<void> {
    await this.pipeline.resumeContext();
  }

  connectToOutputBus(): AnalyserNode | null {
    return this.pipeline.connectToOutputBus();
  }

  setVolume(volume: number): void {
    this.pipeline.setVolume(volume);
  }

  setBalance(balance: number): void {
    this.pipeline.setBalance(balance);
  }

  setMuted(muted: boolean): void {
    this.pipeline.setMuted(muted);
  }

  releaseBackpressure(): void {
    this.pipeline.releaseBackpressure();
  }

  destroy(): void {
    this.pipeline.destroy();
  }
}
