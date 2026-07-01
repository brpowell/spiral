/// <reference path="./pcmWorklet.d.ts" />

/** Must match `PCM_STREAM_PROCESSOR_NAME` in pcmStreamConstants.ts (main thread). */
const PCM_STREAM_PROCESSOR_NAME = "pcm-stream-processor";

/** Matches Rust `CHUNK_FRAMES` — low-watermark for back-pressure acks. */
const LOW_WATERMARK_FRAMES = 2048;

class PcmStreamProcessor extends AudioWorkletProcessor {
  private buffer: Float32Array = new Float32Array(0);
  private readIndex = 0;
  private channels = 2;
  private maxBufferFrames = 44100;

  constructor() {
    super();
    this.port.onmessage = (event: MessageEvent<PcmStreamWorkletMessage>) => {
      const data = event.data;
      if (data.type === "pcm") {
        this.appendSamples(data.samples, data.channels);
      } else if (data.type === "flush") {
        this.buffer = new Float32Array(0);
        this.readIndex = 0;
      } else if (data.type === "configure") {
        this.channels = data.channels;
        this.maxBufferFrames = data.sampleRate;
      }
    };
  }

  private bufferedFrames(): number {
    const samplesRemaining = this.buffer.length - this.readIndex;
    return Math.floor(samplesRemaining / this.channels);
  }

  private appendSamples(samples: Float32Array, channels: number): void {
    this.channels = channels;
    const unread = this.buffer.subarray(this.readIndex);
    const merged = new Float32Array(unread.length + samples.length);
    merged.set(unread);
    merged.set(samples, unread.length);
    this.buffer = merged;
    this.readIndex = 0;

    const maxSamples = this.maxBufferFrames * this.channels;
    if (this.buffer.length > maxSamples) {
      const drop = this.buffer.length - maxSamples;
      this.buffer = this.buffer.subarray(drop);
    }
  }

  private maybeRequestData(): void {
    if (this.bufferedFrames() >= LOW_WATERMARK_FRAMES) return;
    this.port.postMessage({ type: "needData" } satisfies PcmStreamMainMessage);
  }

  process(
    _inputs: Float32Array[][],
    outputs: Float32Array[][],
    _parameters: Record<string, Float32Array>,
  ): boolean {
    const output = outputs[0];
    if (!output?.length) return true;

    const frames = output[0]?.length ?? 0;
    const channels = Math.min(this.channels, output.length);

    for (let frame = 0; frame < frames; frame++) {
      for (let ch = 0; ch < output.length; ch++) {
        output[ch]![frame] = 0;
      }

      if (this.readIndex + channels <= this.buffer.length) {
        for (let ch = 0; ch < channels; ch++) {
          output[ch]![frame] = this.buffer[this.readIndex + ch] ?? 0;
        }
        this.readIndex += channels;
      }
    }

    this.maybeRequestData();
    return true;
  }
}

type PcmStreamWorkletMessage =
  | { type: "pcm"; samples: Float32Array; channels: number }
  | { type: "flush" }
  | { type: "configure"; channels: number; sampleRate: number };

type PcmStreamMainMessage = { type: "needData" };

registerProcessor(PCM_STREAM_PROCESSOR_NAME, PcmStreamProcessor);

export {};
