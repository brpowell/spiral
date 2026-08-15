import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PCM_STREAM_MIN_READ_AHEAD_FRAMES } from "./pcmStreamConstants";

const BLOCK_FRAMES = 128;
const CHANNELS = 2;

interface FakePort {
  postMessage: (message: unknown) => void;
  onmessage: ((event: { data: unknown }) => void) | null;
}

interface Processor {
  port: FakePort;
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean;
}

type ProcessorCtor = new () => Processor;

let ProcessorClass: ProcessorCtor;

interface WorkletGlobals {
  AudioWorkletProcessor: unknown;
  registerProcessor: (name: string, ctor: ProcessorCtor) => void;
  currentFrame: number;
}

const workletGlobals = globalThis as unknown as WorkletGlobals;

function last<T>(items: T[]): T | undefined {
  return items[items.length - 1];
}

/** Messages the worklet posts back to the main thread. */
type Outbound =
  | { type: "needData" }
  | { type: "drainAt"; frame: number }
  | { type: "drained" }
  | { type: "started" };

class Deck {
  readonly processor: Processor;
  readonly messages: Outbound[] = [];

  constructor(options?: { readAheadFrames?: number }) {
    this.processor = new ProcessorClass();
    this.processor.port.postMessage = (message) => {
      this.messages.push(message as Outbound);
    };
    this.send({
      type: "configure",
      channels: CHANNELS,
      readAheadFrames:
        options?.readAheadFrames ?? PCM_STREAM_MIN_READ_AHEAD_FRAMES,
    });
  }

  send(message: unknown): void {
    this.processor.port.onmessage?.({ data: message });
  }

  feed(frames: number, value: number): void {
    const samples = new Float32Array(frames * CHANNELS).fill(value);
    this.send({ type: "pcm", samples, channels: CHANNELS });
  }

  /** Render one block at `blockStart` and return the first output channel. */
  render(blockStart: number): Float32Array {
    workletGlobals.currentFrame = blockStart;
    const output = [
      new Float32Array(BLOCK_FRAMES),
      new Float32Array(BLOCK_FRAMES),
    ];
    this.processor.process([], [output], {});
    return output[0]!;
  }

  take<T extends Outbound["type"]>(type: T): Extract<Outbound, { type: T }>[] {
    return this.messages.filter((m) => m.type === type) as Extract<
      Outbound,
      { type: T }
    >[];
  }
}

beforeAll(async () => {
  class FakeAudioWorkletProcessor {
    readonly port: FakePort = {
      postMessage: () => {},
      onmessage: null,
    };
  }

  workletGlobals.AudioWorkletProcessor = FakeAudioWorkletProcessor;
  workletGlobals.registerProcessor = (_name, ctor) => {
    ProcessorClass = ctor;
  };
  workletGlobals.currentFrame = 0;

  await import("./pcmStreamProcessor");
});

