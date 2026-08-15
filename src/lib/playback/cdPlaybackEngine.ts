import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  disconnectDeckOutput,
  getDeckGainNode,
  setDeckGain,
  type DeckId,
} from "./audioOutput";
import { CdPcmPipeline } from "./cdPcmPipeline";
import {
  CD_PLAYBACK_ENDED_EVENT,
  CD_PLAYBACK_ERROR_EVENT,
  CD_PLAYBACK_POSITION_EVENT,
  type CdPlaybackStarted,
  type CdPlaybackPositionPayload,
  type CdPlaybackTrackKey,
  type CdPlaybackTrackPayload,
  isCdPlaybackSession,
} from "./cdPlaybackEvents";
import { PositionSeekGuard } from "./positionSeekGuard";
import type {
  PlaybackCapabilities,
  PlaybackEngine,
  PlaybackSource,
  RecoverOptions,
  RecoverResult,
} from "./types";

export interface CdPlaybackStreamError {
  driveId: string;
  trackNumber: number;
  message: string;
}

const CD_CAPABILITIES: PlaybackCapabilities = {
  seek: true,
  scrubPreview: true,
  /** Sample-accurate dual-deck splice when crossfade is off. */
  gapless: true,
  visualizer: true,
  recoverAfterWake: false,
};

/**
 * Safety net if the worklet never reports its drain (e.g. the node was
 * disconnected). Must outlast the CD read-ahead tail still queued at EOS,
 * otherwise it truncates the end of the track.
 */
const DRAIN_FALLBACK_MS = 2500;

/**
 * Plays CD audio via Rust PCM streaming into a Web Audio worklet on the shared
 * analyser bus. Two instances can overlap for gapless handoff.
 */
export class CdPlaybackEngine implements PlaybackEngine {
  readonly capabilities = CD_CAPABILITIES;

  private current: CdPlaybackTrackKey | null = null;
  private durationSeconds = 0;
  private lastPositionSeconds = 0;
  private lastPositionAtMs = 0;
  private readonly positionSeekGuard = new PositionSeekGuard();
  private playing = false;
  private volume = 1;
  private balance = 0;
  private muted = false;
  private crossfadeMix = 1;
  private deckId: DeckId = "a";
  private endCallback: (() => void) | null = null;
  private errorCallback: ((error: CdPlaybackStreamError) => void) | null = null;
  private drainAtCallback: ((frame: number) => void) | null = null;
  private startedCallback: (() => void) | null = null;
  private drainFallbackTimer: ReturnType<typeof setTimeout> | null = null;
  /** Decoder is done; the worklet tail has not finished playing yet. */
  private endOfStreamPending = false;
  /** Primed but held silent by the worklet until its scheduled start frame. */
  private gated = false;
  private listeners: Promise<UnlistenFn[]> | null = null;
  private loadGeneration = 0;
  private readonly pcm = new CdPcmPipeline();

  constructor() {
    this.pcm.setSeamCallbacks({
      onDrainAt: (frame) => {
        this.drainAtCallback?.(frame);
      },
      onDrained: () => {
        this.handleDrained();
      },
      onStarted: () => {
        this.handleStarted();
      },
    });
  }

  setDeckId(deckId: DeckId): void {
    this.deckId = deckId;
    this.pcm.setDeckId(deckId);
  }

  getDeckId(): DeckId {
    return this.deckId;
  }

  /** Crossfade / handoff mix (0–1) on the deck gain; user volume is on the pipeline. */
  setCrossfadeMix(mix: number): void {
    this.crossfadeMix = Math.max(0, Math.min(1, mix));
    if (getDeckGainNode(this.deckId)) {
      setDeckGain(this.deckId, this.crossfadeMix);
    }
  }

