export type PlaybackSource =
  | { kind: "file"; path: string }
  | { kind: "cd"; driveId: string; trackNumber: number }
  | { kind: "remote"; url: string; mimeType?: string };

export interface PlaybackCapabilities {
  seek: boolean;
  scrubPreview: boolean;
  gapless: boolean;
  visualizer: boolean;
  recoverAfterWake: boolean;
}

export interface RecoverOptions {
  wasPlaying: boolean;
  positionSeconds: number;
  source: PlaybackSource | null;
}

export interface RecoverResult {
  restarted: boolean;
  reloaded: boolean;
  /** Playback was already outputting; no pause/seek/play restart needed. */
  alreadyHealthy?: boolean;
}

export interface PlaybackEngine {
  readonly capabilities: PlaybackCapabilities;

  load(source: PlaybackSource): Promise<void>;
  play(): void;
  pause(): void;
  /** Seek to an absolute position in seconds. */
  seek(seconds: number): void;
  getPositionSeconds(): number;
  getDurationSeconds(): number;
  isPlaying(): boolean;

  setVolume(volume: number): void;
  getVolume(): number;
  setMuted(muted: boolean): void;

  onEnd(callback: () => void): void;
  destroy(): void;

  recover(options: RecoverOptions): Promise<RecoverResult>;

  /** Route engine audio through the shared output bus (analyser → destination). */
  connectToOutputBus(): AnalyserNode | null;
}
