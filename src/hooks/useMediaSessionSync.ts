import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef } from "react";
import * as audio from "../lib/audio";
import { usePlayerStore } from "../store/usePlayerStore";
import { isSkinModeWindow, isTauri } from "../lib/windowRole";

/** Batch rapid store updates (e.g. track + play state) into one system push. */
const COALESCE_MS = 80;
/** Position poll is 500ms; avoid re-pushing artwork/metadata on every tick. */
const POSITION_DEBOUNCE_MS = 1_000;

interface MediaSessionUpdate {
  title: string | null;
  artist: string | null;
  album: string | null;
  artPath: string | null;
  durationSeconds: number;
  positionSeconds: number;
  playbackState: "playing" | "paused" | "stopped";
}

function buildUpdate(
  state: ReturnType<typeof usePlayerStore.getState>,
): MediaSessionUpdate | null {
  const track =
    state.currentTrackId === null
      ? null
      : state.library.find((item) => item.id === state.currentTrackId);

  if (!track && state.playbackState === "stopped") {
    return {
      title: null,
      artist: null,
      album: null,
      artPath: null,
      durationSeconds: 0,
      positionSeconds: 0,
      playbackState: "stopped",
    };
  }

  if (!track) return null;

  const durationSeconds =
    track.durationSeconds ?? audio.getDurationSeconds() ?? 0;

  return {
    title: track.title,
    artist: track.artist,
    album: track.album,
    artPath: track.artPath,
    durationSeconds,
    positionSeconds: state.positionSeconds,
    playbackState: state.playbackState,
  };
}

async function pushMediaSession(update: MediaSessionUpdate): Promise<void> {
  await invoke("update_media_session", { update });
}

export function useMediaSessionSync(): void {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isTauri() || isSkinModeWindow()) return;

    const flush = () => {
      timerRef.current = null;
      const update = buildUpdate(usePlayerStore.getState());
      if (!update) return;
      void pushMediaSession(update).catch((err: unknown) => {
        console.error("Failed to sync media session:", err);
      });
    };

    const scheduleFlush = (delayMs: number) => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }
      timerRef.current = setTimeout(flush, delayMs);
    };

    flush();

    const unsubscribe = usePlayerStore.subscribe((state, prev) => {
      const trackChanged = state.currentTrackId !== prev.currentTrackId;
      const playbackChanged = state.playbackState !== prev.playbackState;
      const libraryChanged = state.library !== prev.library;
      const positionChanged = state.positionSeconds !== prev.positionSeconds;

      if (!trackChanged && !playbackChanged && !libraryChanged && !positionChanged) {
        return;
      }

      const positionDelta = Math.abs(
        state.positionSeconds - prev.positionSeconds,
      );
      const isUserSeek =
        positionChanged &&
        !trackChanged &&
        !playbackChanged &&
        positionDelta > 1.25;

      const delay =
        trackChanged ||
        playbackChanged ||
        libraryChanged ||
        isUserSeek
          ? COALESCE_MS
          : POSITION_DEBOUNCE_MS;

      scheduleFlush(delay);
    });

    return () => {
      unsubscribe();
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);
}
