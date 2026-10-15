import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { DeckId } from "./audioOutput";
import {
  PCM_FILE_PLAYBACK_ENDED_EVENT,
  PCM_FILE_PLAYBACK_GAPLESS_STARTED_EVENT,
  PCM_FILE_PLAYBACK_POSITION_EVENT,
  type PcmFilePlaybackPositionPayload,
  type PcmFilePlaybackStarted,
  type PcmFileSessionKey,
  isPcmFileSession,
} from "./pcmFilePlaybackEvents";
import type {
  PlaybackCapabilities,
  PlaybackSource,
  RecoverOptions,
  RecoverResult,
} from "./types";

/** Native output reaches crossfade, EQ and the visualizer in later steps. */
const NATIVE_FILE_CAPABILITIES: PlaybackCapabilities = {
  seek: true,
  scrubPreview: true,
  gapless: true,
  visualizer: false,
  recoverAfterWake: false,
};

/** Match Rust `SEEK_END_MARGIN_SECONDS` — Symphonia rejects exact-EOS seeks. */
const SEEK_END_MARGIN_SECONDS = 0.05;

/**
 * After a seek, position events still in flight describe the old position.
 * Ignore them for this long so the playhead never jumps back.
 */
const SEEK_EVENT_QUIET_MS = 600;

/**
 * Plays library files through the Rust audio output (cpal) instead of a webview
 * `AudioContext`. Rust decodes, mixes and owns the device, so playback is
 * unaffected by the webview's audio state across sleep/wake.
 *
 * The playhead is extrapolated from the last position Rust reported, which is
 * the position the mixer has actually consumed (not the decoder cursor).
 */
export class NativeFilePlaybackEngine {
  readonly capabilities = NATIVE_FILE_CAPABILITIES;

  private current: PcmFileSessionKey | null = null;
  private durationSeconds = 0;
  private anchorSeconds = 0;
  private anchorAtMs = 0;
  private ignoreEventsUntilMs = 0;
  private playing = false;
  private volume = 1;
  private balance = 0;
  private muted = false;
  private crossfadeMix = 1;
  private deckId: DeckId = "a";
  private endCallback: (() => void) | null = null;
  private startedCallback: (() => void) | null = null;
  /** Primed for a gapless splice: buffered in Rust, silent until it starts itself. */
  private gated = false;
  private listeners: Promise<UnlistenFn[]> | null = null;
  private loadGeneration = 0;

  setDeckId(deckId: DeckId): void {
    this.deckId = deckId;
  }

  getDeckId(): DeckId {
    return this.deckId;
  }

  private effectiveGain(): number {
    return this.muted ? 0 : this.volume * this.crossfadeMix;
  }

  private pushGain(): void {
    if (!this.current) return;
    void invoke("set_file_playback_gain", {
      sessionId: this.current.sessionId,
      gain: this.effectiveGain(),
    }).catch((err) => console.error("Native gain update failed:", err));
  }

  private ensureListeners(): Promise<UnlistenFn[]> {
    this.listeners ??= Promise.all([
      listen<PcmFilePlaybackPositionPayload>(
        PCM_FILE_PLAYBACK_POSITION_EVENT,
        (event) => {
          if (!isPcmFileSession(this.current, event.payload)) return;
          this.durationSeconds = event.payload.durationSeconds;
          this.playing = event.payload.isPlaying;
          if (performance.now() < this.ignoreEventsUntilMs) return;
          this.anchorSeconds = event.payload.positionSeconds;
          this.anchorAtMs = performance.now();
        },
      ),
      listen<PcmFileSessionKey>(
        PCM_FILE_PLAYBACK_GAPLESS_STARTED_EVENT,
        (event) => {
          if (!isPcmFileSession(this.current, event.payload)) return;
          this.handleStarted();
        },
      ),
      listen<PcmFileSessionKey>(PCM_FILE_PLAYBACK_ENDED_EVENT, (event) => {
        if (!isPcmFileSession(this.current, event.payload)) return;
        // Rust only reports the end once the mixer has played the last sample.
        this.current = null;
        this.playing = false;
        this.anchorSeconds = this.durationSeconds;
        this.endCallback?.();
      }),
    ]);
    return this.listeners;
  }

  async load(source: PlaybackSource): Promise<void> {
    if (source.kind !== "file") {
      throw new Error(
        `NativeFilePlaybackEngine cannot load source kind: ${source.kind}`,
      );
    }

    const generation = ++this.loadGeneration;
    this.gated = false;
    await this.ensureListeners();
    const previous = this.current?.sessionId ?? null;
    this.current = null;
    this.playing = false;
    if (previous !== null) {
      void invoke("stop_file_playback", { sessionId: previous });
    }

    const started = await invoke<PcmFilePlaybackStarted>(
      "start_native_file_playback",
      { path: source.path },
    );
    if (generation !== this.loadGeneration) {
      void invoke("stop_file_playback", { sessionId: started.sessionId });
      return;
    }

    this.current = { sessionId: started.sessionId };
    this.durationSeconds = started.durationSeconds;
    this.anchorSeconds = 0;
    this.anchorAtMs = performance.now();
    this.ignoreEventsUntilMs = 0;
    this.pushGain();
  }

