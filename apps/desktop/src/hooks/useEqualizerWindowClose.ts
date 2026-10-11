import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { hideEqualizerWindow } from "../lib/equalizerWindow";

/** Closing destroys the equalizer webview. The next open creates it again. */
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
