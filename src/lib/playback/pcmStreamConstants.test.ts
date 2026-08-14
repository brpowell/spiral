import { describe, expect, it } from "vitest";
import {
  CD_PCM_READ_AHEAD_SECONDS,
  FILE_PCM_READ_AHEAD_SECONDS,
  PCM_STREAM_MAX_CHUNKS_IN_FLIGHT,
  PCM_STREAM_MIN_READ_AHEAD_FRAMES,
  pcmStreamMaxBufferFrames,
} from "./pcmStreamConstants";

describe("PCM read-ahead policy", () => {
  it("gives CD enough cushion to absorb optical-drive stalls", () => {
    // Runtime evidence: the drive stalled 125–180ms mid-track and 125ms+ under
    // dual-reader gapless seek. The old ~45ms (2048-frame) watermark underran.
    expect(CD_PCM_READ_AHEAD_SECONDS).toBeGreaterThanOrEqual(0.5);
  });

  it("gives library-file read-ahead enough cushion for install/IPC stalls", () => {
    // Pack install can stall PCM ack/event delivery for hundreds of ms; the old
    // ~50ms watermark underran into an audible gap.
    expect(FILE_PCM_READ_AHEAD_SECONDS).toBeGreaterThanOrEqual(0.5);
    expect(FILE_PCM_READ_AHEAD_SECONDS).toBeGreaterThanOrEqual(
      PCM_STREAM_MIN_READ_AHEAD_FRAMES / 48_000,
    );
  });

  it("sizes max buffer to absorb an in-flight burst after 44.1→48k upsample", () => {
    const workletRate = 48_000;
    const sourceRate = 44_100;
    const readAheadFrames = Math.round(
      FILE_PCM_READ_AHEAD_SECONDS * workletRate,
    );
    const maxFrames = pcmStreamMaxBufferFrames(
      readAheadFrames,
      workletRate,
      sourceRate,
    );
    const burstFrames = Math.ceil(
      PCM_STREAM_MAX_CHUNKS_IN_FLIGHT *
        PCM_STREAM_MIN_READ_AHEAD_FRAMES *
        (workletRate / sourceRate),
    );
    // Must fit read-ahead + full Rust allowance post-resample.
    expect(maxFrames).toBeGreaterThanOrEqual(readAheadFrames + burstFrames);
    // Old ceiling (readAhead + 1s) overflowed and scrubbed track start.
    expect(maxFrames).toBeGreaterThan(readAheadFrames + workletRate);
  });
});
