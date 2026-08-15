import { useEffect } from "react";
import { resumeAudioContext } from "../lib/playback";
import { sharedPcmContextNeedsRebuild } from "../lib/playback/pcmSharedContext";
import { isSkinModeWindow, isAppearanceWindow } from "../lib/windowRole";
import { usePlayerStore } from "../store/usePlayerStore";

/** How often to try resuming suspended output while playback is active. */
const KEEPALIVE_INTERVAL_MS = 400;

/**
 * The main window is hidden while skin mode is open but still owns playback.
 * macOS/WKWebView may suspend its AudioContext when another window shows a
 * native menu — resume output whenever the store says we should be playing.
 *
 * After system sleep the graph can be dead until a user gesture; a click/key
 * while "playing" rebuilds it via `resume()` → `play()`.
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

    const healFromUserGesture = () => {
      if (!sharedPcmContextNeedsRebuild()) return;
      if (usePlayerStore.getState().playbackState !== "playing") return;
      usePlayerStore.getState().resume();
    };

    document.addEventListener("visibilitychange", ensureOutputRunning);
    window.addEventListener("focus", ensureOutputRunning);
    window.addEventListener("pointerdown", healFromUserGesture, true);
    window.addEventListener("keydown", healFromUserGesture, true);

    return () => {
      unsubscribe();
      if (intervalId !== null) clearInterval(intervalId);
      document.removeEventListener("visibilitychange", ensureOutputRunning);
      window.removeEventListener("focus", ensureOutputRunning);
      window.removeEventListener("pointerdown", healFromUserGesture, true);
      window.removeEventListener("keydown", healFromUserGesture, true);
    };
  }, []);
}
