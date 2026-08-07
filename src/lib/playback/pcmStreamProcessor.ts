/// <reference path="./pcmWorklet.d.ts" />

/** Must match `PCM_STREAM_PROCESSOR_NAME` in pcmStreamConstants.ts (main thread). */
const PCM_STREAM_PROCESSOR_NAME = "pcm-stream-processor";

/**
 * Must match `PCM_STREAM_MIN_READ_AHEAD_FRAMES` in pcmStreamConstants.ts
 * (worklet cannot import that module). Floor for read-ahead; gated target.
 */
const MIN_READ_AHEAD_FRAMES = 2048;

class PcmStreamProcessor extends AudioWorkletProcessor {
  /** Ring-free FIFO: valid samples live in `[readIndex, writeIndex)`. */
  private buffer: Float32Array = new Float32Array(0);
  private readIndex = 0;
  private writeIndex = 0;
  private channels = 2;
  private readAheadFrames = MIN_READ_AHEAD_FRAMES;
  private maxBufferFrames = 44100;
  /** Gated streams buffer PCM without consuming it, primed for a scheduled start. */
  private gated = false;
  private startFrame: number | null = null;
  private endOfStream = false;
  private announcedDrainFrame: number | null = null;
  private drainReported = false;

  constructor() {
    super();
    this.port.onmessage = (event: MessageEvent<PcmStreamWorkletMessage>) => {
      const data = event.data;
      if (data.type === "pcm") {
        this.appendSamples(data.samples, data.channels);
      } else if (data.type === "flush") {
        this.readIndex = 0;
        this.writeIndex = 0;
        this.endOfStream = false;
        this.announcedDrainFrame = null;
        this.drainReported = false;
      } else if (data.type === "configure") {
        this.channels = data.channels;
        this.readAheadFrames = data.readAheadFrames;
        this.maxBufferFrames = data.maxBufferFrames;
      } else if (data.type === "gate") {
        this.gated = true;
        this.startFrame = null;
      } else if (data.type === "startAt") {
        this.startFrame = data.frame;
      } else if (data.type === "startNow") {
        this.gated = false;
        this.startFrame = null;
      } else if (data.type === "endOfStream") {
        this.endOfStream = true;
      }
    };
  }

  private bufferedFrames(): number {
    return Math.floor((this.writeIndex - this.readIndex) / this.channels);
  }

  private appendSamples(samples: Float32Array, channels: number): void {
    this.channels = channels;
    const unread = this.writeIndex - this.readIndex;

    // Grow or compact only when the tail is out of room. Reallocating on every
    // chunk would churn hundreds of KB per chunk on the audio thread once the
    // read-ahead is deep enough to cover an optical drive's seek latency.
    if (unread + samples.length > this.buffer.length) {
      const grown = new Float32Array(
        Math.max(unread + samples.length, this.buffer.length * 2),
      );
      grown.set(this.buffer.subarray(this.readIndex, this.writeIndex));
      this.buffer = grown;
      this.readIndex = 0;
      this.writeIndex = unread;
    } else if (this.writeIndex + samples.length > this.buffer.length) {
      this.buffer.copyWithin(0, this.readIndex, this.writeIndex);
      this.readIndex = 0;
      this.writeIndex = unread;
    }

    this.buffer.set(samples, this.writeIndex);
    this.writeIndex += samples.length;

    const maxSamples = this.maxBufferFrames * this.channels;
    if (this.writeIndex - this.readIndex > maxSamples) {
      this.readIndex = this.writeIndex - maxSamples;
    }
  }

  /**
   * A gated deck is not draining and only needs enough PCM to splice, so it
   * keeps the minimum read-ahead. On CD that also stops the primed deck from
   * pulling the drive head away from the deck that is still playing.
   */
  private maybeRequestData(): void {
    const target = this.gated ? MIN_READ_AHEAD_FRAMES : this.readAheadFrames;
    if (this.bufferedFrames() >= target) return;
    this.port.postMessage({ type: "needData" } satisfies PcmStreamMainMessage);
  }

  /** Frames into this block before a gated stream begins consuming. */
  private startOffset(frames: number, blockStart: number): number {
    if (!this.gated) return 0;
    if (this.startFrame === null) return frames;
    const delta = this.startFrame - blockStart;
    if (delta >= frames) return frames;
    return delta > 0 ? delta : 0;
  }

  /**
   * Once the decoder is done, announce the exact frame the last buffered sample
   * clears so the next deck can start on that frame with no silence between.
   */
  private reportSeam(
    blockStart: number,
    frames: number,
    filledThrough: number,
  ): void {
    if (!this.endOfStream || this.gated || this.drainReported) return;

    const remaining = this.bufferedFrames();
    // With audio still queued the drain point is a prediction; once the buffer
    // runs dry mid-block it is the frame after the last sample we emitted.
    const drainFrame =
      remaining > 0
        ? blockStart + frames + remaining
        : blockStart + filledThrough;
    if (this.announcedDrainFrame !== drainFrame) {
      this.announcedDrainFrame = drainFrame;
      this.port.postMessage({
        type: "drainAt",
        frame: drainFrame,
      } satisfies PcmStreamMainMessage);
    }

    if (remaining === 0) {
      this.drainReported = true;
      this.port.postMessage({ type: "drained" } satisfies PcmStreamMainMessage);
    }
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
    const blockStart = currentFrame;
    const startOffset = this.startOffset(frames, blockStart);

    let filledThrough = 0;
    for (let frame = 0; frame < frames; frame++) {
      for (let ch = 0; ch < output.length; ch++) {
        output[ch]![frame] = 0;
      }

      if (frame < startOffset) continue;

      if (this.readIndex + channels <= this.writeIndex) {
        for (let ch = 0; ch < channels; ch++) {
          output[ch]![frame] = this.buffer[this.readIndex + ch] ?? 0;
        }
        this.readIndex += channels;
        filledThrough = frame + 1;
      }
    }

    if (this.gated && startOffset < frames) {
      this.gated = false;
      this.startFrame = null;
      this.port.postMessage({ type: "started" } satisfies PcmStreamMainMessage);
    }

    this.reportSeam(blockStart, frames, filledThrough);
    this.maybeRequestData();
    return true;
  }
}

type PcmStreamWorkletMessage =
  | { type: "pcm"; samples: Float32Array; channels: number }
  | { type: "flush" }
  | {
      type: "configure";
      channels: number;
      readAheadFrames: number;
      maxBufferFrames: number;
    }
  | { type: "gate" }
  | { type: "startAt"; frame: number }
  | { type: "startNow" }
  | { type: "endOfStream" };

type PcmStreamMainMessage =
  | { type: "needData" }
  | { type: "drainAt"; frame: number }
  | { type: "drained" }
  | { type: "started" };

registerProcessor(PCM_STREAM_PROCESSOR_NAME, PcmStreamProcessor);

export {};
