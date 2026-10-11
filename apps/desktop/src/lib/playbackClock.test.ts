import { afterEach, describe, expect, it, vi } from "vitest";

const clock = vi.hoisted(() => ({ seconds: 0 }));

vi.mock("./playback", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./playback")>();
  return {
    ...actual,
    getPositionSeconds: () => clock.seconds,
  };
});

import { usePlayerStore } from "../store/usePlayerStore";
import { resetPlaybackClock, subscribePlaybackClock } from "./playbackClock";
import { pinPlaybackPosition, resetPlaybackClockPin } from "./playbackClockPin";

const frames: FrameRequestCallback[] = [];

function pumpFrame(): void {
  const callback = frames.shift();
  if (!callback) throw new Error("expected a scheduled playback clock frame");
  callback(0);
}

afterEach(() => {
  resetPlaybackClock();
  resetPlaybackClockPin();
  frames.length = 0;
  usePlayerStore.setState({ playbackState: "stopped" });
  vi.unstubAllGlobals();
});

describe("playback clock", () => {
  it("notifies on the displayed second and skips samples inside that second", () => {
    clock.seconds = 0;
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      frames.push(cb);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});

    usePlayerStore.setState({ playbackState: "playing" });
    const seconds: number[] = [];
    const stop = subscribePlaybackClock((value) => {
      seconds.push(value);
    });

    clock.seconds = 10.1;
    pumpFrame();
    clock.seconds = 10.4;
    pumpFrame();
    clock.seconds = 11.05;
    pumpFrame();

    expect(seconds).toEqual([10.1, 11.05]);
    stop();
  });

  it("notifies when a seek pin lands inside the current second", () => {
    clock.seconds = 10.2;
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      frames.push(cb);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});

    usePlayerStore.setState({ playbackState: "playing" });
    const seconds: number[] = [];
    const stop = subscribePlaybackClock((value) => {
      seconds.push(value);
    });

    pumpFrame();
    pinPlaybackPosition(10.8, 1_000);

    expect(seconds).toEqual([10.2, 10.8]);
    stop();
  });
});
