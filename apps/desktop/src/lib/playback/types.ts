export type PlaybackSource =
  | { kind: "file"; path: string; codec?: string | null }
  | { kind: "cd"; driveId: string; trackNumber: number }
  | { kind: "remote"; url: string; mimeType?: string };

export interface PlaybackCapabilities {
  seek: boolean;
  scrubPreview: boolean;
  gapless: boolean;
  visualizer: boolean;
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
  setBalance(balance: number): void;
  getBalance(): number;
  setMuted(muted: boolean): void;

  onEnd(callback: () => void): void;
  destroy(): void;
}
