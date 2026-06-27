import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  clearSkinGifDecodeCache,
  loadSkinGif,
  resolveGifPlaybackRate,
} from "./skinGifPlayback";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function gifBuffer(name: string): ArrayBuffer {
  const filePath = path.join(
    repoRoot,
    "src-tauri/skins/builtin/t3/assets/animations",
    `${name}.gif`,
  );
  const bytes = readFileSync(filePath);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

afterEach(() => {
  clearSkinGifDecodeCache();
});

describe("loadSkinGif", () => {
  it("reports native shutter timing (10ms frames, not WebKit's 100ms clamp)", async () => {
    const buffer = gifBuffer("shutter-open");
    const blob = new Blob([buffer], { type: "image/gif" });
    const url = URL.createObjectURL(blob);

    try {
      const decoded = await loadSkinGif(url);
      expect(decoded.frames).toHaveLength(79);
      expect(decoded.frames.every((frame) => frame.delay === 10)).toBe(true);
      expect(decoded.totalDurationMs).toBe(790);
    } finally {
      URL.revokeObjectURL(url);
    }
  });

  it("derives playback rate from target duration", async () => {
    const buffer = gifBuffer("shutter-open");
    const blob = new Blob([buffer], { type: "image/gif" });
    const url = URL.createObjectURL(blob);

    try {
      const decoded = await loadSkinGif(url);
      expect(resolveGifPlaybackRate(decoded, { targetDurationMs: 4000 })).toBe(
        0.1975,
      );
      expect(resolveGifPlaybackRate(decoded, { playbackRate: 0.5 })).toBe(0.5);
      expect(
        resolveGifPlaybackRate(decoded, {
          targetDurationMs: 4000,
          playbackRate: 0.5,
        }),
      ).toBe(0.1975);
    } finally {
      URL.revokeObjectURL(url);
    }
  });

  it("reports intro-light native timing", async () => {
    const buffer = gifBuffer("intro-light");
    const blob = new Blob([buffer], { type: "image/gif" });
    const url = URL.createObjectURL(blob);

    try {
      const decoded = await loadSkinGif(url);
      expect(decoded.frames).toHaveLength(19);
      expect(decoded.totalDurationMs).toBeGreaterThanOrEqual(4260);
      expect(decoded.totalDurationMs).toBeLessThanOrEqual(4280);
    } finally {
      URL.revokeObjectURL(url);
    }
  });
});
