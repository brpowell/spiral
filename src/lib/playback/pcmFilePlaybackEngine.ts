import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
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

const pcmConfig = {
  ackCommand: "ack_file_playback_pcm",
  pcmEvent: PCM_FILE_PLAYBACK_PCM_EVENT,
  flushEvent: PCM_FILE_PLAYBACK_FLUSH_EVENT,
  matchSession: isPcmFileSession,
  getChannels: (payload: PcmFilePlaybackPcmPayload) => payload.channels,
  getPcmB64: (payload: PcmFilePlaybackPcmPayload) => payload.pcmB64,
} as const;

/**
 * Plays OGG/Opus/ALAC via Rust PCM streaming into a Web Audio worklet on the
 * shared analyser bus.
 */
export class PcmFilePlaybackEngine implements PlaybackEngine {
  readonly capabilities = PCM_FILE_CAPABILITIES;

  private current: PcmFileSessionKey | null = null;
  private filePath: string | null = null;
  private durationSeconds = 0;
  private lastPositionSeconds = 0;
  private lastPositionAtMs = 0;
  private playing = false;
  private volume = 1;
  private balance = 0;
  private muted = false;
  private endCallback: (() => void) | null = null;
  private listeners: Promise<UnlistenFn[]> | null = null;
  private readonly pcm = new PcmStreamPipeline(pcmConfig);

  private ensureListeners(): Promise<UnlistenFn[]> {
    this.listeners ??= Promise.all([
      listen<PcmFilePlaybackPositionPayload>(PCM_FILE_PLAYBACK_POSITION_EVENT, (event) => {
        if (!isPcmFileSession(this.current, event.payload)) return;
        this.lastPositionSeconds = event.payload.positionSeconds;
        this.lastPositionAtMs = performance.now();
        this.durationSeconds = event.payload.durationSeconds;
        this.playing = event.payload.isPlaying;
      }),
      listen<PcmFileSessionKey>(PCM_FILE_PLAYBACK_ENDED_EVENT, (event) => {
        if (!isPcmFileSession(this.current, event.payload)) return;
        this.playing = false;
        this.lastPositionSeconds = this.durationSeconds;
        this.endCallback?.();
      }),
    ]);
    return this.listeners;
  }

  async load(source: PlaybackSource): Promise<void> {
    if (source.kind !== "file") {
      throw new Error(`PcmFilePlaybackEngine cannot load source kind: ${source.kind}`);
    }

    await this.ensureListeners();
    this.pcm.destroy();
    this.current = null;
    this.filePath = source.path;

    try {
      const started = await invoke<PcmFilePlaybackStarted>("start_file_playback", {
        path: source.path,
      });

      const session = { sessionId: started.sessionId };
      await this.pcm.prepare(session, started.sampleRate, started.channels);
      this.pcm.setVolume(this.volume);
      this.pcm.setMuted(this.muted);
      this.pcm.setBalance(this.balance);

      this.current = session;
      this.durationSeconds = started.durationSeconds;
      this.lastPositionSeconds = 0;
      this.lastPositionAtMs = performance.now();
      this.playing = false;
    } catch (err) {
      void invoke("stop_file_playback");
      throw err;
    }
  }

  play(): void {
    if (!this.current) return;
    void this.pcm.resumeContext().then(() => {
      this.connectToOutputBus();
      this.playing = true;
      void invoke("resume_file_playback");
    });
  }

  pause(): void {
    if (!this.current) return;
    this.playing = false;
    void invoke("pause_file_playback");
  }

  seek(seconds: number): void {
    if (!this.current || !this.durationSeconds) return;
    const clamped = Math.max(0, Math.min(seconds, this.durationSeconds));
    this.lastPositionSeconds = clamped;
    this.lastPositionAtMs = performance.now();
    void invoke("seek_file_playback", { positionSeconds: clamped }).catch((err) => {
      console.error("PCM file seek failed:", err);
    });
  }

  getPositionSeconds(): number {
    if (!this.current) return 0;
    if (!this.playing) return this.lastPositionSeconds;
    const elapsed = (performance.now() - this.lastPositionAtMs) / 1000;
    return Math.min(this.lastPositionSeconds + elapsed, this.durationSeconds);
  }

  getDurationSeconds(): number {
    return this.current ? this.durationSeconds : 0;
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
    if (!this.current) {
      this.pcm.destroy();
      return;
    }
    this.current = null;
    this.filePath = null;
    this.playing = false;
    this.lastPositionSeconds = 0;
    this.durationSeconds = 0;
    this.pcm.destroy();
    void invoke("stop_file_playback");
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
      this.play();
      return { restarted: true, reloaded: true };
    } catch (err) {
      console.error("PCM file wake recovery reload failed:", err);
      return { restarted: false, reloaded: false };
    }
  }

  connectToOutputBus(): AnalyserNode | null {
    return this.pcm.connectToOutputBus();
  }

  async resumeAudioContext(): Promise<void> {
    await this.pcm.resumeContext();
  }
}
