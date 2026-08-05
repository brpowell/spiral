import { getAnalyser as getOutputAnalyser } from "./audioOutput";
import {
  crossfadeController,
  type CrossfadeVisualState,
} from "./crossfadeController";
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
export { canHowlerCrossfade, effectiveFadeSeconds } from "./canCrossfade";
export {
  CrossfadeController,
  crossfadeController,
  type CrossfadeHandoff,
  type CrossfadeScheduleContext,
  type CrossfadeVisualState,
} from "./crossfadeController";
export {
  cdTrackNumberFromListId,
  isCdTrackListId,
  playableRefFromTrackListId,
  resolvePlaybackSource,
  trackListIdForPlayable,
} from "./playable";
export { PlaybackEngineManager } from "./playbackEngineManager";

const manager = new PlaybackEngineManager();

export function isCrossfadeControllerActive(): boolean {
  return crossfadeController.isControllerActive();
}

export function isCrossfadeInProgress(): boolean {
  return crossfadeController.isCrossfadeInProgress();
}

export function getCrossfadeIncomingTrackId(): number | null {
  return crossfadeController.getCrossfadeIncomingTrackId();
}

export function getCrossfadeVisualState(): CrossfadeVisualState | null {
  return crossfadeController.getCrossfadeVisualState();
}

export function consumeCrossfadeHandledEnd(): boolean {
  return crossfadeController.consumeHandledEnd();
}

export function crossfadeDeactivate(): void {
  crossfadeController.deactivate();
}

export interface CrossfadeLoadOptions {
  volume: number;
  muted: boolean;
  balance: number;
}

export async function crossfadeLoadAndPlay(
  source: PlaybackSource,
  options: CrossfadeLoadOptions,
): Promise<void> {
  manager.unload();
  await crossfadeController.loadAndPlay(source, options);
}

export function maybeScheduleCrossfade(
  ctx: import("./crossfadeController").CrossfadeScheduleContext,
): void {
  crossfadeController.maybeScheduleCrossfade(ctx);
}

export function startCrossfadeNow(
  ctx: import("./crossfadeController").CrossfadeScheduleContext,
): void {
  crossfadeController.startCrossfadeNow(ctx);
}

export function fadeOutAndStop(fadeSec: number, onComplete: () => void): void {
  crossfadeController.fadeOutAndStop(fadeSec, onComplete);
}

/** @deprecated Prefer RecoverOptions with a PlaybackSource. */
export interface RecoverAfterWakeOptions {
  wasPlaying: boolean;
  positionSeconds: number;
  filePath: string | null;
}

export interface RecoverAfterWakeResult {
  restarted: boolean;
  reloaded: boolean;
  alreadyHealthy?: boolean;
}

export function load(path: string): Promise<void> {
  return manager.loadFile(path);
}

export async function loadSource(source: PlaybackSource): Promise<void> {
  crossfadeDeactivate();
  return manager.load(source);
}

export function unload(): void {
  crossfadeDeactivate();
  manager.unload();
}

export function play(): void {
  if (isCrossfadeControllerActive()) {
    crossfadeController.play();
    return;
  }
  manager.play();
}

export function pause(): void {
  if (isCrossfadeControllerActive()) {
    crossfadeController.pause();
    return;
  }
  manager.pause();
}

export function seek(ratio: number): void {
  if (isCrossfadeControllerActive()) {
    crossfadeController.seekRatio(ratio);
    return;
  }
  manager.seekRatio(ratio);
}

export function getPositionSeconds(): number {
  if (isCrossfadeControllerActive()) {
    return crossfadeController.getPositionSeconds();
  }
  return manager.getPositionSeconds();
}

export function getDurationSeconds(): number {
  if (isCrossfadeControllerActive()) {
    return crossfadeController.getDurationSeconds();
  }
  return manager.getDurationSeconds();
}

export function isPlaying(): boolean {
  if (isCrossfadeControllerActive()) {
    return crossfadeController.isPlaying();
  }
  return manager.isPlaying();
}

export function onEnd(callback: () => void): void {
  manager.onEnd(callback);
  crossfadeController.onEnd(callback);
}

export function onCdError(
  callback: Parameters<PlaybackEngineManager["onCdError"]>[0],
): void {
  manager.onCdError(callback);
}

export function setVolume(volume: number): void {
  if (isCrossfadeControllerActive()) {
    crossfadeController.setVolume(volume);
    return;
  }
  manager.setVolume(volume);
}

export function getVolume(): number {
  return manager.getVolume();
}

export function setBalance(balance: number): void {
  if (isCrossfadeControllerActive()) {
    crossfadeController.setBalance(balance);
    return;
  }
  manager.setBalance(balance);
}

export function getBalance(): number {
  return manager.getBalance();
}

export function setMuted(muted: boolean): void {
  if (isCrossfadeControllerActive()) {
    crossfadeController.setMuted(muted);
    return;
  }
  manager.setMuted(muted);
}

export async function resumeAudioContext(): Promise<void> {
  await manager.resumeAudioContext();
}

export function restartPlaybackAt(positionSeconds: number): void {
  if (isCrossfadeControllerActive()) {
    crossfadeController.getActiveEngine().restartPlaybackAt(positionSeconds);
    return;
  }
  manager.restartPlaybackAt(positionSeconds);
}

export async function recoverAfterWake(
  options: RecoverAfterWakeOptions,
): Promise<RecoverAfterWakeResult> {
  const recoverOptions = {
    wasPlaying: options.wasPlaying,
    positionSeconds: options.positionSeconds,
    source:
      options.filePath === null
        ? null
        : { kind: "file" as const, path: options.filePath },
  };

  if (isCrossfadeControllerActive()) {
    return crossfadeController.getActiveEngine().recover(recoverOptions);
  }

  return manager.recover(recoverOptions);
}

export function ensureAnalyser(): AnalyserNode | null {
  if (isCrossfadeControllerActive()) {
    return (
      crossfadeController.getActiveEngine().connectToOutputBus() ??
      getOutputAnalyser()
    );
  }
  return manager.connectToOutputBus() ?? getOutputAnalyser();
}
