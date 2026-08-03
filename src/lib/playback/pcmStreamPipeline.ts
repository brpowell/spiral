import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { connectEngineOutput, disconnectEngineOutput } from "./audioOutput";
import { decodePcmBase64 } from "./pcmDecode";
import { PCM_STREAM_PROCESSOR_NAME } from "./pcmStreamConstants";
// Vite must emit a real JS chunk (`?worker&url`). Plain `new URL(..., import.meta.url)`
// inlines the .ts as a data: URL, which production CSP script-src blocks.
import pcmStreamProcessorUrl from "./pcmStreamProcessor.ts?worker&url";

export interface PcmStreamConfig<TSession, TPcm extends TSession> {
  ackCommand: string;
  pcmEvent: string;
  flushEvent: string;
  matchSession: (session: TSession | null, payload: TSession) => boolean;
  getChannels: (payload: TPcm) => number;
  getPcmB64: (payload: TPcm) => string;
}

/**
 * Web Audio pipeline for Rust PCM streams: worklet pull → gain → shared analyser bus.
 */
export class PcmStreamPipeline<TSession, TPcm extends TSession> {
  private readonly config: PcmStreamConfig<TSession, TPcm>;

  private ctx: AudioContext | null = null;
  private gain: GainNode | null = null;
  private panner: StereoPannerNode | null = null;
  private worklet: AudioWorkletNode | null = null;
  private workletReady: Promise<void> | null = null;
  private session: TSession | null = null;
  private chunksReceived = 0;
  private chunksAcked = 0;
  private listeners: Promise<UnlistenFn[]> | null = null;
  private volume = 1;
  private balance = 0;
  private muted = false;

  constructor(config: PcmStreamConfig<TSession, TPcm>) {
    this.config = config;
  }

  private applyGain(): void {
    if (!this.gain) return;
    this.gain.gain.value = this.muted ? 0 : this.volume;
  }

  private applyBalance(): void {
    if (!this.panner) return;
    this.panner.pan.value = this.balance;
  }

  private maybeAck(): void {
    const pending = this.chunksReceived - this.chunksAcked;
    if (pending <= 0) return;
    this.chunksAcked += 1;
    void invoke(this.config.ackCommand, { count: 1 });
  }

  private ensureListeners(): Promise<UnlistenFn[]> {
    this.listeners ??= Promise.all([
      listen<TPcm>(this.config.pcmEvent, (event) => {
        if (
          !this.config.matchSession(this.session, event.payload) ||
          !this.worklet
        ) {
          return;
        }
        const samples = decodePcmBase64(this.config.getPcmB64(event.payload));
        this.chunksReceived += 1;
        this.worklet.port.postMessage({
          type: "pcm",
          samples,
          channels: this.config.getChannels(event.payload),
        });
      }),
      listen<TSession>(this.config.flushEvent, (event) => {
        if (
          !this.config.matchSession(this.session, event.payload) ||
          !this.worklet
        ) {
          return;
        }
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
      this.panner = null;
    }

    if (!this.workletReady) {
      this.workletReady = (async () => {
        await this.ctx!.audioWorklet.addModule(pcmStreamProcessorUrl);
        this.worklet = new AudioWorkletNode(
          this.ctx!,
          PCM_STREAM_PROCESSOR_NAME,
          {
            outputChannelCount: [channels],
          },
        );
        this.worklet.port.onmessage = (
          event: MessageEvent<{ type: string }>,
        ) => {
          if (event.data.type === "needData") {
            this.maybeAck();
          }
        };
        this.gain = this.ctx!.createGain();
        this.panner = this.ctx!.createStereoPanner();
        this.applyGain();
        this.applyBalance();
        this.worklet.connect(this.gain);
        this.gain.connect(this.panner);
      })();
    }

    await this.workletReady;
    this.worklet?.port.postMessage({ type: "configure", channels, sampleRate });
    return this.ctx;
  }

  async prepare(
    session: TSession,
    sampleRate: number,
    channels: number,
  ): Promise<void> {
    await this.ensureListeners();
    this.destroyNodes();
    this.session = session;
    this.chunksReceived = 0;
    this.chunksAcked = 0;
    await this.ensureAudio(sampleRate, channels);
  }

  async resumeContext(): Promise<void> {
    if (!this.ctx || this.ctx.state === "running") return;
    try {
      await this.ctx.resume();
    } catch (err) {
      console.warn("PCM AudioContext resume failed:", err);
    }
  }

  connectToOutputBus(): AnalyserNode | null {
    if (!this.panner) return null;
    return connectEngineOutput(this.panner);
  }

  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    this.applyGain();
  }

  setBalance(balance: number): void {
    this.balance = Math.max(-1, Math.min(1, balance));
    this.applyBalance();
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
    if (this.panner) {
      this.panner.disconnect();
      this.panner = null;
    }
    this.workletReady = null;
  }

  releaseBackpressure(): void {
    const pending = this.chunksReceived - this.chunksAcked;
    if (pending <= 0) return;
    this.chunksAcked += pending;
    void invoke(this.config.ackCommand, { count: pending });
  }

  destroy(): void {
    this.releaseBackpressure();
    this.destroyNodes();
    disconnectEngineOutput();
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
    }
    this.session = null;
    this.chunksReceived = 0;
    this.chunksAcked = 0;
  }
}
