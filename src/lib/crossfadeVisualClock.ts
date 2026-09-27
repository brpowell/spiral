import type { CrossfadeVisualState } from "./playback";

type CrossfadeVisualListener = (state: CrossfadeVisualState | null) => void;

const listeners = new Set<CrossfadeVisualListener>();
let latest: CrossfadeVisualState | null = null;

export function notifyCrossfadeVisual(
  state: CrossfadeVisualState | null,
): void {
  latest = state;
  for (const listener of listeners) listener(state);
}

export function subscribeCrossfadeVisual(
  listener: CrossfadeVisualListener,
): () => void {
  listeners.add(listener);
  listener(latest);
  return () => {
    listeners.delete(listener);
  };
}
