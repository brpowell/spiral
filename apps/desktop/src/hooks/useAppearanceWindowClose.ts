import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { hideAppearanceWindow } from "../lib/appearanceWindow";

/** Keep the appearance webview alive; closing only hides it so it can reopen. */
export function useAppearanceWindowClose(): void {
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    void getCurrentWindow()
      .onCloseRequested(async (event) => {
        event.preventDefault();
        await hideAppearanceWindow();
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
