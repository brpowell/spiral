import type { CdPlaybackEngine } from "./cdPlaybackEngine";
import { CdPlaybackEngine as CdPlaybackEngineImpl } from "./cdPlaybackEngine";
import type { FilePlaybackEngine } from "./fileDeckEngine";
import { FilePlaybackEngine as FilePlaybackEngineImpl } from "./fileDeckEngine";
import type {
  PlaybackEngine,
  PlaybackSource,
  RecoverOptions,
  RecoverResult,
} from "./types";

export class PlaybackEngineManager {
  private readonly pcmFileEngine: FilePlaybackEngine;
  private readonly cdEngine: CdPlaybackEngine;
  private activeEngine: PlaybackEngine;

  constructor(
    pcmFileEngine: FilePlaybackEngine = new FilePlaybackEngineImpl(),
    cdEngine: CdPlaybackEngine = new CdPlaybackEngineImpl(),
  ) {
    this.pcmFileEngine = pcmFileEngine;
    this.cdEngine = cdEngine;
    this.activeEngine = pcmFileEngine;
  }

  private resolveEngine(source: PlaybackSource): PlaybackEngine {
    switch (source.kind) {
      case "file":
        return this.pcmFileEngine;
      case "cd":
        return this.cdEngine;
      case "remote":
        throw new Error(
          `Playback not implemented for source kind: ${source.kind}`,
        );
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
    this.activeEngine = this.pcmFileEngine;
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
    this.pcmFileEngine.onEnd(callback);
    this.cdEngine.onEnd(callback);
  }

  onCdError(callback: Parameters<CdPlaybackEngine["onError"]>[0]): void {
    this.cdEngine.onError(callback);
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
    await this.pcmFileEngine.resumeAudioContext();
    await this.cdEngine.resumeAudioContext();
  }

  restartPlaybackAt(positionSeconds: number): void {
    this.activeEngine.seek(positionSeconds);
    this.activeEngine.play();
  }
}
