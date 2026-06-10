import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { connectEngineOutput, disconnectEngineOutput } from "./audioOutput";
import {
  CD_PLAYBACK_FLUSH_EVENT,
  CD_PLAYBACK_PCM_EVENT,
  type CdPlaybackFlushPayload,
  type CdPlaybackPcmPayload,
  type CdPlaybackTrackKey,
  isCdPlaybackTrack,
} from "./cdPlaybackEvents";

const WORKLET_NAME = "cd-pcm-processor";

/** Decode base64 little-endian f32 interleaved PCM from Rust. */
export function decodePcmBase64(b64: string): Float32Array {
  const raw = atob(b64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    bytes[i] = raw.charCodeAt(i);
  }
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
}

/**
 * Web Audio pipeline for CD PCM: worklet pull → gain → shared analyser bus.
 * Back-pressure: the worklet posts `needData` when its buffer drops below a
 * low watermark; we ack Rust so it can emit more chunks.
 */
export class CdPcmPipeline {
  private ctx: AudioContext | null = null;
  private gain: GainNode | null = null;
  private worklet: AudioWorkletNode | null = null;
  private workletReady: Promise<void> | null = null;
  private track: CdPlaybackTrackKey | null = null;
  private chunksReceived = 0;
  private chunksAcked = 0;
  private listeners: Promise<UnlistenFn[]> | null = null;
  private volume = 1;
  private muted = false;

  private applyGain(): void {
    if (!this.gain) return;
    this.gain.gain.value = this.muted ? 0 : this.volume;
  }

  private maybeAck(): void {
    const pending = this.chunksReceived - this.chunksAcked;
    if (pending <= 0) return;
    this.chunksAcked += 1;
    void invoke("ack_cd_playback_pcm", { count: 1 });
  }

  private ensureListeners(): Promise<UnlistenFn[]> {
    this.listeners ??= Promise.all([
      listen<CdPlaybackPcmPayload>(CD_PLAYBACK_PCM_EVENT, (event) => {
        if (!isCdPlaybackTrack(this.track, event.payload) || !this.worklet) return;
        const samples = decodePcmBase64(event.payload.pcmB64);
        this.chunksReceived += 1;
        this.worklet.port.postMessage({
          type: "pcm",
          samples,
          channels: event.payload.channels,
        });
      }),
      listen<CdPlaybackFlushPayload>(CD_PLAYBACK_FLUSH_EVENT, (event) => {
        if (!isCdPlaybackTrack(this.track, event.payload) || !this.worklet) return;
        this.chunksReceived = 0;
        this.chunksAcked = 0;
        this.worklet.port.postMessage({ type: "flush" });
      }),
    ]);
    return this.listeners;
  }

  private async ensureAudio(
    sampleRate: number,
    channels: number,
  ): Promise<AudioContext> {
    if (!this.ctx) {
      this.ctx = new AudioContext({ sampleRate });
    } else if (this.ctx.sampleRate !== sampleRate) {
      await this.ctx.close();
      this.ctx = new AudioContext({ sampleRate });
      this.workletReady = null;
      this.worklet = null;
      this.gain = null;
    }

    if (!this.workletReady) {
      this.workletReady = (async () => {
        const url = new URL("./cdPcmProcessor.ts", import.meta.url);
        await this.ctx!.audioWorklet.addModule(url);
        this.worklet = new AudioWorkletNode(this.ctx!, WORKLET_NAME, {
          outputChannelCount: [channels],
        });
        this.worklet.port.onmessage = (event: MessageEvent<{ type: string }>) => {
          if (event.data.type === "needData") {
            this.maybeAck();
          }
        };
        this.gain = this.ctx!.createGain();
        this.applyGain();
        this.worklet.connect(this.gain);
      })();
    }

    await this.workletReady;
    this.worklet?.port.postMessage({ type: "configure", channels, sampleRate });
    return this.ctx;
  }

  async prepare(
    track: CdPlaybackTrackKey,
    sampleRate: number,
    channels: number,
  ): Promise<void> {
    await this.ensureListeners();
    this.destroyNodes();
    this.track = track;
    this.chunksReceived = 0;
    this.chunksAcked = 0;
    await this.ensureAudio(sampleRate, channels);
  }

  async resumeContext(): Promise<void> {
    if (!this.ctx || this.ctx.state === "running") return;
    try {
      await this.ctx.resume();
    } catch (err) {
      console.warn("CD AudioContext resume failed:", err);
    }
  }

  connectToOutputBus(): AnalyserNode | null {
    if (!this.gain) return null;
    return connectEngineOutput(this.gain);
  }

  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    this.applyGain();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyGain();
  }

  private destroyNodes(): void {
    if (this.worklet) {
      this.worklet.port.onmessage = null;
      this.worklet.disconnect();
      this.worklet = null;
    }
    if (this.gain) {
      this.gain.disconnect();
      this.gain = null;
    }
    this.workletReady = null;
  }

  /** Release Rust PCM back-pressure before tearing down the worklet. */
  releaseBackpressure(): void {
    const pending = this.chunksReceived - this.chunksAcked;
    if (pending <= 0) return;
    this.chunksAcked += pending;
    void invoke("ack_cd_playback_pcm", { count: pending });
  }

  destroy(): void {
    this.releaseBackpressure();
    this.destroyNodes();
    disconnectEngineOutput();
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
    }
    this.track = null;
    this.chunksReceived = 0;
    this.chunksAcked = 0;
  }
}
