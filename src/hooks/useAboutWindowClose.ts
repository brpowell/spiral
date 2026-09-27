import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { hideAboutWindow } from "../lib/aboutWindow";

/** Closing destroys the about webview. The next open creates it again. */
export function useAboutWindowClose(): void {
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    void getCurrentWindow()
      .onCloseRequested(async (event) => {
        event.preventDefault();
        await hideAboutWindow();
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
