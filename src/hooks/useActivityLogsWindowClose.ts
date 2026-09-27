import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { hideActivityLogsWindow } from "../lib/activityLogsWindow";

/** Closing destroys the activity-logs webview. The next open creates it again. */
export function useActivityLogsWindowClose(): void {
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    void getCurrentWindow()
      .onCloseRequested(async (event) => {
        event.preventDefault();
        await hideActivityLogsWindow();
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
