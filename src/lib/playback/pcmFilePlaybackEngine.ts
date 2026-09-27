import { Channel, invoke } from "@tauri-apps/api/core";
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
  PCM_FILE_PLAYBACK_POSITION_EVENT,
  type PcmFilePlaybackPositionPayload,
  type PcmFilePlaybackStarted,
  type PcmFileSessionKey,
  isPcmFileSession,
} from "./pcmFilePlaybackEvents";
import { FILE_PCM_READ_AHEAD_SECONDS } from "./pcmStreamConstants";
import {
  closeReplacedPcmAudioContext,
  recreateSharedPcmAudioContextSync,
  sharedPcmContextNeedsRebuild,
  unlockAudioContext,
} from "./pcmSharedContext";
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
 * disconnected). Must outlast worst-case worklet FIFO (read-ahead plus a full
 * Rust in-flight burst after upsample).
 */
const DRAIN_FALLBACK_MS = 6_500;

const pcmConfig = {
  ackCommand: "ack_file_playback_pcm",
  buildAckPayload: (session: PcmFileSessionKey, count: number) => ({
    sessionId: session.sessionId,
    count,
  }),
  flushEvent: PCM_FILE_PLAYBACK_FLUSH_EVENT,
  matchSession: isPcmFileSession,
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
  /**
   * Source position that was audible at `anchorContextTime`. While
   * `anchorContextTime` is null the transport is restarting (load, seek, resume)
   * and this value *is* the playhead — it holds until the worklet reports the
   * frame on which it resumed emitting samples.
   */
  private anchorSourceSeconds = 0;
  private anchorContextTime: number | null = null;
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
      onPlaybackAnchor: (frame) => {
        this.handlePlaybackAnchor(frame);
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
          // The reported position is the *decoder* cursor. It leads audible
          // output by the worklet FIFO depth, which swings by over a second
          // whenever the buffer refills, so it must never drive the playhead —
          // only duration and transport state come from here.
          if (this.gated) return;
          this.playing = event.payload.isPlaying;
        },
      ),
      listen<PcmFileSessionKey>(PCM_FILE_PLAYBACK_ENDED_EVENT, (event) => {
        if (!isPcmFileSession(this.current, event.payload)) return;
        // Rust removes the session on natural end; drop the local key so seek
        // does not target a dead session id.
        this.current = null;
        // Decoder is done but the worklet still holds ~read-ahead of PCM. Keep
        // the audible clock running so gapless preload sees real remaining time
        // instead of snapping to duration (which made remaining=0 too early).
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
    // Deliberately leaves the anchor alone: a primed deck is already at source
    // position 0 from load(), and the worklet posts its `playbackAnchor` for
    // this same render block *before* this `started` message. Resetting here
    // would discard that anchor, and no replacement is ever sent.
    if (this.endOfStreamPending) this.armDrainFallback();
    this.startedCallback?.();
  }

  /**
   * The worklet emitted its first sample after a transport restart, so
   * `anchorSourceSeconds` became audible exactly at `frame`. From here the
   * playhead is pure context-clock arithmetic — no further correction, and no
   * way for it to move backwards.
   */
  private handlePlaybackAnchor(frame: number): void {
    const sampleRate = this.pcm.getContextSampleRate();
    if (!sampleRate) return;
    this.anchorContextTime = frame / sampleRate;
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
    this.pcm.releaseForReuse();
    this.current = null;
    this.filePath = source.path;

    if (previousSessionId !== null) {
      void invoke("stop_file_playback", { sessionId: previousSessionId });
    }

    let startedSessionId: number | null = null;
    try {
      // Raw f32 chunks arrive on this channel as ArrayBuffers. The session key
      // is bound once `start` resolves; Rust starts paused, so nothing is sent
      // before then, and anything after a later load() is dropped by pushPcm.
      const session: PcmFileSessionKey = { sessionId: -1 };
      let channelCount = 2;
      const pcmChannel = new Channel<ArrayBuffer>((buffer) => {
        this.pcm.pushPcm(session, new Float32Array(buffer), channelCount);
      });
      const started = await invoke<PcmFilePlaybackStarted>(
        "start_file_playback",
        {
          path: source.path,
          pcm: pcmChannel,
        },
      );
      startedSessionId = started.sessionId;
      session.sessionId = started.sessionId;
      channelCount = started.channels;

      if (generation !== this.loadGeneration) {
        void invoke("stop_file_playback", { sessionId: started.sessionId });
        return;
      }

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
      this.anchorSourceSeconds = 0;
      this.anchorContextTime = null;
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
    const rebuild = sharedPcmContextNeedsRebuild();
    try {
      if (rebuild) {
        const ctx = recreateSharedPcmAudioContextSync();
        await ctx.resume();
        unlockAudioContext(ctx);
        await this.reloadCurrentFileAtPosition();
      }
      if (!this.current) return;
      const sessionId = this.current.sessionId;
      await this.pcm.resumeContext();
      // Connect only — do not re-apply mix (that cancels crossfade ramps).
      this.connectToOutputBus();
      this.pcm.startNow();
      this.gated = false;
      this.playing = true;
      await invoke("resume_file_playback", { sessionId });
    } finally {
      if (rebuild) closeReplacedPcmAudioContext();
    }
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

  isEndOfStreamPending(): boolean {
    return this.endOfStreamPending;
  }

  reannounceDrain(): void {
    this.pcm.reannounceDrain();
  }

  pause(): void {
    if (!this.current) return;
    // Freeze the playhead where it is; the context clock keeps running while
    // the worklet is gated, so it cannot stay the time base across a pause.
    this.anchorSourceSeconds = this.getPositionSeconds();
    this.anchorContextTime = null;
    this.playing = false;
    // Hold the worklet FIFO so pause is instant and resume has PCM ready.
    // Do not set this.gated — that flag means "primed, never started" and
    // would zero getPositionSeconds().
    this.pcm.gate();
    void invoke("pause_file_playback", { sessionId: this.current.sessionId });
  }

  seek(seconds: number): void {
    if (!this.current || !this.durationSeconds) return;
    const maxSeek =
      this.durationSeconds > SEEK_END_MARGIN_SECONDS
        ? this.durationSeconds - SEEK_END_MARGIN_SECONDS
        : this.durationSeconds;
    const clamped = Math.max(0, Math.min(seconds, maxSeek));
    // Hold the target until the worklet flushes and reports the frame the new
    // position becomes audible. Anchoring on the current clock instead would
    // start counting during the ~100ms of pre-seek audio still in the FIFO.
    this.anchorSourceSeconds = clamped;
    this.anchorContextTime = null;
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
    if (this.anchorContextTime === null) {
      return this.anchorSourceSeconds;
    }
    // After decoder EOS the Rust session reports not-playing, but the worklet
    // tail is still audible — keep the context clock until drained.
    if (!this.playing && !this.endOfStreamPending) {
      return this.anchorSourceSeconds;
    }
    const elapsed = this.pcm.getContextTime() - this.anchorContextTime;
    const duration = this.durationSeconds > 0 ? this.durationSeconds : Infinity;
    return Math.min(this.anchorSourceSeconds + Math.max(0, elapsed), duration);
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

  /** Stop this deck's file and keep its audio nodes for the next track. */
  release(): void {
    this.retire(false);
  }

  destroy(): void {
    this.retire(true);
  }

  private retire(destroyNodes: boolean): void {
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
    this.anchorSourceSeconds = 0;
    this.anchorContextTime = null;
    this.durationSeconds = 0;
    if (destroyNodes) this.pcm.destroy();
    else this.pcm.releaseForReuse();
    disconnectDeckOutput(this.deckId);
    if (sessionId !== null) {
      void invoke("stop_file_playback", { sessionId });
    }
  }

  async recover(options: RecoverOptions): Promise<RecoverResult> {
    // PCM keeps outputting while the window is hidden; tearing down a live
    // session to reload is what caused the refocus hitch. After sleep the
    // context can sit at `running` with a frozen clock — rebuild on play()
    // so resume() runs inside a user gesture.
    if (sharedPcmContextNeedsRebuild()) {
      return {
        restarted: false,
        reloaded: false,
        alreadyHealthy: options.wasPlaying,
      };
    }
    if (options.wasPlaying && this.current !== null) {
      await this.pcm.resumeContext();
      return { restarted: false, reloaded: false, alreadyHealthy: true };
    }
    return { restarted: false, reloaded: false };
  }

  async resumeAudioContext(): Promise<void> {
    await this.pcm.resumeContext();
  }

  private async reloadCurrentFileAtPosition(
    positionSeconds = this.getPositionSeconds(),
  ): Promise<void> {
    const path = this.filePath;
    if (!path) return;
    await this.load({ kind: "file", path });
    const duration = this.getDurationSeconds();
    const clamped =
      positionSeconds > 0 && duration > 0
        ? Math.min(positionSeconds, duration)
        : 0;
    if (clamped > 0) {
      this.seek(clamped);
    }
  }
}
