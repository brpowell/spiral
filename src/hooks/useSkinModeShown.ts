import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState } from "react";
import { SKIN_MODE_SHOWN_EVENT } from "../lib/skinModeWindow";
import { isSkinModeWindow } from "../lib/windowRole";

/** True once the skin-mode window is visible (or `spiral:skin-mode-shown` fires). */
export function useSkinModeShown(enabled: boolean): boolean {
  const [skinModeShown, setSkinModeShown] = useState(false);

  useEffect(() => {
    if (!enabled || !isSkinModeWindow()) return;

    let cancelled = false;
    let unlisten: (() => void) | undefined;

    void getCurrentWindow()
      .isVisible()
      .then((visible) => {
        if (!cancelled && visible) setSkinModeShown(true);
      });

    void listen(SKIN_MODE_SHOWN_EVENT, () => {
      setSkinModeShown(true);
    }).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [enabled]);

  return skinModeShown;
}
