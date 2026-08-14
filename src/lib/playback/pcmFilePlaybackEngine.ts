import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  disconnectDeckOutput,
  getDeckGainNode,
  setDeckGain,
  type DeckId,
} from "./audioOutput";
import { PcmStreamPipeline } from "./pcmStreamPipeline";
import {
  PCM_FILE_PLAYBACK_ENDED_EVENT,
  PCM_FILE_PLAYBACK_FLUSH_EVENT,
  PCM_FILE_PLAYBACK_PCM_EVENT,
  PCM_FILE_PLAYBACK_POSITION_EVENT,
  type PcmFilePlaybackPositionPayload,
  type PcmFilePlaybackPcmPayload,
  type PcmFilePlaybackStarted,
  type PcmFileSessionKey,
  isPcmFileSession,
} from "./pcmFilePlaybackEvents";
import { PositionSeekGuard } from "./positionSeekGuard";
import { FILE_PCM_READ_AHEAD_SECONDS } from "./pcmStreamConstants";
import type {
  PlaybackCapabilities,
  PlaybackEngine,
  PlaybackSource,
  RecoverOptions,
  RecoverResult,
} from "./types";

const PCM_FILE_CAPABILITIES: PlaybackCapabilities = {
  seek: true,
  scrubPreview: true,
  /** Sample-accurate dual-deck splice when crossfade is off; lossy files also trim tagged encoder delay. */
  gapless: true,
  visualizer: true,
  recoverAfterWake: false,
};

/** Match Rust `SEEK_END_MARGIN_SECONDS` — Symphonia rejects exact-EOS seeks. */
const SEEK_END_MARGIN_SECONDS = 0.05;

/**
 * Safety net if the worklet never reports its drain (e.g. the node was
 * disconnected). Must outlast maxBufferFrames (read-ahead + in-flight burst).
 */
const DRAIN_FALLBACK_MS = 3500;

const pcmConfig = {
  ackCommand: "ack_file_playback_pcm",
  buildAckPayload: (session: PcmFileSessionKey, count: number) => ({
    sessionId: session.sessionId,
    count,
  }),
  pcmEvent: PCM_FILE_PLAYBACK_PCM_EVENT,
  flushEvent: PCM_FILE_PLAYBACK_FLUSH_EVENT,
  matchSession: isPcmFileSession,
  getChannels: (payload: PcmFilePlaybackPcmPayload) => payload.channels,
  getPcmB64: (payload: PcmFilePlaybackPcmPayload) => payload.pcmB64,
  contextMode: "shared" as const,
  readAheadSeconds: FILE_PCM_READ_AHEAD_SECONDS,
};

/**
 * Plays library files via Rust PCM streaming into a Web Audio worklet on the
 * shared analyser bus. Two instances can overlap for crossfade.
 */
export class PcmFilePlaybackEngine implements PlaybackEngine {
  readonly capabilities = PCM_FILE_CAPABILITIES;

  private current: PcmFileSessionKey | null = null;
  private filePath: string | null = null;
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
  private drainAtCallback: ((frame: number) => void) | null = null;
  private startedCallback: (() => void) | null = null;
  private drainFallbackTimer: ReturnType<typeof setTimeout> | null = null;
  /** Decoder is done; the worklet tail has not finished playing yet. */
  private endOfStreamPending = false;
  /** Primed but held silent by the worklet until its scheduled start frame. */
  private gated = false;
  private listeners: Promise<UnlistenFn[]> | null = null;
  private loadGeneration = 0;
  private readonly pcm = new PcmStreamPipeline(pcmConfig);

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

  /** Crossfade mix (0–1) on the deck gain; user volume is on the pipeline gain. */
  setCrossfadeMix(mix: number): void {
    this.crossfadeMix = Math.max(0, Math.min(1, mix));
    if (getDeckGainNode(this.deckId)) {
      setDeckGain(this.deckId, this.crossfadeMix);
    }
  }

