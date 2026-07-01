import type { CdPlaybackEngine } from "./cdPlaybackEngine";
import { CdPlaybackEngine as CdPlaybackEngineImpl } from "./cdPlaybackEngine";
import type { FilePlaybackEngine } from "./filePlaybackEngine";
import { FilePlaybackEngine as FilePlaybackEngineImpl } from "./filePlaybackEngine";
import type { PcmFilePlaybackEngine } from "./pcmFilePlaybackEngine";
import { PcmFilePlaybackEngine as PcmFilePlaybackEngineImpl } from "./pcmFilePlaybackEngine";
import { requiresPcmPlayback } from "../supportedAudio";
import type {
  PlaybackEngine,
  PlaybackSource,
  RecoverOptions,
  RecoverResult,
} from "./types";

export class PlaybackEngineManager {
  private readonly fileEngine: FilePlaybackEngine;
  private readonly pcmFileEngine: PcmFilePlaybackEngine;
  private readonly cdEngine: CdPlaybackEngine;
  private activeEngine: PlaybackEngine;

  constructor(
    fileEngine: FilePlaybackEngine = new FilePlaybackEngineImpl(),
    pcmFileEngine: PcmFilePlaybackEngine = new PcmFilePlaybackEngineImpl(),
    cdEngine: CdPlaybackEngine = new CdPlaybackEngineImpl(),
  ) {
    this.fileEngine = fileEngine;
    this.pcmFileEngine = pcmFileEngine;
    this.cdEngine = cdEngine;
    this.activeEngine = fileEngine;
  }

  private resolveEngine(source: PlaybackSource): PlaybackEngine {
    switch (source.kind) {
      case "file":
        if (requiresPcmPlayback(source.path)) {
          return this.pcmFileEngine;
        }
        return this.fileEngine;
      case "cd":
        return this.cdEngine;
      case "remote":
        throw new Error(`Playback not implemented for source kind: ${source.kind}`);
    }
  }

  async load(source: PlaybackSource): Promise<void> {
    const engine = this.resolveEngine(source);
    if (engine !== this.activeEngine) {
      this.activeEngine.destroy();
      this.activeEngine = engine;
    }
    await engine.load(source);
  }

  async loadFile(path: string): Promise<void> {
    await this.load({ kind: "file", path });
  }

  unload(): void {
    this.activeEngine.destroy();
    this.activeEngine = this.fileEngine;
  }

  play(): void {
    this.activeEngine.play();
  }

  pause(): void {
    this.activeEngine.pause();
  }

  seek(seconds: number): void {
    this.activeEngine.seek(seconds);
  }

  seekRatio(ratio: number): void {
    const duration = this.activeEngine.getDurationSeconds();
    if (!duration || !Number.isFinite(duration)) return;
    this.activeEngine.seek(Math.max(0, Math.min(1, ratio)) * duration);
  }

  getPositionSeconds(): number {
    return this.activeEngine.getPositionSeconds();
  }

  getDurationSeconds(): number {
    return this.activeEngine.getDurationSeconds();
  }

  isPlaying(): boolean {
    return this.activeEngine.isPlaying();
  }

  onEnd(callback: () => void): void {
    this.fileEngine.onEnd(callback);
    this.pcmFileEngine.onEnd(callback);
    this.cdEngine.onEnd(callback);
  }

  setVolume(volume: number): void {
    this.activeEngine.setVolume(volume);
  }

  getVolume(): number {
    return this.activeEngine.getVolume();
  }

  setBalance(balance: number): void {
    this.activeEngine.setBalance(balance);
  }

  getBalance(): number {
    return this.activeEngine.getBalance();
  }

  setMuted(muted: boolean): void {
    this.activeEngine.setMuted(muted);
  }

  connectToOutputBus(): AnalyserNode | null {
    return this.activeEngine.connectToOutputBus();
  }

  async recover(options: RecoverOptions): Promise<RecoverResult> {
    return this.activeEngine.recover(options);
  }

  async resumeAudioContext(): Promise<void> {
    await this.fileEngine.resumeAudioContext();
    await this.pcmFileEngine.resumeAudioContext();
    await this.cdEngine.resumeAudioContext();
  }

  restartPlaybackAt(positionSeconds: number): void {
    if (this.activeEngine === this.fileEngine) {
      this.fileEngine.restartPlaybackAt(positionSeconds);
    }
  }
}
