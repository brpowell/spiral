import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { findPlaybackTrack } from "@/lib/playback/playbackTrack";
import { usePlayerStore } from "@/store/usePlayerStore";

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

function createScrubber(
  direction: ScrubDirection,
  seekRelative: (deltaSeconds: number) => void,
) {
  let scrubInterval: ReturnType<typeof setInterval> | null = null;
  const delta =
    direction === "forward" ? SCRUB_DELTA_SECONDS : -SCRUB_DELTA_SECONDS;

  const end = () => {
    if (scrubInterval) {
      clearInterval(scrubInterval);
      scrubInterval = null;
    }
  };

  return {
    // macOS only sends begin-seeking for a held key; a tap arrives as the
    // plain next/previous command.
    begin: () => {
      if (scrubInterval) return;
      seekRelative(delta);
      scrubInterval = setInterval(() => seekRelative(delta), SCRUB_INTERVAL_MS);
    },
    end,
  };
}

export function useMediaHotkeys(): void {
  const togglePlayPause = usePlayerStore((s) => s.togglePlayPause);
  const pause = usePlayerStore((s) => s.pause);
  const resume = usePlayerStore((s) => s.resume);
  const seek = usePlayerStore((s) => s.seek);
  const nextTrack = usePlayerStore((s) => s.nextTrack);
  const previousTrack = usePlayerStore((s) => s.previousTrack);
  const seekRelative = usePlayerStore((s) => s.seekRelative);

  useEffect(() => {
    let cancelled = false;
    const cleanups: Array<() => void> = [];

    const scrubForward = createScrubber("forward", seekRelative);
    const scrubBack = createScrubber("back", seekRelative);

    const scrubHandlers: Record<
      ScrubDirection,
      ReturnType<typeof createScrubber>
    > = {
      forward: scrubForward,
      back: scrubBack,
    };

    void Promise.all([
      listen("media-play-pause", () => togglePlayPause()),
      listen("media-play", () => resume()),
      listen("media-pause", () => pause()),
      listen("media-next", () => nextTrack()),
      listen("media-prev", () => previousTrack()),
      listen<number>("media-seek", (event) => {
        const { currentTrackId, library, playbackTracks } =
          usePlayerStore.getState();
        if (currentTrackId === null) return;
        const track = findPlaybackTrack({
          library,
          playbackTracks,
          currentTrackId,
        });
        const duration = track?.durationSeconds ?? 0;
        if (duration <= 0) return;
        seek(Math.max(0, Math.min(1, event.payload / duration)));
      }),
      listen<number>("media-seek-delta", (event) => {
        seekRelative(event.payload);
      }),
      listen<MediaScrubPayload>("media-scrub-begin", (event) => {
        scrubHandlers[event.payload.direction].begin();
      }),
      listen<MediaScrubPayload>("media-scrub-end", (event) => {
        scrubHandlers[event.payload.direction].end();
      }),
    ]).then((unlisteners) => {
      if (cancelled) {
        unlisteners.forEach((unlisten) => unlisten());
      } else {
        cleanups.push(...unlisteners);
      }
    });

    const onKeyDown = (e: KeyboardEvent) => {
      if (usePlayerStore.getState().editingTrackIds.length > 0) return;
      if (shouldIgnoreKeyboardShortcut(e.target)) return;

      if (e.code === "Space" || e.key === " ") {
        e.preventDefault();
        togglePlayPause();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      cancelled = true;
      scrubForward.end();
      scrubBack.end();
      cleanups.forEach((unlisten) => unlisten());
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [
    togglePlayPause,
    pause,
    resume,
    seek,
    nextTrack,
    previousTrack,
    seekRelative,
  ]);
}
