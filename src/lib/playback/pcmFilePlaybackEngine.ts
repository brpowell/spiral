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
  gapless: false,
  visualizer: true,
  recoverAfterWake: false,
};

/** Match Rust `SEEK_END_MARGIN_SECONDS` — Symphonia rejects exact-EOS seeks. */
const SEEK_END_MARGIN_SECONDS = 0.05;

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
  private listeners: Promise<UnlistenFn[]> | null = null;
  private loadGeneration = 0;
  private readonly pcm = new PcmStreamPipeline(pcmConfig);

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
        this.endCallback?.();
      }),
    ]);
    return this.listeners;
  }

  async load(source: PlaybackSource): Promise<void> {
    if (source.kind !== "file") {
      throw new Error(
        `PcmFilePlaybackEngine cannot load source kind: ${source.kind}`,
      );
    }

    const generation = ++this.loadGeneration;
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
    this.playing = true;
    await invoke("resume_file_playback", { sessionId });
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
