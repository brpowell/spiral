import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { hideAboutWindow } from "../lib/aboutWindow";

/** Keep the about webview alive; closing only hides it so it can reopen. */
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