describe("PcmStreamProcessor", () => {
  beforeEach(() => {
    workletGlobals.currentFrame = 0;
  });

  it("plays buffered PCM as soon as it arrives", () => {
    const deck = new Deck();
    deck.feed(BLOCK_FRAMES, 0.5);

    const block = deck.render(0);

    expect(Array.from(block)).toEqual(Array(BLOCK_FRAMES).fill(0.5));
  });

  it("stays silent while gated and consumes nothing", () => {
    const deck = new Deck();
    deck.send({ type: "gate" });
    deck.feed(BLOCK_FRAMES, 0.5);

    expect(Array.from(deck.render(0))).toEqual(Array(BLOCK_FRAMES).fill(0));
    expect(deck.take("started")).toHaveLength(0);

    // Nothing was consumed, so the same audio is still queued.
    deck.send({ type: "startNow" });
    expect(Array.from(deck.render(BLOCK_FRAMES))).toEqual(
      Array(BLOCK_FRAMES).fill(0.5),
    );
  });

  it("pause-style gate holds already-buffered PCM across silent blocks", () => {
    const deck = new Deck();
    deck.feed(BLOCK_FRAMES * 3, 0.5);
    expect(Array.from(deck.render(0))).toEqual(Array(BLOCK_FRAMES).fill(0.5));

    deck.send({ type: "gate" });
    expect(Array.from(deck.render(BLOCK_FRAMES))).toEqual(
      Array(BLOCK_FRAMES).fill(0),
    );
    expect(Array.from(deck.render(BLOCK_FRAMES * 2))).toEqual(
      Array(BLOCK_FRAMES).fill(0),
    );

    deck.send({ type: "startNow" });
    expect(Array.from(deck.render(BLOCK_FRAMES * 3))).toEqual(
      Array(BLOCK_FRAMES).fill(0.5),
    );
  });

  it("starts exactly on the scheduled frame, mid-block", () => {
    const deck = new Deck();
    deck.send({ type: "gate" });
    deck.feed(BLOCK_FRAMES * 2, 0.5);
    // Third block covers frames 256..383; start 40 frames into it.
    deck.send({ type: "startAt", frame: 256 + 40 });

    expect(Array.from(deck.render(0))).toEqual(Array(BLOCK_FRAMES).fill(0));
    expect(Array.from(deck.render(128))).toEqual(Array(BLOCK_FRAMES).fill(0));

    const block = deck.render(256);
    expect(Array.from(block.subarray(0, 40))).toEqual(Array(40).fill(0));
    expect(Array.from(block.subarray(40))).toEqual(
      Array(BLOCK_FRAMES - 40).fill(0.5),
    );
    expect(deck.take("started")).toHaveLength(1);
  });

  it("announces the frame its tail runs out, then reports drained", () => {
    const deck = new Deck();
    // 300 frames drains 44 frames into the third block (frame 300).
    deck.feed(300, 0.5);
    deck.render(0);
    deck.send({ type: "endOfStream" });

    deck.render(128);
    expect(last(deck.take("drainAt"))?.frame).toBe(300);

    // The estimate is stable while no new audio arrives.
    deck.render(256);
    expect(deck.take("drainAt")).toHaveLength(1);
    expect(deck.take("drained")).toHaveLength(1);
  });

  it("re-announces the drain frame when a late chunk lands", () => {
    const deck = new Deck();
    deck.feed(300, 0.5);
    deck.render(0);
    deck.send({ type: "endOfStream" });
    deck.render(128);
    expect(last(deck.take("drainAt"))?.frame).toBe(300);

    deck.feed(64, 0.5);
    deck.render(256);
    expect(last(deck.take("drainAt"))?.frame).toBe(364);
  });

  it("splices two decks with no silent frame and no overlap", () => {
    const outgoing = new Deck();
    const incoming = new Deck();

    outgoing.feed(300, 0.5);
    incoming.send({ type: "gate" });
    incoming.feed(BLOCK_FRAMES * 4, -0.5);

    const mixed: number[] = [];
    let scheduled = false;

    for (let block = 0; block < 5; block++) {
      const blockStart = block * BLOCK_FRAMES;
      const a = outgoing.render(blockStart);
      const b = incoming.render(blockStart);
      for (let i = 0; i < BLOCK_FRAMES; i++) {
        mixed.push(a[i]! + b[i]!);
      }

      if (!scheduled) {
        const drainAt = last(outgoing.take("drainAt"));
        if (drainAt) {
          incoming.send({ type: "startAt", frame: drainAt.frame });
          scheduled = true;
        }
      }
      if (block === 0) outgoing.send({ type: "endOfStream" });
    }

    // Frames 0..299 are the outgoing track, 300+ are the incoming track, with
    // no zero frame between them and no frame carrying both.
    expect(mixed.slice(0, 300)).toEqual(Array(300).fill(0.5));
    expect(mixed.slice(300, 5 * BLOCK_FRAMES)).toEqual(
      Array(5 * BLOCK_FRAMES - 300).fill(-0.5),
    );
    expect(incoming.take("started")).toHaveLength(1);
  });

  it("starts on the next block when the scheduled frame already passed", () => {
    const deck = new Deck();
    deck.send({ type: "gate" });
    deck.feed(BLOCK_FRAMES, 0.5);
    deck.send({ type: "startAt", frame: 10 });

    const block = deck.render(512);

    expect(Array.from(block)).toEqual(Array(BLOCK_FRAMES).fill(0.5));
    expect(deck.take("started")).toHaveLength(1);
  });

  it("clears end-of-stream state on flush so a seek can resume reporting", () => {
    const deck = new Deck();
    deck.feed(64, 0.5);
    deck.send({ type: "endOfStream" });
    deck.render(0);
    expect(deck.take("drained")).toHaveLength(1);

    deck.send({ type: "flush" });
    deck.feed(BLOCK_FRAMES, 0.25);
    deck.render(128);

    expect(deck.take("drained")).toHaveLength(1);
  });

  it("keeps requesting data until the configured playing read-ahead is filled", () => {
    // CD-depth target (~0.5s at 48 kHz). Below this the worklet used to sit on
    // the 2048-frame floor and underrun when the optical drive stalled.
    const readAheadFrames = 24_000;
    const deck = new Deck({ readAheadFrames });

    deck.feed(readAheadFrames / 2, 0.5);
    deck.messages.length = 0;
    deck.render(0);
    expect(deck.take("needData").length).toBeGreaterThan(0);

    deck.feed(readAheadFrames, 0.5);
    deck.messages.length = 0;
    deck.render(BLOCK_FRAMES);
    expect(deck.take("needData")).toHaveLength(0);
  });

  it("while gated, stops requesting once the minimum read-ahead is buffered", () => {
    const readAheadFrames = 24_000;
    const deck = new Deck({ readAheadFrames });
    deck.send({ type: "gate" });

    deck.feed(PCM_STREAM_MIN_READ_AHEAD_FRAMES - BLOCK_FRAMES, 0.5);
    deck.messages.length = 0;
    deck.render(0);
    // Gated decks do not consume; still under the minimum → keep pulling.
    expect(deck.take("needData").length).toBeGreaterThan(0);

    deck.feed(BLOCK_FRAMES, 0.5);
    deck.messages.length = 0;
    deck.render(BLOCK_FRAMES);
    // At the minimum — do not pull toward the full playing target (important
    // for CD gapless so the primed deck does not steal the drive head).
    expect(deck.take("needData")).toHaveLength(0);
  });

  it("keeps a contiguous startup burst without discarding overflow", () => {
    // Worklet must not punch holes by discarding PCM when a resume burst
    // overshoots the read-ahead target (that clicked at ~2s after the bump).
    const deck = new Deck({ readAheadFrames: BLOCK_FRAMES * 2 });
    deck.feed(BLOCK_FRAMES, 0.1);
    deck.feed(BLOCK_FRAMES, 0.2);
    deck.feed(BLOCK_FRAMES, 0.3);
    const first = deck.render(0);
    const second = deck.render(BLOCK_FRAMES);
    const third = deck.render(BLOCK_FRAMES * 2);
    expect(first.every((sample) => Math.abs(sample - 0.1) < 1e-5)).toBe(true);
    expect(second.every((sample) => Math.abs(sample - 0.2) < 1e-5)).toBe(true);
    expect(third.every((sample) => Math.abs(sample - 0.3) < 1e-5)).toBe(true);
  });
});
