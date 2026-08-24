import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  connectDeckOutput,
  disconnectDeckOutput,
  type DeckId,
} from "./audioOutput";
import { decodePcmBase64 } from "./pcmDecode";
import { PcmResampler } from "./pcmResample";
import {
  ensureSharedPcmWorkletModule,
  getSharedPcmAudioContext,
} from "./pcmSharedContext";
import {
  PCM_STREAM_MIN_READ_AHEAD_FRAMES,
  PCM_STREAM_PROCESSOR_NAME,
} from "./pcmStreamConstants";
// Vite must emit a real JS chunk (`?worker&url`). Plain `new URL(..., import.meta.url)`
// inlines the .ts as a data: URL, which production CSP script-src blocks.
import pcmStreamProcessorUrl from "./pcmStreamProcessor.ts?worker&url";

export interface PcmStreamConfig<TSession, TPcm extends TSession> {
  ackCommand: string;
  /** Build invoke payload for back-pressure acks (include session id when required). */
  buildAckPayload: (
    session: TSession,
    count: number,
  ) => Record<string, unknown>;
  pcmEvent: string;
  flushEvent: string;
  matchSession: (session: TSession | null, payload: TSession) => boolean;
  getChannels: (payload: TPcm) => number;
  getPcmB64: (payload: TPcm) => string;
  /**
   * `shared` — dual decks share one AudioContext (required for gapless splice /
   * crossfade; used by library files and CD).
   * `owned` — private context at the stream sample rate (legacy / special cases).
   */
  contextMode: "shared" | "owned";
  /**
   * Target seconds of decoded audio held in the worklet. Sized to the medium's
   * worst delivery stall: local files arrive predictably, optical drives seek.
   */
  readAheadSeconds: number;
}

/** Seam signals from the worklet, used to splice two decks without silence. */
export interface PcmSeamCallbacks {
  /** Absolute context frame at which the buffered tail runs out. */
  onDrainAt?: (frame: number) => void;
  /** The buffered tail has finished playing. */
  onDrained?: () => void;
  /** A gated stream reached its scheduled start frame and began playing. */
  onStarted?: () => void;
  /**
   * Context frame of the first sample emitted after a transport restart
   * (start, resume, seek flush) — the exact instant the current source position
   * became audible.
   */
  onPlaybackAnchor?: (frame: number) => void;
  /**
   * A cold-start gate reached `startWhenBuffered` frames. The worklet is still
   * silent; the engine should `startNow()` when it wants audible output.
   */
  onBuffered?: () => void;
}

/**
 * Web Audio pipeline for Rust PCM streams: worklet pull → gain → shared analyser bus.
 */
export class PcmStreamPipeline<TSession, TPcm extends TSession> {
  private readonly config: PcmStreamConfig<TSession, TPcm>;

  private ctx: AudioContext | null = null;
  private ownsContext = false;
  private gain: GainNode | null = null;
  private panner: StereoPannerNode | null = null;
  private worklet: AudioWorkletNode | null = null;
  private workletReady: Promise<void> | null = null;
  private session: TSession | null = null;
  private sourceSampleRate = 0;
  private chunksReceived = 0;
  private chunksAcked = 0;
  private listeners: Promise<UnlistenFn[]> | null = null;
  private volume = 1;
  private balance = 0;
  private muted = false;
  private deckId: DeckId = "a";
  private resampler: PcmResampler | null = null;
  private resamplerChannels = 0;
  private seam: PcmSeamCallbacks = {};

  constructor(config: PcmStreamConfig<TSession, TPcm>) {
    this.config = config;
  }

  setSeamCallbacks(seam: PcmSeamCallbacks): void {
    this.seam = seam;
  }

  setDeckId(deckId: DeckId): void {
    this.deckId = deckId;
  }

  getDeckId(): DeckId {
    return this.deckId;
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
    if (pending <= 0 || !this.session) return;
    this.chunksAcked += 1;
    void invoke(
      this.config.ackCommand,
      this.config.buildAckPayload(this.session, 1),
    );
  }

  /** Stateful only when the stream rate differs from the context rate. */
  private ensureResampler(channels: number): PcmResampler | null {
    if (!this.ctx || this.sourceSampleRate <= 0) return null;
    if (this.ctx.sampleRate === this.sourceSampleRate) return null;
    if (!this.resampler || this.resamplerChannels !== channels) {
      this.resampler = new PcmResampler(
        channels,
        this.sourceSampleRate,
        this.ctx.sampleRate,
      );
      this.resamplerChannels = channels;
    }
    return this.resampler;
  }

