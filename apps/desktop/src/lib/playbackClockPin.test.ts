import { afterEach, describe, expect, it } from "vitest";
import {
  pinPlaybackPosition,
  resetPlaybackClockPin,
  resolvePlaybackDisplaySeconds,
  subscribePlaybackPin,
} from "./playbackClockPin";

afterEach(() => {
  resetPlaybackClockPin();
});

describe("playback clock pin", () => {
  it("keeps the seek target while the live clock is still at the old position", () => {
    pinPlaybackPosition(90, 1_000);
    expect(resolvePlaybackDisplaySeconds(12, 1_100)).toBe(90);
  });

  it("releases once the live clock reaches the seek target", () => {
    pinPlaybackPosition(90, 1_000);
    expect(resolvePlaybackDisplaySeconds(90.2, 1_100)).toBe(90.2);
    expect(resolvePlaybackDisplaySeconds(12, 1_200)).toBe(12);
  });

  it("releases a stale pin so a failed seek cannot stick", () => {
    pinPlaybackPosition(90, 1_000);
    expect(resolvePlaybackDisplaySeconds(12, 2_000)).toBe(12);
  });

  it("tells listeners the exact target immediately", () => {
    const seen: number[] = [];
    const stop = subscribePlaybackPin((seconds) => {
      seen.push(seconds);
    });
    pinPlaybackPosition(42.5, 0);
    stop();
    pinPlaybackPosition(1, 0);
    expect(seen).toEqual([42.5]);
  });
});
