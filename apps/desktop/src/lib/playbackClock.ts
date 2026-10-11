import * as audio from "./playback";
import {
  resolvePlaybackDisplaySeconds,
  subscribePlaybackPin,
} from "./playbackClockPin";
import { usePlayerStore } from "../store/usePlayerStore";

type PlaybackClockListener = (seconds: number) => void;

const listeners = new Set<PlaybackClockListener>();
let raf = 0;
let watchingStore = false;
let lastPaintedSecond = -1;
let lastNotifiedSeconds = -1;

function notify(): void {
  const seconds = resolvePlaybackDisplaySeconds(audio.getPositionSeconds());
  const second = Math.floor(seconds);
  const jumped =
    lastNotifiedSeconds >= 0 && Math.abs(seconds - lastNotifiedSeconds) > 1.25;
  if (second === lastPaintedSecond && !jumped) return;
  lastPaintedSecond = second;
  lastNotifiedSeconds = seconds;
  for (const listener of listeners) listener(seconds);
}

function stopLoop(): void {
  if (raf === 0) return;
  cancelAnimationFrame(raf);
  raf = 0;
}

function loop(): void {
  notify();
  raf = requestAnimationFrame(loop);
}

function syncLoop(): void {
  const playing = usePlayerStore.getState().playbackState === "playing";
  if (playing && listeners.size > 0) {
    if (raf === 0) raf = requestAnimationFrame(loop);
    return;
  }
  stopLoop();
  if (listeners.size > 0) notify();
}

function watchStore(): void {
  if (watchingStore) return;
  watchingStore = true;
  usePlayerStore.subscribe((state, prev) => {
    if (state.playbackState !== prev.playbackState) {
      syncLoop();
      return;
    }
    if (
      state.playbackState !== "playing" &&
      state.positionSeconds !== prev.positionSeconds
    ) {
      notify();
    }
  });
}

/** A seek pin jumps the displayed playhead even when the second did not change. */
subscribePlaybackPin((seconds) => {
  lastPaintedSecond = Math.floor(seconds);
  lastNotifiedSeconds = seconds;
  for (const listener of listeners) listener(seconds);
});

/** Playhead position without a React render. Notifies when the displayed second changes. */
export function subscribePlaybackClock(
  listener: PlaybackClockListener,
): () => void {
  listeners.add(listener);
  watchStore();
  syncLoop();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) stopLoop();
  };
}

/** Drops listeners and the paint gate. Tests only. */
export function resetPlaybackClock(): void {
  stopLoop();
  listeners.clear();
  lastPaintedSecond = -1;
  lastNotifiedSeconds = -1;
}
