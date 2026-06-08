import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { hideSkinPickerWindow } from "../lib/skinPickerWindow";

/** Keep the skin-picker webview alive; closing only hides it so it can reopen. */
export function useSkinPickerWindowClose(): void {
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    void getCurrentWindow()
      .onCloseRequested(async (event) => {
        event.preventDefault();
        await hideSkinPickerWindow();
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
