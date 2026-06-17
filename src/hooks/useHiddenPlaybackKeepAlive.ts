import { useEffect } from "react";
import { resumeAudioContext } from "../lib/playback";
import { isSkinModeWindow, isAppearanceWindow } from "../lib/windowRole";
import { usePlayerStore } from "../store/usePlayerStore";

/** How often to try resuming suspended output while playback is active. */
const KEEPALIVE_INTERVAL_MS = 400;

/**
 * The main window is hidden while skin mode is open but still owns playback.
 * macOS/WKWebView may suspend its AudioContext when another window shows a
 * native menu — resume output whenever the store says we should be playing.
 */
export function useHiddenPlaybackKeepAlive(): void {
  useEffect(() => {
    if (isSkinModeWindow() || isAppearanceWindow()) return;

    let intervalId: ReturnType<typeof setInterval> | null = null;

    const ensureOutputRunning = () => {
      if (usePlayerStore.getState().playbackState !== "playing") return;
      void resumeAudioContext();
    };

    const syncPolling = () => {
      const playing = usePlayerStore.getState().playbackState === "playing";
      if (playing && intervalId === null) {
        ensureOutputRunning();
        intervalId = setInterval(ensureOutputRunning, KEEPALIVE_INTERVAL_MS);
      } else if (!playing && intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };

    syncPolling();
    const unsubscribe = usePlayerStore.subscribe(syncPolling);

    document.addEventListener("visibilitychange", ensureOutputRunning);
    window.addEventListener("focus", ensureOutputRunning);

    return () => {
      unsubscribe();
      if (intervalId !== null) clearInterval(intervalId);
      document.removeEventListener("visibilitychange", ensureOutputRunning);
      window.removeEventListener("focus", ensureOutputRunning);
    };
  }, []);
}