  private ensureListeners(): Promise<UnlistenFn[]> {
    this.listeners ??= Promise.all([
      listen<CdPlaybackPositionPayload>(CD_PLAYBACK_POSITION_EVENT, (event) => {
        if (!isCdPlaybackSession(this.current, event.payload)) return;
        this.durationSeconds = event.payload.durationSeconds;
        // Gated priming decodes ahead of audible start — ignore decode cursor
        // and isPlaying so the UI does not interpolate from load time.
        if (this.gated) return;
        this.playing = event.payload.isPlaying;
        if (
          !this.positionSeekGuard.shouldAccept(event.payload.positionSeconds)
        ) {
          return;
        }
        this.lastPositionSeconds = event.payload.positionSeconds;
        this.lastPositionAtMs = performance.now();
      }),
      listen<CdPlaybackTrackPayload>(CD_PLAYBACK_ENDED_EVENT, (event) => {
        if (!isCdPlaybackSession(this.current, event.payload)) return;
        this.playing = false;
        this.lastPositionSeconds = this.durationSeconds;
        // Rust removes the session on natural end; drop the local key so seek
        // does not target a dead session id.
        this.current = null;
        this.endOfStreamPending = true;
        this.pcm.signalEndOfStream();
        if (!this.gated) this.armDrainFallback();
      }),
      listen<CdPlaybackTrackPayload>(CD_PLAYBACK_ERROR_EVENT, (event) => {
        if (!isCdPlaybackSession(this.current, event.payload)) return;
        console.error("CD playback error:", event.payload.message);
        this.playing = false;
        this.current = null;
        this.errorCallback?.({
          driveId: event.payload.driveId,
          trackNumber: event.payload.trackNumber,
          message: event.payload.message ?? "Failed to read CD audio data",
        });
      }),
    ]);
    return this.listeners;
  }

  private armDrainFallback(): void {
    this.clearDrainFallback();
    this.drainFallbackTimer = setTimeout(() => {
      this.drainFallbackTimer = null;
      this.finishEndOfStream();
    }, DRAIN_FALLBACK_MS);
  }

  private clearDrainFallback(): void {
    if (this.drainFallbackTimer === null) return;
    clearTimeout(this.drainFallbackTimer);
    this.drainFallbackTimer = null;
  }

  private finishEndOfStream(): void {
    if (!this.endOfStreamPending) return;
    this.endOfStreamPending = false;
    this.clearDrainFallback();
    this.endCallback?.();
  }

  private handleStarted(): void {
    this.gated = false;
    this.playing = true;
    this.lastPositionSeconds = 0;
    this.lastPositionAtMs = performance.now();
    if (this.endOfStreamPending) this.armDrainFallback();
    this.startedCallback?.();
  }

  private handleDrained(): void {
    this.finishEndOfStream();
  }

  async load(source: PlaybackSource): Promise<void> {
    if (source.kind !== "cd") {
      throw new Error(
        `CdPlaybackEngine cannot load source kind: ${source.kind}`,
      );
    }

    const generation = ++this.loadGeneration;
    this.clearDrainFallback();
    this.endOfStreamPending = false;
    this.gated = false;
    await this.ensureListeners();
    const previousSessionId = this.current?.sessionId ?? null;
    this.pcm.destroy();
    this.current = null;

    if (previousSessionId !== null) {
      void invoke("stop_cd_playback", { sessionId: previousSessionId });
    }

    let startedSessionId: number | null = null;
    try {
      const started = await invoke<CdPlaybackStarted>("start_cd_playback", {
        driveId: source.driveId,
        trackNumber: source.trackNumber,
      });
      startedSessionId = started.sessionId;

      if (generation !== this.loadGeneration) {
        void invoke("stop_cd_playback", { sessionId: started.sessionId });
        return;
      }

      const track: CdPlaybackTrackKey = {
        sessionId: started.sessionId,
        driveId: source.driveId,
        trackNumber: source.trackNumber,
      };

      this.pcm.setDeckId(this.deckId);
      await this.pcm.prepare(track, started.sampleRate, started.channels);
      if (generation !== this.loadGeneration) {
        void invoke("stop_cd_playback", { sessionId: started.sessionId });
        return;
      }
      this.pcm.setVolume(this.volume);
      this.pcm.setMuted(this.muted);
      this.pcm.setBalance(this.balance);

      this.current = track;
      this.durationSeconds = started.durationSeconds;
      this.lastPositionSeconds = 0;
      this.lastPositionAtMs = performance.now();
      this.positionSeekGuard.clear();
      this.playing = false;
    } catch (err) {
      if (startedSessionId !== null && generation === this.loadGeneration) {
        void invoke("stop_cd_playback", { sessionId: startedSessionId });
      }
      if (generation !== this.loadGeneration) return;
      throw err;
    }
  }

  /**
   * Route into the shared mixer.
   * When `applyMix` is true, forces the current crossfade mix onto the deck gain
   * (cancels any in-flight ramp). Default applies mix only on first connect so
   * later `play()` calls do not wipe crossfade ramps.
   */
  connectToOutputBus(options?: { applyMix?: boolean }): AnalyserNode | null {
    const hadGain = getDeckGainNode(this.deckId) !== null;
    const analyser = this.pcm.connectToOutputBus();
    if (!hadGain || options?.applyMix === true) {
      this.setCrossfadeMix(this.crossfadeMix);
    }
    return analyser;
  }

