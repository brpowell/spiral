import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { waitForPaint } from "./scheduling";

describe("waitForPaint", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("resolves after two frames when the window paints", async () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      frames.push(cb);
      return frames.length;
    });
    let resolved = false;
    void waitForPaint().then(() => {
      resolved = true;
    });

    frames.shift()?.(0);
    await Promise.resolve();
    expect(resolved).toBe(false);
    frames.shift()?.(0);
    await Promise.resolve();
    expect(resolved).toBe(true);
  });

  it("still resolves when frames never fire (occluded window)", async () => {
    vi.stubGlobal("requestAnimationFrame", () => 1);
    let resolved = false;
    void waitForPaint().then(() => {
      resolved = true;
    });

    await vi.advanceTimersByTimeAsync(99);
    expect(resolved).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    expect(resolved).toBe(true);
  });
});