  private ensureListeners(): Promise<UnlistenFn[]> {
    this.listeners ??= Promise.all([
      listen<PcmFilePlaybackPositionPayload>(
        PCM_FILE_PLAYBACK_POSITION_EVENT,
        (event) => {
          if (!isPcmFileSession(this.current, event.payload)) return;
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
        },
      ),
      listen<PcmFileSessionKey>(PCM_FILE_PLAYBACK_ENDED_EVENT, (event) => {
        if (!isPcmFileSession(this.current, event.payload)) return;
        this.playing = false;
        this.lastPositionSeconds = this.durationSeconds;
        // Rust removes the session on natural end; drop the local key so seek
        // does not target a dead session id.
        this.current = null;
        // The decoder is exhausted but the worklet still holds up to a second of
        // PCM. Let it play out — cutting here truncates the tail mid-waveform.
        this.endOfStreamPending = true;
        this.pcm.signalEndOfStream();
        // A gated deck cannot drain yet; it gets its fallback once it starts.
        if (!this.gated) this.armDrainFallback();
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
    // Audible playback begins at the start of the primed buffer (track 0), not
    // at load-time / decode-ahead. Reset the interpolator so handoff UI does
    // not jump to ~GAPLESS_PRELOAD_HEADROOM_SECONDS.
    this.lastPositionSeconds = 0;
    this.lastPositionAtMs = performance.now();
    if (this.endOfStreamPending) this.armDrainFallback();
    this.startedCallback?.();
  }

  private handleDrained(): void {
    this.finishEndOfStream();
  }

  async load(source: PlaybackSource): Promise<void> {
    if (source.kind !== "file") {
      throw new Error(
        `PcmFilePlaybackEngine cannot load source kind: ${source.kind}`,
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
    this.filePath = source.path;

    if (previousSessionId !== null) {
      void invoke("stop_file_playback", { sessionId: previousSessionId });
    }

    let startedSessionId: number | null = null;
    try {
      const started = await invoke<PcmFilePlaybackStarted>(
        "start_file_playback",
        {
          path: source.path,
        },
      );
      startedSessionId = started.sessionId;

      if (generation !== this.loadGeneration) {
        void invoke("stop_file_playback", { sessionId: started.sessionId });
        return;
      }

      const session = { sessionId: started.sessionId };
      this.pcm.setDeckId(this.deckId);
      await this.pcm.prepare(session, started.sampleRate, started.channels);
      if (generation !== this.loadGeneration) {
        void invoke("stop_file_playback", { sessionId: started.sessionId });
        return;
      }
      this.pcm.setVolume(this.volume);
      this.pcm.setMuted(this.muted);
      this.pcm.setBalance(this.balance);

      this.current = session;
      this.durationSeconds = started.durationSeconds;
      this.lastPositionSeconds = 0;
      this.lastPositionAtMs = performance.now();
      this.positionSeekGuard.clear();
      this.playing = false;
    } catch (err) {
      if (startedSessionId !== null && generation === this.loadGeneration) {
        void invoke("stop_file_playback", { sessionId: startedSessionId });
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
    // Connect only — do not re-apply mix (that cancels crossfade ramps).
    this.connectToOutputBus();
    this.pcm.startNow();
    this.gated = false;
    this.playing = true;
    await invoke("resume_file_playback", { sessionId });
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
    await invoke("resume_file_playback", { sessionId });
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

  pause(): void {
    if (!this.current) return;
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
    this.lastPositionSeconds = clamped;
    this.lastPositionAtMs = performance.now();
    this.positionSeekGuard.noteSeek(clamped);
    void invoke("seek_file_playback", {
      sessionId: this.current.sessionId,
      positionSeconds: clamped,
    }).catch((err) => {
      console.error("PCM file seek failed:", err);
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
    this.filePath = null;
    this.playing = false;
    this.lastPositionSeconds = 0;
    this.durationSeconds = 0;
    this.positionSeekGuard.clear();
    this.pcm.destroy();
    disconnectDeckOutput(this.deckId);
    if (sessionId !== null) {
      void invoke("stop_file_playback", { sessionId });
    }
  }

  async recover(options: RecoverOptions): Promise<RecoverResult> {
    const filePath =
      options.source?.kind === "file" ? options.source.path : this.filePath;
    if (!filePath || !options.wasPlaying) {
      return { restarted: false, reloaded: false };
    }

    try {
      await this.load({ kind: "file", path: filePath });
      const duration = this.getDurationSeconds();
      const positionSeconds =
        options.positionSeconds > 0 && duration > 0
          ? Math.min(options.positionSeconds, duration)
          : 0;
      if (positionSeconds > 0) {
        this.seek(positionSeconds);
      }
      await this.play();
      return { restarted: true, reloaded: true };
    } catch (err) {
      console.error("PCM file wake recovery reload failed:", err);
      return { restarted: false, reloaded: false };
    }
  }

  async resumeAudioContext(): Promise<void> {
    await this.pcm.resumeContext();
  }
}
