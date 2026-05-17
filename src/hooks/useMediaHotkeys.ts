import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { usePlayerStore } from "../store/usePlayerStore";

const HOLD_MS = 400;
const SCRUB_INTERVAL_MS = 200;
const SCRUB_DELTA_SECONDS = 3;

type ScrubDirection = "forward" | "back";

interface MediaScrubPayload {
  direction: ScrubDirection;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return true;
  return target.isContentEditable;
}

function shouldIgnoreKeyboardShortcut(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return true;
  if (isEditableTarget(target)) return true;
  if (target.tagName === "BUTTON" || target.closest("button")) return true;
  if (target.closest('[role="dialog"]')) return true;
  return false;
}

function createScrubHandler(
  direction: ScrubDirection,
  onTap: () => void,
  seekRelative: (deltaSeconds: number) => void,
) {
  let gestureActive = false;
  let holdTimer: ReturnType<typeof setTimeout> | null = null;
  let scrubInterval: ReturnType<typeof setInterval> | null = null;
  let isScrubbing = false;
  const delta = direction === "forward" ? SCRUB_DELTA_SECONDS : -SCRUB_DELTA_SECONDS;

  const stopScrubbing = () => {
    if (scrubInterval) {
      clearInterval(scrubInterval);
      scrubInterval = null;
    }
    isScrubbing = false;
  };

  const clear = () => {
    gestureActive = false;
    if (holdTimer) {
      clearTimeout(holdTimer);
      holdTimer = null;
    }
    stopScrubbing();
  };

  return {
    onPress: () => {
      // macOS media keys repeat Press while held; ignore duplicates.
      if (gestureActive) return;
      gestureActive = true;

      holdTimer = setTimeout(() => {
        holdTimer = null;
        isScrubbing = true;
        seekRelative(delta);
        scrubInterval = setInterval(() => seekRelative(delta), SCRUB_INTERVAL_MS);
      }, HOLD_MS);
    },
    onRelease: () => {
      if (!gestureActive) return;
      gestureActive = false;

      if (isScrubbing) {
        stopScrubbing();
        return;
      }

      if (holdTimer) {
        clearTimeout(holdTimer);
        holdTimer = null;
        onTap();
      }
    },
    clear,
  };
}

export function useMediaHotkeys(): void {
  const togglePlayPause = usePlayerStore((s) => s.togglePlayPause);
  const nextTrack = usePlayerStore((s) => s.nextTrack);
  const previousTrack = usePlayerStore((s) => s.previousTrack);
  const seekRelative = usePlayerStore((s) => s.seekRelative);

  useEffect(() => {
    let cancelled = false;
    const cleanups: Array<() => void> = [];

    const scrubForward = createScrubHandler("forward", nextTrack, seekRelative);
    const scrubBack = createScrubHandler("back", previousTrack, seekRelative);

    const scrubHandlers: Record<ScrubDirection, ReturnType<typeof createScrubHandler>> = {
      forward: scrubForward,
      back: scrubBack,
    };

    void Promise.all([
      listen("media-play-pause", () => togglePlayPause()),
      listen("media-next", () => nextTrack()),
      listen("media-prev", () => previousTrack()),
      listen<MediaScrubPayload>("media-scrub-press", (event) => {
        scrubHandlers[event.payload.direction].onPress();
      }),
      listen<MediaScrubPayload>("media-scrub-release", (event) => {
        scrubHandlers[event.payload.direction].onRelease();
      }),
    ]).then((unlisteners) => {
      if (cancelled) {
        unlisteners.forEach((unlisten) => unlisten());
      } else {
        cleanups.push(...unlisteners);
      }
    });

    const onKeyDown = (e: KeyboardEvent) => {
      if (usePlayerStore.getState().editingTrackId != null) return;
      if (shouldIgnoreKeyboardShortcut(e.target)) return;

      if (e.code === "Space" || e.key === " ") {
        e.preventDefault();
        togglePlayPause();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      cancelled = true;
      scrubForward.clear();
      scrubBack.clear();
      cleanups.forEach((unlisten) => unlisten());
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [togglePlayPause, nextTrack, previousTrack, seekRelative]);
}
