import { describe, expect, it } from "vitest";
import {
  CD_PCM_READ_AHEAD_SECONDS,
  FILE_PCM_READ_AHEAD_SECONDS,
  PCM_STREAM_MIN_READ_AHEAD_FRAMES,
} from "./pcmStreamConstants";

describe("PCM read-ahead policy", () => {
  it("gives CD enough cushion to absorb optical-drive stalls", () => {
    // Runtime evidence: the drive stalled 125–180ms mid-track and 125ms+ under
    // dual-reader gapless seek. The old ~45ms (2048-frame) watermark underran.
    expect(CD_PCM_READ_AHEAD_SECONDS).toBeGreaterThanOrEqual(0.5);
    expect(CD_PCM_READ_AHEAD_SECONDS).toBeGreaterThan(
      FILE_PCM_READ_AHEAD_SECONDS,
    );
  });

  it("keeps library-file read-ahead near one decode chunk", () => {
    expect(FILE_PCM_READ_AHEAD_SECONDS).toBeGreaterThanOrEqual(
      PCM_STREAM_MIN_READ_AHEAD_FRAMES / 48_000,
    );
    expect(FILE_PCM_READ_AHEAD_SECONDS).toBeLessThan(0.25);
  });
});
