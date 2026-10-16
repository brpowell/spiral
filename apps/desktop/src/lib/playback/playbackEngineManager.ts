import { NativeCdPlaybackEngine } from "./nativeCdPlaybackEngine";
import { NativeFilePlaybackEngine } from "./nativeFilePlaybackEngine";
import type { PlaybackEngine, PlaybackSource } from "./types";

export class PlaybackEngineManager {
  private readonly fileEngine: NativeFilePlaybackEngine;
  private readonly cdEngine: NativeCdPlaybackEngine;
  private activeEngine: PlaybackEngine;

  constructor(
    fileEngine: NativeFilePlaybackEngine = new NativeFilePlaybackEngine(),
    cdEngine: NativeCdPlaybackEngine = new NativeCdPlaybackEngine(),
  ) {
    this.fileEngine = fileEngine;
    this.cdEngine = cdEngine;
    this.activeEngine = fileEngine;
  }

  private resolveEngine(source: PlaybackSource): PlaybackEngine {
    switch (source.kind) {
      case "file":
        return this.fileEngine;
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
    this.cdEngine.onEnd(callback);
  }

  onCdError(callback: Parameters<NativeCdPlaybackEngine["onError"]>[0]): void {
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
}
