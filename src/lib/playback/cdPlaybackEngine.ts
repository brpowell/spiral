import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { CdPcmPipeline } from "./cdPcmPipeline";
import {
  CD_PLAYBACK_ENDED_EVENT,
  CD_PLAYBACK_ERROR_EVENT,
  CD_PLAYBACK_POSITION_EVENT,
  type CdPlaybackStarted,
  type CdPlaybackPositionPayload,
  type CdPlaybackTrackKey,
  type CdPlaybackTrackPayload,
  isCdPlaybackTrack,
} from "./cdPlaybackEvents";
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
  gapless: false,
  visualizer: true,
  recoverAfterWake: false,
};

/**
 * Plays CD audio via Rust PCM streaming into a Web Audio worklet on the shared
 * analyser bus. Transport maps to Tauri commands; position comes from
 * `cd-playback-position` events (interpolated between pushes).
 */
export class CdPlaybackEngine implements PlaybackEngine {
  readonly capabilities = CD_CAPABILITIES;

  private current: CdPlaybackTrackKey | null = null;
  private durationSeconds = 0;
  private lastPositionSeconds = 0;
  private lastPositionAtMs = 0;
  private playing = false;
  private volume = 1;
  private balance = 0;
  private muted = false;
  private endCallback: (() => void) | null = null;
  private errorCallback: ((error: CdPlaybackStreamError) => void) | null = null;
  private listeners: Promise<UnlistenFn[]> | null = null;
  private readonly pcm = new CdPcmPipeline();

  private ensureListeners(): Promise<UnlistenFn[]> {
    this.listeners ??= Promise.all([
      listen<CdPlaybackPositionPayload>(CD_PLAYBACK_POSITION_EVENT, (event) => {
        if (!isCdPlaybackTrack(this.current, event.payload)) return;
        this.lastPositionSeconds = event.payload.positionSeconds;
        this.lastPositionAtMs = performance.now();
        this.durationSeconds = event.payload.durationSeconds;
        this.playing = event.payload.isPlaying;
      }),
      listen<CdPlaybackTrackPayload>(CD_PLAYBACK_ENDED_EVENT, (event) => {
        if (!isCdPlaybackTrack(this.current, event.payload)) return;
        this.playing = false;
        this.lastPositionSeconds = this.durationSeconds;
        this.endCallback?.();
      }),
      listen<CdPlaybackTrackPayload>(CD_PLAYBACK_ERROR_EVENT, (event) => {
        if (!isCdPlaybackTrack(this.current, event.payload)) return;
        console.error("CD playback error:", event.payload.message);
        this.playing = false;
        this.errorCallback?.({
          driveId: event.payload.driveId,
          trackNumber: event.payload.trackNumber,
          message: event.payload.message ?? "Failed to read CD audio data",
        });
      }),
    ]);
    return this.listeners;
  }

  async load(source: PlaybackSource): Promise<void> {
    if (source.kind !== "cd") {
      throw new Error(
        `CdPlaybackEngine cannot load source kind: ${source.kind}`,
      );
    }

    await this.ensureListeners();
    this.pcm.destroy();
    this.current = null;

    const track = {
      driveId: source.driveId,
      trackNumber: source.trackNumber,
    };

    try {
      const started = await invoke<CdPlaybackStarted>("start_cd_playback", {
        driveId: track.driveId,
        trackNumber: track.trackNumber,
      });

      await this.pcm.prepare(track, started.sampleRate, started.channels);
      this.pcm.setVolume(this.volume);
      this.pcm.setMuted(this.muted);

      this.current = track;
      this.durationSeconds = started.durationSeconds;
      this.lastPositionSeconds = 0;
      this.lastPositionAtMs = performance.now();
      this.playing = false;
    } catch (err) {
      void invoke("stop_cd_playback");
      throw err;
    }
  }

  play(): void {
    if (!this.current) return;
    void this.pcm.resumeContext().then(() => {
      this.connectToOutputBus();
      this.playing = true;
      void invoke("resume_cd_playback");
    });
  }

  pause(): void {
    if (!this.current) return;
    this.playing = false;
    void invoke("pause_cd_playback");
  }

  seek(seconds: number): void {
    if (!this.current || !this.durationSeconds) return;
    const clamped = Math.max(0, Math.min(seconds, this.durationSeconds));
    this.lastPositionSeconds = clamped;
    this.lastPositionAtMs = performance.now();
    void invoke("seek_cd_playback", { positionSeconds: clamped }).catch(
      (err) => {
        console.error("CD seek failed:", err);
      },
    );
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
    if (!this.current) {
      this.pcm.destroy();
      return;
    }
    this.current = null;
    this.playing = false;
    this.lastPositionSeconds = 0;
    this.durationSeconds = 0;
    this.pcm.destroy();
    void invoke("stop_cd_playback");
  }

  async recover(_options: RecoverOptions): Promise<RecoverResult> {
    return { restarted: false, reloaded: false };
  }

  connectToOutputBus(): AnalyserNode | null {
    return this.pcm.connectToOutputBus();
  }

  async resumeAudioContext(): Promise<void> {
    await this.pcm.resumeContext();
  }
}
