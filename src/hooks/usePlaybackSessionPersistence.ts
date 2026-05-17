import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useRef } from "react";
import { collectPlaybackSession } from "../lib/playbackSession";
import { savePlaybackSession } from "../lib/tauri";
import { usePlayerStore } from "../store/usePlayerStore";

const SAVE_DEBOUNCE_MS = 1_500;

async function persistPlaybackSession(): Promise<void> {
  await savePlaybackSession(collectPlaybackSession());
}

export function usePlaybackSessionPersistence(): void {
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const scheduleSave = () => {
      if (saveTimerRef.current !== null) {
        clearTimeout(saveTimerRef.current);
      }
      saveTimerRef.current = setTimeout(() => {
        saveTimerRef.current = null;
        void persistPlaybackSession().catch((err) => {
          console.error("Failed to save playback session:", err);
        });
      }, SAVE_DEBOUNCE_MS);
    };

    const unsubscribe = usePlayerStore.subscribe((state, prev) => {
      if (
        state.playContextIds !== prev.playContextIds ||
        state.manualQueueIds !== prev.manualQueueIds ||
        state.currentTrackId !== prev.currentTrackId ||
        state.positionSeconds !== prev.positionSeconds ||
        state.playbackState !== prev.playbackState ||
        state.shuffle !== prev.shuffle ||
        state.repeatMode !== prev.repeatMode
      ) {
        scheduleSave();
      }
    });

    let unlistenClose: (() => void) | undefined;
    let cancelled = false;

    void getCurrentWindow()
      .onCloseRequested(async (event) => {
        event.preventDefault();
        if (saveTimerRef.current !== null) {
          clearTimeout(saveTimerRef.current);
          saveTimerRef.current = null;
        }
        try {
          await persistPlaybackSession();
        } catch (err) {
          console.error("Failed to save playback session on close:", err);
        } finally {
          await getCurrentWindow().destroy();
        }
      })
      .then((fn) => {
        if (cancelled) {
          fn();
          return;
        }
        unlistenClose = fn;
      });

    return () => {
      cancelled = true;
      unsubscribe();
      unlistenClose?.();
      if (saveTimerRef.current !== null) {
        clearTimeout(saveTimerRef.current);
      }
    };
  }, []);
}
