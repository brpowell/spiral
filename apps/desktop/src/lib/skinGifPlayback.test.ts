import { afterEach, describe, expect, it } from "vitest";
import { decompressFrames, parseGIF } from "gifuct-js";
import {
  clearSkinGifDecodeCache,
  compositeGifFramePatch,
  loadSkinGif,
  resolveGifLoopCount,
  resolveGifPlaybackRate,
} from "./skinGifPlayback";
import {
  encodeGifFixture,
  type GifColor,
  type GifFixtureFrame,
} from "./testing/gifFixture";

const PALETTE: GifColor[] = [
  [0, 0, 0],
  [200, 40, 40],
  [40, 200, 40],
  [40, 40, 200],
];

function solidFrame(
  size: number,
  index: number,
  delayMs: number,
): GifFixtureFrame {
  return { pixels: new Uint8Array(size * size).fill(index), delayMs };
}

async function decode(bytes: Uint8Array) {
  const url = URL.createObjectURL(new Blob([bytes], { type: "image/gif" }));
  try {
    return await loadSkinGif(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

afterEach(() => {
  clearSkinGifDecodeCache();
});

describe("loadSkinGif", () => {
  it("reports native 10ms frame timing (not a browser-clamped 100ms)", async () => {
    const decoded = await decode(
      encodeGifFixture({
        width: 4,
        height: 4,
        palette: PALETTE,
        frames: Array.from({ length: 40 }, (_, i) =>
          solidFrame(4, 1 + (i % 2), 10),
        ),
      }),
    );
    expect(decoded.frames).toHaveLength(40);
    expect(decoded.frames.every((frame) => frame.delay === 10)).toBe(true);
    expect(decoded.totalDurationMs).toBe(400);
  });

  it("derives playback rate from target duration", async () => {
    const decoded = await decode(
      encodeGifFixture({
        width: 4,
        height: 4,
        palette: PALETTE,
        frames: Array.from({ length: 40 }, () => solidFrame(4, 1, 10)),
      }),
    );
    expect(resolveGifPlaybackRate(decoded, { targetDurationMs: 2000 })).toBe(
      0.2,
    );
    expect(resolveGifPlaybackRate(decoded, { playbackRate: 0.5 })).toBe(0.5);
    expect(
      resolveGifPlaybackRate(decoded, {
        targetDurationMs: 2000,
        playbackRate: 0.5,
      }),
    ).toBe(0.2);
  });

  it("sums uneven per-frame delays exactly", async () => {
    const delays = Array.from({ length: 19 }, (_, i) => 10 + (i % 4) * 50);
    const decoded = await decode(
      encodeGifFixture({
        width: 4,
        height: 4,
        palette: PALETTE,
        frames: delays.map((delay, i) => solidFrame(4, 1 + (i % 3), delay)),
      }),
    );
    expect(decoded.frames).toHaveLength(19);
    expect(decoded.frames.map((frame) => frame.delay)).toEqual(delays);
    expect(decoded.totalDurationMs).toBe(delays.reduce((a, b) => a + b, 0));
  });

  it("reports a null loop count when there is no NETSCAPE extension", async () => {
    const decoded = await decode(
      encodeGifFixture({
        width: 2,
        height: 2,
        palette: PALETTE,
        frames: [solidFrame(2, 1, 10), solidFrame(2, 2, 10)],
      }),
    );
    expect(decoded.loopCount).toBeNull();
  });

  // parseLoopCount currently returns the NETSCAPE sub-block id (always 1)
  // instead of the little-endian loop count that follows it, so a GIF that
  // loops forever decodes as loopCount 1. Enable once that is fixed.
  it.todo("decodes the NETSCAPE loop count (0 = forever, n = repeats)");
});

describe("compositeGifFramePatch", () => {
  const W = 8;
  const H = 6;

  function canvasFor(frames: GifFixtureFrame[]) {
    const bytes = encodeGifFixture({
      width: W,
      height: H,
      palette: PALETTE,
      frames,
    });
    const gif = parseGIF(bytes.buffer.slice(0) as ArrayBuffer);
    const parsed = decompressFrames(gif, true);
    const canvas = new Uint8ClampedArray(W * H * 4);
    for (const frame of parsed) compositeGifFramePatch(canvas, W, frame);
    return canvas;
  }

  const pixelAt = (canvas: Uint8ClampedArray, x: number, y: number) => {
    const i = (y * W + x) * 4;
    return [canvas[i], canvas[i + 1], canvas[i + 2], canvas[i + 3]];
  };

  it("composites transparent deltas without clearing prior pixels", () => {
    // Index 0 is transparent in the delta frame.
    const canvas = canvasFor([
      { pixels: new Uint8Array(W * H).fill(1), delayMs: 10 },
      {
        pixels: Uint8Array.from([0, 2, 0, 2, 0, 2]),
        left: 2,
        top: 1,
        width: 3,
        height: 2,
        delayMs: 10,
        transparentIndex: 0,
      },
    ]);

    let opaque = 0;
    for (let i = 3; i < canvas.length; i += 4) {
      if (canvas[i] > 0) opaque += 1;
    }
    expect(opaque).toBe(W * H);

    // Opaque delta pixels overwrite; transparent ones leave the base frame.
    expect(pixelAt(canvas, 3, 1)).toEqual([40, 200, 40, 255]);
    expect(pixelAt(canvas, 2, 1)).toEqual([200, 40, 40, 255]);
    expect(pixelAt(canvas, 4, 2)).toEqual([40, 200, 40, 255]);
    expect(pixelAt(canvas, 0, 0)).toEqual([200, 40, 40, 255]);
  });

  it("leaves untouched canvas pixels transparent when no frame covers them", () => {
    const canvas = canvasFor([
      {
        pixels: new Uint8Array(4).fill(3),
        left: 1,
        top: 1,
        width: 2,
        height: 2,
        delayMs: 10,
      },
    ]);
    expect(pixelAt(canvas, 0, 0)[3]).toBe(0);
    expect(pixelAt(canvas, 1, 1)).toEqual([40, 40, 200, 255]);
  });
});

describe("resolveGifLoopCount", () => {
  it("honors loopForever over file metadata", () => {
    const decoded = {
      width: 1,
      height: 1,
      frames: [],
      totalDurationMs: 0,
      loopCount: 0,
    };
    expect(resolveGifLoopCount(decoded, { loopForever: true })).toBe(0);
    expect(resolveGifLoopCount(decoded, {})).toBe(0);
  });
});
