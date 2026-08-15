/** Shared with pcmStreamProcessor.ts — must match registerProcessor() in the worklet. */
export const PCM_STREAM_PROCESSOR_NAME = "pcm-stream-processor";

/**
 * Matches Rust `CHUNK_FRAMES`. Floor for worklet read-ahead; also the target
 * while a deck is gated. Duplicated in pcmStreamProcessor.ts (worklet bundle).
 */
export const PCM_STREAM_MIN_READ_AHEAD_FRAMES = 2048;

/**
 * CD worklet target. Optical drives stall 130–180ms between chunks (longer under
 * dual-reader gapless seek); the old ~45ms watermark underran into an audible tick.
 */
export const CD_PCM_READ_AHEAD_SECONDS = 0.5;

/**
 * Library-file worklet target. Pack install (sync extract + contribution rescan)
 * and macOS window minimize both stall main-thread PCM event/ack delivery; a
 * 0.5s cushion underran at minimize-complete — keep ~2s so the audio thread
 * can ride out the genie animation without silence.
 */
export const FILE_PCM_READ_AHEAD_SECONDS = 2.0;