  private ensureListeners(): Promise<UnlistenFn[]> {
    this.listeners ??= Promise.all([
      listen<TPcm>(this.config.pcmEvent, (event) => {
        if (
          !this.config.matchSession(this.session, event.payload) ||
          !this.worklet ||
          !this.ctx
        ) {
          return;
        }
        const channels = this.config.getChannels(event.payload);
        const decoded = decodePcmBase64(this.config.getPcmB64(event.payload));
        const resampler = this.ensureResampler(channels);
        const samples = resampler ? resampler.process(decoded) : decoded;
        // Count every chunk so back-pressure acks keep flowing even when the
        // resampler holds a boundary frame back.
        this.chunksReceived += 1;
        if (samples.length === 0) return;
        this.worklet.port.postMessage({
          type: "pcm",
          samples,
          channels,
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
        this.resampler?.reset();
        this.worklet.port.postMessage({ type: "flush" });
      }),
    ]);
    return this.listeners;
  }

  private async ensureAudio(
    sampleRate: number,
    channels: number,
  ): Promise<AudioContext> {
    this.sourceSampleRate = sampleRate;

    if (this.config.contextMode === "shared") {
      this.ctx = getSharedPcmAudioContext();
      this.ownsContext = false;
      await ensureSharedPcmWorkletModule(this.ctx);
    } else if (!this.ctx) {
      this.ctx = new AudioContext({ sampleRate });
      this.ownsContext = true;
    } else if (this.ctx.sampleRate !== sampleRate) {
      await this.ctx.close();
      this.ctx = new AudioContext({ sampleRate });
      this.ownsContext = true;
      this.workletReady = null;
      this.worklet = null;
      this.gain = null;
      this.panner = null;
    }

    if (!this.workletReady) {
      this.workletReady = (async () => {
        if (this.config.contextMode === "owned") {
          await this.ctx!.audioWorklet.addModule(pcmStreamProcessorUrl);
        }
        this.worklet = new AudioWorkletNode(
          this.ctx!,
          PCM_STREAM_PROCESSOR_NAME,
          {
            outputChannelCount: [channels],
          },
        );
        this.worklet.port.onmessage = (
          event: MessageEvent<{ type: string; frame?: number }>,
        ) => {
          const data = event.data;
          if (data.type === "needData") {
            this.maybeAck();
          } else if (data.type === "drainAt") {
            if (typeof data.frame === "number") {
              this.seam.onDrainAt?.(data.frame);
            }
          } else if (data.type === "drained") {
            this.seam.onDrained?.();
          } else if (data.type === "started") {
            this.seam.onStarted?.();
          } else if (data.type === "playbackAnchor") {
            if (typeof data.frame === "number") {
              this.seam.onPlaybackAnchor?.(data.frame);
            }
          } else if (data.type === "buffered") {
            this.seam.onBuffered?.();
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
    const workletRate = this.ctx!.sampleRate;
    const readAheadFrames = Math.max(
      PCM_STREAM_MIN_READ_AHEAD_FRAMES,
      Math.round(this.config.readAheadSeconds * workletRate),
    );
    this.worklet?.port.postMessage({
      type: "configure",
      channels,
      readAheadFrames,
    });
    return this.ctx!;
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
    this.resampler = null;
    this.resamplerChannels = 0;
    await this.ensureAudio(sampleRate, channels);
  }

  /** Buffer incoming PCM without playing it until `startAtFrame` is reached. */
  gate(options?: { startWhenBuffered?: number }): void {
    this.worklet?.port.postMessage({
      type: "gate",
      startWhenBuffered: options?.startWhenBuffered,
    });
  }

  startAtFrame(frame: number): void {
    this.worklet?.port.postMessage({ type: "startAt", frame });
  }

  startNow(): void {
    this.worklet?.port.postMessage({ type: "startNow" });
  }

  /**
   * The decoder is done, but the worklet still holds a tail. Push the
   * resampler's held-back frame and let the worklet announce its drain point.
   */
  signalEndOfStream(): void {
    if (!this.worklet) return;
    const tail = this.resampler?.flush();
    if (tail && tail.length > 0) {
      this.worklet.port.postMessage({
        type: "pcm",
        samples: tail,
        channels: this.resamplerChannels,
      });
    }
    this.worklet.port.postMessage({ type: "endOfStream" });
  }

  /** Re-post drainAt after a late gapless subscriber attaches. */
  reannounceDrain(): void {
    this.worklet?.port.postMessage({ type: "reannounceDrain" });
  }

  /** Audio-thread clock. Advances only while the context renders, so it is the
   * only wall clock that matches what the listener actually hears. */
  getContextTime(): number {
    return this.ctx?.currentTime ?? 0;
  }

  getContextSampleRate(): number {
    return this.ctx?.sampleRate ?? 0;
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
    return connectDeckOutput(this.deckId, this.panner);
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
    if (pending <= 0 || !this.session) return;
    this.chunksAcked += pending;
    void invoke(
      this.config.ackCommand,
      this.config.buildAckPayload(this.session, pending),
    );
  }

  destroy(): void {
    this.releaseBackpressure();
    this.destroyNodes();
    disconnectDeckOutput(this.deckId);
    if (this.ownsContext && this.ctx) {
      void this.ctx.close();
      this.ctx = null;
    } else {
      this.ctx = null;
    }
    this.ownsContext = false;
    this.session = null;
    this.sourceSampleRate = 0;
    this.chunksReceived = 0;
    this.chunksAcked = 0;
    this.resampler = null;
    this.resamplerChannels = 0;
  }
}
