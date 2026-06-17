import { getAnalyser as getOutputAnalyser } from "./audioOutput";
import { PlaybackEngineManager } from "./playbackEngineManager";
import type { PlaybackSource } from "./types";

export type {
  PlaybackCapabilities,
  PlaybackEngine,
  PlaybackSource,
  RecoverOptions,
  RecoverResult,
} from "./types";

export {
  ANALYSER_FFT_SIZE,
  ANALYSER_FREQUENCY_BIN_COUNT,
  connectEngineOutput,
  disconnectEngineOutput,
  getAnalyser,
} from "./audioOutput";
export { CdPlaybackEngine } from "./cdPlaybackEngine";
export { FilePlaybackEngine } from "./filePlaybackEngine";
export {
  cdTrackNumberFromListId,
  isCdTrackListId,
  playableRefFromTrackListId,
  resolvePlaybackSource,
  trackListIdForPlayable,
} from "./playable";
export { PlaybackEngineManager } from "./playbackEngineManager";

const manager = new PlaybackEngineManager();

/** @deprecated Prefer RecoverOptions with a PlaybackSource. */
export interface RecoverAfterWakeOptions {
  wasPlaying: boolean;
  positionSeconds: number;
  filePath: string | null;
}

export interface RecoverAfterWakeResult {
  restarted: boolean;
  reloaded: boolean;
}

export function load(path: string): Promise<void> {
  return manager.loadFile(path);
}

export function loadSource(source: PlaybackSource): Promise<void> {
  return manager.load(source);
}

export function unload(): void {
  manager.unload();
}

export function play(): void {
  manager.play();
}

export function pause(): void {
  manager.pause();
}

export function seek(ratio: number): void {
  manager.seekRatio(ratio);
}

export function getPositionSeconds(): number {
  return manager.getPositionSeconds();
}

export function getDurationSeconds(): number {
  return manager.getDurationSeconds();
}

export function isPlaying(): boolean {
  return manager.isPlaying();
}

export function onEnd(callback: () => void): void {
  manager.onEnd(callback);
}

export function setVolume(volume: number): void {
  manager.setVolume(volume);
}

export function getVolume(): number {
  return manager.getVolume();
}

export function setMuted(muted: boolean): void {
  manager.setMuted(muted);
}

export async function resumeAudioContext(): Promise<void> {
  await manager.resumeAudioContext();
}

export function restartPlaybackAt(positionSeconds: number): void {
  manager.restartPlaybackAt(positionSeconds);
}

export async function recoverAfterWake(
  options: RecoverAfterWakeOptions,
): Promise<RecoverAfterWakeResult> {
  return manager.recover({
    wasPlaying: options.wasPlaying,
    positionSeconds: options.positionSeconds,
    source:
      options.filePath === null
        ? null
        : { kind: "file", path: options.filePath },
  });
}

export function ensureAnalyser(): AnalyserNode | null {
  return manager.connectToOutputBus() ?? getOutputAnalyser();
}
