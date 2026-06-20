import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { hideEqualizerWindow } from "../lib/equalizerWindow";

/** Keep the equalizer webview alive; closing only hides it so it can reopen. */
export function useEqualizerWindowClose(): void {
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    void getCurrentWindow()
      .onCloseRequested(async (event) => {
        event.preventDefault();
        await hideEqualizerWindow();
      })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);
}
