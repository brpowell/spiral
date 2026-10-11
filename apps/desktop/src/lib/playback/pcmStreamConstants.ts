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
 * Hold the first play silent until this much PCM is queued. Cold-start spin-up
 * delivers a cached first chunk in milliseconds, then stalls 1–3s; starting on
 * that first chunk underruns (seekbar ticks, audio stutters) until the drive
 * is up to speed. Gapless priming still uses the 2048-frame floor so the
 * incoming deck does not steal the head.
 */
export const CD_PCM_START_BUFFER_SECONDS = 2;

/**
 * Library-file worklet target. Pack install (sync extract + contribution rescan)
 * and macOS window minimize both stall main-thread PCM event/ack delivery; a
 * 0.5s cushion underran at minimize-complete — keep ~2s so the audio thread
 * can ride out the genie animation without silence.
 */
export const FILE_PCM_READ_AHEAD_SECONDS = 2.0;
