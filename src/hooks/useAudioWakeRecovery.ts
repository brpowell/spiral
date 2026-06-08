import { useEffect, useRef } from "react";
import { isSkinModeWindow, isSkinPickerWindow } from "../lib/windowRole";
import { usePlayerStore } from "../store/usePlayerStore";

/** Only replay after the app was hidden long enough to likely be asleep. */
const MIN_HIDDEN_MS = 5_000;
const RECOVER_DEBOUNCE_MS = 200;

export function useAudioWakeRecovery(): void {
  const hiddenAtRef = useRef<number | null>(null);
  const recoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recoveringRef = useRef(false);

  useEffect(() => {
    if (isSkinModeWindow() || isSkinPickerWindow()) return;

    const scheduleRecover = (hiddenDurationMs: number) => {
      if (hiddenDurationMs < MIN_HIDDEN_MS) return;

      if (recoverTimerRef.current !== null) {
        clearTimeout(recoverTimerRef.current);
      }

      recoverTimerRef.current = setTimeout(() => {
        recoverTimerRef.current = null;
        if (recoveringRef.current) return;

        recoveringRef.current = true;
        void usePlayerStore
          .getState()
          .recoverPlaybackAfterWake()
          .catch((err: unknown) => {
            console.error("Audio wake recovery failed:", err);
          })
          .finally(() => {
            recoveringRef.current = false;
          });
      }, RECOVER_DEBOUNCE_MS);
    };

    const onHidden = () => {
      hiddenAtRef.current = Date.now();
    };

    const onVisible = () => {
      const hiddenAt = hiddenAtRef.current;
      hiddenAtRef.current = null;
      if (hiddenAt === null) return;
      scheduleRecover(Date.now() - hiddenAt);
    };

    const onVisibilityChange = () => {
      if (document.hidden) {
        onHidden();
      } else {
        onVisible();
      }
    };

    const onWindowFocus = () => {
      const hiddenAt = hiddenAtRef.current;
      if (hiddenAt === null) return;
      onVisible();
    };

    if (document.hidden) {
      onHidden();
    }

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", onWindowFocus);

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", onWindowFocus);
      if (recoverTimerRef.current !== null) {
        clearTimeout(recoverTimerRef.current);
      }
    };
  }, []);
}
