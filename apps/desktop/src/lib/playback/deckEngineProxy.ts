import type { DualDeckEngine } from "./crossfadeController";
import type { DeckId } from "./audioOutput";
import { isNativeAudioEnabled } from "./nativeAudioFlag";
import type {
  PlaybackCapabilities,
  PlaybackEngine,
  PlaybackSource,
  RecoverOptions,
  RecoverResult,
} from "./types";

export type DeckBackend = DualDeckEngine &
  PlaybackEngine & {
    resumeAudioContext(): Promise<void>;
    onError?(callback: ((error: DeckStreamError) => void) | null): void;
  };

export interface DeckStreamError {
  driveId: string;
  trackNumber: number;
  message: string;
}

type Backend = DeckBackend;

const DEFAULT_CAPABILITIES: PlaybackCapabilities = {
  seek: true,
  scrubPreview: true,
  gapless: false,
  visualizer: false,
  recoverAfterWake: false,
};

/**
 * Deck engine that picks its backend (webview PCM or native output) the first
 * time a source loads. Engines are constructed at module import, before the
 * playback settings have bootstrapped, so the choice cannot be made earlier.
 * Configuration set before then is replayed onto the backend.
 */
export abstract class DeckEngineProxy
  implements DualDeckEngine, PlaybackEngine
{
  private backend: Backend | null = null;
  private native = false;
  private deckId: DeckId = "a";
  private volume = 1;
  private balance = 0;
  private muted = false;
  private crossfadeMix = 1;
  private endCallback: (() => void) | null = null;
  private errorCallback: ((error: DeckStreamError) => void) | null = null;
  private drainAtCallback: ((frame: number) => void) | null = null;
  private startedCallback: (() => void) | null = null;

  protected abstract createWebviewBackend(): DeckBackend;
  protected abstract createNativeBackend(): DeckBackend;

  get capabilities(): PlaybackCapabilities {
    return this.backend?.capabilities ?? DEFAULT_CAPABILITIES;
  }

  private createBackend(native: boolean): Backend {
    const backend = native
      ? this.createNativeBackend()
      : this.createWebviewBackend();
    this.native = native;
    backend.setDeckId(this.deckId);
    backend.setVolume(this.volume);
    backend.setBalance(this.balance);
    backend.setMuted(this.muted);
    backend.setCrossfadeMix(this.crossfadeMix);
    if (this.endCallback) backend.onEnd(this.endCallback);
    if (this.errorCallback) backend.onError?.(this.errorCallback);
    if (this.drainAtCallback) backend.onDrainAt(this.drainAtCallback);
    if (this.startedCallback) backend.onGaplessStarted(this.startedCallback);
    return backend;
  }

  /** True when this deck plays through the native output. */
  isNative(): boolean {
    return this.backend !== null && this.native;
  }

  async load(source: PlaybackSource): Promise<void> {
    const wantsNative = isNativeAudioEnabled();
    if (this.backend && this.isNative() !== wantsNative) {
      this.backend.destroy();
      this.backend = null;
    }
    this.backend ??= this.createBackend(wantsNative);
    await this.backend.load(source);
  }

  play(): void | Promise<void> {
    return this.backend?.play();
  }

  pause(): void {
    this.backend?.pause();
  }

  seek(seconds: number): void {
    this.backend?.seek(seconds);
  }

  getPositionSeconds(): number {
    return this.backend?.getPositionSeconds() ?? 0;
  }

  getDurationSeconds(): number {
    return this.backend?.getDurationSeconds() ?? 0;
  }

  isPlaying(): boolean {
    return this.backend?.isPlaying() ?? false;
  }

  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    this.backend?.setVolume(this.volume);
  }

  getVolume(): number {
    return this.volume;
  }

  setBalance(balance: number): void {
    this.balance = Math.max(-1, Math.min(1, balance));
    this.backend?.setBalance(this.balance);
  }

  getBalance(): number {
    return this.balance;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.backend?.setMuted(muted);
  }

  setDeckId(deckId: DeckId): void {
    this.deckId = deckId;
    this.backend?.setDeckId(deckId);
  }

  getDeckId(): DeckId {
    return this.deckId;
  }

  setCrossfadeMix(mix: number): void {
    this.crossfadeMix = Math.max(0, Math.min(1, mix));
    this.backend?.setCrossfadeMix(this.crossfadeMix);
  }

  connectToOutputBus(options?: { applyMix?: boolean }): AnalyserNode | null {
    return this.backend?.connectToOutputBus(options) ?? null;
  }

  release(): void {
    this.backend?.release();
  }

  destroy(): void {
    this.backend?.destroy();
  }

  onEnd(callback: () => void): void {
    this.endCallback = callback;
    this.backend?.onEnd(callback);
  }

  /** Stream read failures (CD). Replayed onto the backend when it exists. */
  onError(callback: ((error: DeckStreamError) => void) | null): void {
    this.errorCallback = callback;
    this.backend?.onError?.(callback);
  }

  primeGaplessStart(): Promise<void> {
    return this.backend?.primeGaplessStart() ?? Promise.resolve();
  }

  scheduleStartAtFrame(frame: number): void {
    this.backend?.scheduleStartAtFrame(frame);
  }

  forceGaplessStart(): void {
    this.backend?.forceGaplessStart();
  }

  onDrainAt(callback: (frame: number) => void): void {
    this.drainAtCallback = callback;
    this.backend?.onDrainAt(callback);
  }

  onGaplessStarted(callback: () => void): void {
    this.startedCallback = callback;
    this.backend?.onGaplessStarted(callback);
  }

  isEndOfStreamPending(): boolean {
    return this.backend?.isEndOfStreamPending() ?? false;
  }

  reannounceDrain(): void {
    this.backend?.reannounceDrain();
  }

  getSessionId(): number | null {
    return this.backend?.getSessionId?.() ?? null;
  }

  armGaplessSuccessor(incoming: DualDeckEngine): void {
    // The mixer links backend sessions, not this wrapper.
    const target =
      incoming instanceof DeckEngineProxy ? incoming.backend : incoming;
    if (target) this.backend?.armGaplessSuccessor?.(target);
  }

  async recover(options: RecoverOptions): Promise<RecoverResult> {
    return (
      (await this.backend?.recover(options)) ?? {
        restarted: false,
        reloaded: false,
      }
    );
  }

  async resumeAudioContext(): Promise<void> {
    await this.backend?.resumeAudioContext();
  }
}
