/**
 * Holds the playhead on the exact seek target.
 *
 * The playback clock can keep reporting the pre-seek position until the seek
 * flush lands. Surfaces that sample that clock (the now-playing seek bar,
 * lyrics, skin sync) would flash back and then jump forward. A pin wins until
 * the live clock arrives at the target, or until it expires.
 */

type PlaybackPinListener = (seconds: number) => void;

const PIN_MATCH_SECONDS = 0.4;
const PIN_MAX_MS = 1000;

const listeners = new Set<PlaybackPinListener>();
let pinned: { seconds: number; at: number } | null = null;

export function pinPlaybackPosition(
  seconds: number,
  now = performance.now(),
): void {
  pinned = { seconds, at: now };
  for (const listener of listeners) listener(seconds);
}

export function subscribePlaybackPin(
  listener: PlaybackPinListener,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Live clock, unless a seek pin is still waiting for that clock to catch up. */
export function resolvePlaybackDisplaySeconds(
  liveSeconds: number,
  now = performance.now(),
): number {
  if (!pinned) return liveSeconds;
  const caughtUp = Math.abs(liveSeconds - pinned.seconds) <= PIN_MATCH_SECONDS;
  if (caughtUp || now - pinned.at >= PIN_MAX_MS) {
    pinned = null;
    return liveSeconds;
  }
  return pinned.seconds;
}

export function resetPlaybackClockPin(): void {
  pinned = null;
}
