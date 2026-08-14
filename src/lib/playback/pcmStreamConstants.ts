/** Shared with pcmStreamProcessor.ts — must match registerProcessor() in the worklet. */
export const PCM_STREAM_PROCESSOR_NAME = "pcm-stream-processor";

/**
 * Matches Rust `CHUNK_FRAMES`. Floor for worklet read-ahead; also the target
 * while a deck is gated. Duplicated in pcmStreamProcessor.ts (worklet bundle).
 */
export const PCM_STREAM_MIN_READ_AHEAD_FRAMES = 2048;

/**
 * Matches Rust file_playback `MAX_CHUNKS_IN_FLIGHT`. Startup can deliver this
 * many chunks before acks catch up; size drain/fallback headroom accordingly.
 */
export const PCM_STREAM_MAX_CHUNKS_IN_FLIGHT = 24;

/**
 * CD worklet target. Optical drives stall 130–180ms between chunks (longer under
 * dual-reader gapless seek); the old ~45ms watermark underran into an audible tick.
 */
export const CD_PCM_READ_AHEAD_SECONDS = 0.5;

/**
 * Library-file worklet target. Pack install (sync extract + contribution rescan)
 * can stall PCM event/ack delivery for hundreds of ms; the old ~50ms watermark
 * underran into an audible gap — match CD cushion.
 */
export const FILE_PCM_READ_AHEAD_SECONDS = 0.5;

/**
 * Ceiling for worklet FIFO frames: read-ahead target plus a full Rust in-flight
 * burst after worst-case upsample, with a small IPC-queue margin.
 *
 * With max = readAhead + 1s, a 44.1→48k start flooded ~48 chunks; discarding
 * overflow either scrubbed the intro or punched a hole a couple seconds in.
 */
export function pcmStreamMaxBufferFrames(
  readAheadFrames: number,
  workletRate: number,
  sourceSampleRate: number,
): number {
  const upsample =
    sourceSampleRate > 0 && sourceSampleRate < workletRate
      ? workletRate / sourceSampleRate
      : 1;
  const maxInFlightWorkletFrames = Math.ceil(
    PCM_STREAM_MAX_CHUNKS_IN_FLIGHT *
      PCM_STREAM_MIN_READ_AHEAD_FRAMES *
      upsample,
  );
  // Extra 0.5s covers acks that land while the initial burst is still queued
  // on the main-thread event path (observed burst > MAX_CHUNKS_IN_FLIGHT alone).
  const queueMarginFrames = Math.round(workletRate * 0.5);
  return readAheadFrames + maxInFlightWorkletFrames + queueMarginFrames;
}
