import { describe, expect, it } from "vitest";
import {
  CD_PCM_READ_AHEAD_SECONDS,
  CD_PCM_START_BUFFER_SECONDS,
  FILE_PCM_READ_AHEAD_SECONDS,
  PCM_STREAM_MIN_READ_AHEAD_FRAMES,
} from "./pcmStreamConstants";

describe("PCM read-ahead policy", () => {
  it("gives CD enough cushion to absorb optical-drive stalls", () => {
    // Runtime evidence: the drive stalled 125–180ms mid-track and 125ms+ under
    // dual-reader gapless seek. The old ~45ms (2048-frame) watermark underran.
    expect(CD_PCM_READ_AHEAD_SECONDS).toBeGreaterThanOrEqual(0.5);
  });

  it("holds CD cold-start until spin-up is covered by queued PCM", () => {
    // First chunk can arrive in milliseconds from cache, then the drive stalls
    // 1–3s. Starting on that chunk underruns; wait for a real buffer first.
    expect(CD_PCM_START_BUFFER_SECONDS).toBeGreaterThanOrEqual(2);
    expect(CD_PCM_START_BUFFER_SECONDS).toBeGreaterThan(
      CD_PCM_READ_AHEAD_SECONDS,
    );
  });

  it("gives library-file read-ahead enough cushion for install/IPC/minimize stalls", () => {
    // Pack install and macOS minimize stall PCM ack/event delivery; a 0.5s
    // cushion underran at minimize-complete.
    expect(FILE_PCM_READ_AHEAD_SECONDS).toBeGreaterThanOrEqual(2);
    expect(FILE_PCM_READ_AHEAD_SECONDS).toBeGreaterThanOrEqual(
      PCM_STREAM_MIN_READ_AHEAD_FRAMES / 48_000,
    );
  });
});