  async play(): Promise<void> {
    if (!this.current) return;
    const sessionId = this.current.sessionId;
    await this.pcm.resumeContext();
    this.connectToOutputBus();
    this.pcm.startNow();
    this.gated = false;
    this.playing = true;
    await invoke("resume_cd_playback", { sessionId });
  }

  /**
   * Decode and buffer silently so a scheduled splice has no start latency.
   * The worklet holds the PCM without consuming it until `scheduleStartAtFrame`.
   */
  async primeGaplessStart(): Promise<void> {
    if (!this.current) return;
    const sessionId = this.current.sessionId;
    await this.pcm.resumeContext();
    this.gated = true;
    this.pcm.gate();
    await invoke("resume_cd_playback", { sessionId });
  }

  /** Begin playing at an absolute frame on the shared context clock. */
  scheduleStartAtFrame(frame: number): void {
    this.pcm.startAtFrame(frame);
  }

  /** Give up on the scheduled frame and start on the next render block. */
  forceGaplessStart(): void {
    this.pcm.startNow();
    this.handleStarted();
  }

  onDrainAt(callback: (frame: number) => void): void {
    this.drainAtCallback = callback;
  }

  onGaplessStarted(callback: () => void): void {
    this.startedCallback = callback;
  }

  isEndOfStreamPending(): boolean {
    return this.endOfStreamPending;
  }

  reannounceDrain(): void {
    this.pcm.reannounceDrain();
  }

  pause(): void {
    if (!this.current) return;
    this.playing = false;
    // Hold the worklet FIFO so pause is instant and resume has PCM ready.
    // Do not set this.gated — that flag means "primed, never started" and
    // would zero getPositionSeconds().
    this.pcm.gate();
    void invoke("pause_cd_playback", { sessionId: this.current.sessionId });
  }

  seek(seconds: number): void {
    if (!this.current || !this.durationSeconds) return;
    const clamped = Math.max(0, Math.min(seconds, this.durationSeconds));
    this.lastPositionSeconds = clamped;
    this.lastPositionAtMs = performance.now();
    this.positionSeekGuard.noteSeek(clamped);
    void invoke("seek_cd_playback", {
      sessionId: this.current.sessionId,
      positionSeconds: clamped,
    }).catch((err) => {
      console.error("CD seek failed:", err);
    });
  }

  getPositionSeconds(): number {
    // Primed but silent — audible transport has not started.
    if (this.gated) return 0;
    if (!this.playing) return this.lastPositionSeconds;
    const elapsed = (performance.now() - this.lastPositionAtMs) / 1000;
    const duration = this.durationSeconds > 0 ? this.durationSeconds : Infinity;
    return Math.min(this.lastPositionSeconds + elapsed, duration);
  }

  getDurationSeconds(): number {
    return this.durationSeconds;
  }

  isPlaying(): boolean {
    return this.playing;
  }

  onEnd(callback: () => void): void {
    this.endCallback = callback;
  }

  onError(callback: ((error: CdPlaybackStreamError) => void) | null): void {
    this.errorCallback = callback;
  }

  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    this.pcm.setVolume(this.volume);
  }

  getVolume(): number {
    return this.volume;
  }

  setBalance(balance: number): void {
    this.balance = Math.max(-1, Math.min(1, balance));
    this.pcm.setBalance(this.balance);
  }

  getBalance(): number {
    return this.balance;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.pcm.setMuted(this.muted);
  }

  destroy(): void {
    this.loadGeneration += 1;
    this.clearDrainFallback();
    this.endOfStreamPending = false;
    this.gated = false;
    this.drainAtCallback = null;
    this.startedCallback = null;
    const sessionId = this.current?.sessionId ?? null;
    this.current = null;
    this.playing = false;
    this.lastPositionSeconds = 0;
    this.durationSeconds = 0;
    this.positionSeekGuard.clear();
    this.pcm.destroy();
    disconnectDeckOutput(this.deckId);
    if (sessionId !== null) {
      void invoke("stop_cd_playback", { sessionId });
    }
  }

  async recover(_options: RecoverOptions): Promise<RecoverResult> {
    return { restarted: false, reloaded: false };
  }

  async resumeAudioContext(): Promise<void> {
    await this.pcm.resumeContext();
  }
}
