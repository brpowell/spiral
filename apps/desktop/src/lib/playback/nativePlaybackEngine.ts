import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  registerNativeDeck,
  unregisterNativeDeck,
  type DeckId,
} from "./nativeDeckRegistry";
import { pushNativeEqualizer } from "./nativeEqualizer";
import {
  isNativeSession,
  type NativePlaybackStarted,
  type NativePositionPayload,
  type NativeSessionKey,
  type NativeTransport,
} from "./nativeTransport";
import type { PlaybackCapabilities, PlaybackSource } from "./types";

/**
 * Fixed headroom (-6 dB) under the volume slider, so a mid system volume is not
 * deafening at full app volume. The slider still spans silence to this ceiling.
 */
const MASTER_HEADROOM = 0.5;

const NATIVE_FILE_CAPABILITIES: PlaybackCapabilities = {
  seek: true,
  scrubPreview: true,
  gapless: true,
  visualizer: true,
};

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
/** A mid-track read failure reported by Rust (CD only today). */
export interface NativePlaybackError {
  driveId: string;
  trackNumber: number;
  message: string;
}

/**
 * Base for engines that play through the Rust audio output. The transport says
 * which commands and events belong to the medium (library files or CD).
 */
export class NativePlaybackEngine {
  readonly capabilities = NATIVE_FILE_CAPABILITIES;

  private current: NativeSessionKey | null = null;
  private durationSeconds = 0;
  private anchorSeconds = 0;
  private anchorAtMs = 0;
  private ignoreEventsUntilMs = 0;
  private playing = false;
  private volume = 1;
  private balance = 0;
  private muted = false;
  private crossfadeMix = 1;
  /** Linear mix ramp in flight (crossfade), in `performance.now()` terms. */
  private ramp: {
    from: number;
    to: number;
    startedAtMs: number;
    durationMs: number;
  } | null = null;
  private deckId: DeckId = "a";
  private endCallback: (() => void) | null = null;
  private startedCallback: (() => void) | null = null;
  /** Primed for a gapless splice: buffered in Rust, silent until it starts itself. */
  private gated = false;
  private listeners: Promise<UnlistenFn[]> | null = null;
  private loadGeneration = 0;
  private errorCallback: ((error: NativePlaybackError) => void) | null = null;

  constructor(private readonly transport: NativeTransport) {}

  setDeckId(deckId: DeckId): void {
    this.deckId = deckId;
  }

  getDeckId(): DeckId {
    return this.deckId;
  }

  private userGain(): number {
    return this.muted ? 0 : this.volume * MASTER_HEADROOM;
  }

  /** The crossfade mix right now, following a ramp in flight. */
  private currentMix(): number {
    const ramp = this.ramp;
    if (!ramp) return this.crossfadeMix;
    const elapsed = performance.now() - ramp.startedAtMs;
    if (elapsed >= ramp.durationMs) return ramp.to;
    return ramp.from + (ramp.to - ramp.from) * (elapsed / ramp.durationMs);
  }

  private pushGain(): void {
    if (!this.current) return;
    const sessionId = this.current.sessionId;
    const ramp = this.ramp;
    const remainingMs = ramp
      ? ramp.startedAtMs + ramp.durationMs - performance.now()
      : 0;
    if (ramp && remainingMs > 1) {
      // Volume changed mid-fade: keep the fade on schedule at the new level.
      void invoke(this.transport.commands.ramp, {
        sessionId,
        fromGain: this.userGain() * this.currentMix(),
        toGain: this.userGain() * ramp.to,
        durationMs: Math.round(remainingMs),
      }).catch((err) => console.error("Native gain ramp failed:", err));
      return;
    }
    this.ramp = null;
    void invoke(this.transport.commands.gain, {
      sessionId,
      gain: this.userGain() * this.crossfadeMix,
    }).catch((err) => console.error("Native gain update failed:", err));
  }

  private ensureListeners(): Promise<UnlistenFn[]> {
    this.listeners ??= Promise.all([
      listen<NativePositionPayload>(this.transport.events.position, (event) => {
        if (!isNativeSession(this.current, event.payload)) return;
        this.durationSeconds = event.payload.durationSeconds;
        this.playing = event.payload.isPlaying;
        if (performance.now() < this.ignoreEventsUntilMs) return;
        this.anchorSeconds = event.payload.positionSeconds;
        this.anchorAtMs = performance.now();
      }),
      listen<NativeSessionKey>(
        this.transport.events.gaplessStarted,
        (event) => {
          if (!isNativeSession(this.current, event.payload)) return;
          this.handleStarted();
        },
      ),
      listen<NativeSessionKey>(this.transport.events.ended, (event) => {
        if (!isNativeSession(this.current, event.payload)) return;
        // Rust only reports the end once the mixer has played the last sample.
        this.current = null;
        this.playing = false;
        this.anchorSeconds = this.durationSeconds;
        this.endCallback?.();
      }),
      ...this.errorListener(),
    ]);
    return this.listeners;
  }

  private errorListener(): Promise<UnlistenFn>[] {
    const name = this.transport.events.error;
    if (!name) return [];
    return [
      listen<NativeSessionKey & Partial<NativePlaybackError>>(name, (event) => {
        if (!isNativeSession(this.current, event.payload)) return;
        console.error("Native playback error:", event.payload.message);
        this.current = null;
        this.playing = false;
        this.errorCallback?.({
          driveId: event.payload.driveId ?? "",
          trackNumber: event.payload.trackNumber ?? 0,
          message: event.payload.message ?? "Failed to read audio data",
        });
      }),
    ];
  }