  async play(): Promise<void> {
    if (!this.current) return;
    this.gated = false;
    this.anchorSeconds = this.getPositionSeconds();
    this.anchorAtMs = performance.now();
    this.playing = true;
    await invoke("resume_file_playback", {
      sessionId: this.current.sessionId,
    });
  }

  pause(): void {
    if (!this.current) return;
    this.anchorSeconds = this.getPositionSeconds();
    this.anchorAtMs = performance.now();
    this.playing = false;
    void invoke("pause_file_playback", { sessionId: this.current.sessionId });
  }

  seek(seconds: number): void {
    if (!this.current || !this.durationSeconds) return;
    const maxSeek =
      this.durationSeconds > SEEK_END_MARGIN_SECONDS
        ? this.durationSeconds - SEEK_END_MARGIN_SECONDS
        : this.durationSeconds;
    const clamped = Math.max(0, Math.min(seconds, maxSeek));
    this.anchorSeconds = clamped;
    this.anchorAtMs = performance.now();
    this.ignoreEventsUntilMs = this.anchorAtMs + SEEK_EVENT_QUIET_MS;
    void invoke("seek_file_playback", {
      sessionId: this.current.sessionId,
      positionSeconds: clamped,
    }).catch((err) => {
      console.error("Native file seek failed:", err);
    });
  }

  getPositionSeconds(): number {
    // Primed but silent — audible transport has not started.
    if (this.gated) return 0;
    if (!this.playing) return this.anchorSeconds;
    const elapsed = (performance.now() - this.anchorAtMs) / 1000;
    const duration = this.durationSeconds > 0 ? this.durationSeconds : Infinity;
    return Math.min(this.anchorSeconds + Math.max(0, elapsed), duration);
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

  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    this.pushGain();
  }

  getVolume(): number {
    return this.volume;
  }

  /** Stored only; balance joins the native mixer with EQ in a later step. */
  setBalance(balance: number): void {
    this.balance = Math.max(-1, Math.min(1, balance));
  }

  getBalance(): number {
    return this.balance;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.pushGain();
  }

  setCrossfadeMix(mix: number): void {
    this.crossfadeMix = Math.max(0, Math.min(1, mix));
    this.pushGain();
  }

  /** The native output has no Web Audio graph to route through. */
  connectToOutputBus(): AnalyserNode | null {
    return null;
  }

  release(): void {
    this.retire();
  }

  destroy(): void {
    this.retire();
  }

  private retire(): void {
    this.loadGeneration += 1;
    this.gated = false;
    this.startedCallback = null;
    const sessionId = this.current?.sessionId ?? null;
    this.current = null;
    this.playing = false;
    this.anchorSeconds = 0;
    this.durationSeconds = 0;
    if (sessionId !== null) {
      void invoke("stop_file_playback", { sessionId });
    }
  }

  getSessionId(): number | null {
    return this.current?.sessionId ?? null;
  }

  /**
   * The Rust session is already decoding into its ring while paused, so priming
   * only needs to keep the deck silent and the playhead at zero until the
   * mixer splices it in.
   */
  async primeGaplessStart(): Promise<void> {
    if (!this.current) return;
    this.gated = true;
    this.playing = false;
    this.anchorSeconds = 0;
  }

  /**
   * Ask Rust to start `incoming` on the exact sample this deck runs out. The
   * splice happens inside the audio callback, so no message round trip sits
   * between the last sample of one track and the first of the next.
   */
  armGaplessSuccessor(incoming: { getSessionId?(): number | null }): void {
    const from = this.current?.sessionId;
    const to = incoming.getSessionId?.();
    if (from === undefined || to === undefined || to === null) return;
    void invoke("link_gapless_playback", {
      fromSession: from,
      toSession: to,
    }).catch((err) => console.error("Native gapless link failed:", err));
  }

  /** Frame-scheduled splice does not exist here; Rust owns the timing. */
  scheduleStartAtFrame(_frame: number): void {}

  onDrainAt(_callback: (frame: number) => void): void {}

  onGaplessStarted(callback: () => void): void {
    this.startedCallback = callback;
  }

  /** Give up on the sample-accurate splice and start now. */
  forceGaplessStart(): void {
    if (!this.current) return;
    if (this.gated) {
      void invoke("resume_file_playback", {
        sessionId: this.current.sessionId,
      });
      this.handleStarted();
    }
  }

  private handleStarted(): void {
    if (!this.gated && this.playing) return;
    this.gated = false;
    this.playing = true;
    this.anchorSeconds = 0;
    this.anchorAtMs = performance.now();
    this.startedCallback?.();
  }

  isEndOfStreamPending(): boolean {
    return false;
  }

  reannounceDrain(): void {}

  /** Rust owns the device and rebuilds it itself; nothing to repair here. */
  async recover(options: RecoverOptions): Promise<RecoverResult> {
    return {
      restarted: false,
      reloaded: false,
      alreadyHealthy: options.wasPlaying && this.current !== null,
    };
  }

  async resumeAudioContext(): Promise<void> {}
}
