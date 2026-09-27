import type { DeckId } from "./audioOutput";
import { PcmStreamPipeline, type PcmSeamCallbacks } from "./pcmStreamPipeline";
import {
  CD_PLAYBACK_FLUSH_EVENT,
  CD_PLAYBACK_PCM_EVENT,
  type CdPlaybackPcmPayload,
  type CdPlaybackSessionKey,
  isCdPlaybackSession,
} from "./cdPlaybackEvents";
import { CD_PCM_READ_AHEAD_SECONDS } from "./pcmStreamConstants";

const cdPcmConfig = {
  ackCommand: "ack_cd_playback_pcm",
  buildAckPayload: (session: CdPlaybackSessionKey, count: number) => ({
    sessionId: session.sessionId,
    count,
  }),
  pcmEvent: CD_PLAYBACK_PCM_EVENT,
  flushEvent: CD_PLAYBACK_FLUSH_EVENT,
  matchSession: isCdPlaybackSession,
  getChannels: (payload: CdPlaybackPcmPayload) => payload.channels,
  getPcmB64: (payload: CdPlaybackPcmPayload) => payload.pcmB64,
  // Shared context so dual CD decks share `currentFrame` for gapless splice
  // (CD 44.1 kHz content is resampled when the context rate differs).
  contextMode: "shared" as const,
  readAheadSeconds: CD_PCM_READ_AHEAD_SECONDS,
};

/** CD-specific wrapper around the shared PCM stream pipeline. */
export class CdPcmPipeline {
  private readonly pipeline = new PcmStreamPipeline<
    CdPlaybackSessionKey,
    CdPlaybackPcmPayload
  >(cdPcmConfig);

  setSeamCallbacks(seam: PcmSeamCallbacks): void {
    this.pipeline.setSeamCallbacks(seam);
  }

  setDeckId(deckId: DeckId): void {
    this.pipeline.setDeckId(deckId);
  }

  getDeckId(): DeckId {
    return this.pipeline.getDeckId();
  }

  async prepare(
    session: CdPlaybackSessionKey,
    sampleRate: number,
    channels: number,
  ): Promise<void> {
    await this.pipeline.prepare(session, sampleRate, channels);
  }

  gate(options?: { startWhenBuffered?: number }): void {
    this.pipeline.gate(options);
  }

  startAtFrame(frame: number): void {
    this.pipeline.startAtFrame(frame);
  }

  startNow(): void {
    this.pipeline.startNow();
  }

  signalEndOfStream(): void {
    this.pipeline.signalEndOfStream();
  }

  reannounceDrain(): void {
    this.pipeline.reannounceDrain();
  }

  async resumeContext(): Promise<void> {
    await this.pipeline.resumeContext();
  }

  getContextTime(): number {
    return this.pipeline.getContextTime();
  }

  getContextSampleRate(): number {
    return this.pipeline.getContextSampleRate();
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

  releaseForReuse(): void {
    this.pipeline.releaseForReuse();
  }

  destroy(): void {
    this.pipeline.destroy();
  }
}