  onError(callback: ((error: NativePlaybackError) => void) | null): void {
    this.errorCallback = callback;
  }

  async load(source: PlaybackSource): Promise<void> {
    if (!this.transport.accepts(source)) {
      throw new Error(
        `Native ${this.transport.kind} engine cannot load source kind: ${source.kind}`,
      );
    }

    const generation = ++this.loadGeneration;
    this.gated = false;
    this.ramp = null;
    await this.ensureListeners();
    const previous = this.current?.sessionId ?? null;
    this.current = null;
    this.playing = false;
    if (previous !== null) {
      void invoke(this.transport.commands.stop, { sessionId: previous });
    }

    // The EQ bootstraps before the playback settings, so Rust may not have it yet.
    pushNativeEqualizer();
    const started = await invoke<NativePlaybackStarted>(
      this.transport.commands.start,
      this.transport.startArgs(source),
    );
    if (generation !== this.loadGeneration) {
      void invoke(this.transport.commands.stop, {
        sessionId: started.sessionId,
      });
      return;
    }

    this.current = { sessionId: started.sessionId };
    registerNativeDeck(this.deckId, this);
    this.durationSeconds = started.durationSeconds;
    this.anchorSeconds = 0;
    this.anchorAtMs = performance.now();
    this.ignoreEventsUntilMs = 0;
    this.pushGain();
    this.pushBalance();
  }

  async play(): Promise<void> {
    if (!this.current) return;
    this.gated = false;
    this.anchorSeconds = this.getPositionSeconds();
    this.anchorAtMs = performance.now();
    this.playing = true;
    await invoke(this.transport.commands.resume, {
      sessionId: this.current.sessionId,
    });
  }

  pause(): void {
    if (!this.current) return;
    this.anchorSeconds = this.getPositionSeconds();
    this.anchorAtMs = performance.now();
    this.playing = false;
    void invoke(this.transport.commands.pause, {
      sessionId: this.current.sessionId,
    });
  }

  seek(seconds: number): void {
    if (!this.current || !this.durationSeconds) return;
    const maxSeek =
      this.durationSeconds > this.transport.seekEndMarginSeconds
        ? this.durationSeconds - this.transport.seekEndMarginSeconds
        : this.durationSeconds;
    const clamped = Math.max(0, Math.min(seconds, maxSeek));
    this.anchorSeconds = clamped;
    this.anchorAtMs = performance.now();
    this.ignoreEventsUntilMs = this.anchorAtMs + SEEK_EVENT_QUIET_MS;
    void invoke(this.transport.commands.seek, {
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

  setBalance(balance: number): void {
    this.balance = Math.max(-1, Math.min(1, balance));
    this.pushBalance();
  }

  private pushBalance(): void {
    if (!this.current) return;
    void invoke(this.transport.commands.balance, {
      sessionId: this.current.sessionId,
      balance: this.balance,
    }).catch((err) => console.error("Native balance update failed:", err));
  }

  getBalance(): number {
    return this.balance;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.pushGain();
  }

  /** Jump to a mix, cancelling any fade in flight. */
  setCrossfadeMix(mix: number): void {
    this.crossfadeMix = Math.max(0, Math.min(1, mix));
    this.ramp = null;
    this.pushGain();
  }

  /**
   * Fade the mix linearly to `target`, starting from where it is now. Rust runs
   * the ramp per sample, so it stays smooth however busy the webview is.
   */
  rampCrossfadeMix(target: number, durationSec: number): void {
    const to = Math.max(0, Math.min(1, target));
    if (!(durationSec > 0)) {
      this.setCrossfadeMix(to);
      return;
    }
    const from = this.currentMix();
    this.crossfadeMix = to;
    this.ramp = {
      from,
      to,
      startedAtMs: performance.now(),
      durationMs: Math.round(durationSec * 1000),
    };
    if (!this.current) return;
    void invoke(this.transport.commands.ramp, {
      sessionId: this.current.sessionId,
      fromGain: this.userGain() * from,
      toGain: this.userGain() * to,
      durationMs: this.ramp.durationMs,
    }).catch((err) => console.error("Native gain ramp failed:", err));
  }

  release(): void {
    this.retire();
  }

  destroy(): void {
    this.retire();
  }

  private retire(): void {
    unregisterNativeDeck(this.deckId, this);
    this.ramp = null;
    this.loadGeneration += 1;
    this.gated = false;
    this.startedCallback = null;
    const sessionId = this.current?.sessionId ?? null;
    this.current = null;
    this.playing = false;
    this.anchorSeconds = 0;
    this.durationSeconds = 0;
    if (sessionId !== null) {
      void invoke(this.transport.commands.stop, { sessionId });
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
    void invoke(this.transport.commands.link, {
      fromSession: from,
      toSession: to,
    }).catch((err) => console.error("Native gapless link failed:", err));
  }

  onGaplessStarted(callback: () => void): void {
    this.startedCallback = callback;
  }

  /** Give up on the sample-accurate splice and start now. */
  forceGaplessStart(): void {
    if (!this.current) return;
    if (this.gated) {
      void invoke(this.transport.commands.resume, {
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
}
