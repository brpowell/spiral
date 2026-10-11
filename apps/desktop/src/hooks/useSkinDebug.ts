import { useEffect, useState } from "react";
import {
  isSkinDebugEnabled,
  SKIN_DEBUG_CHANGE_EVENT,
} from "../lib/skinDebug";

export function useSkinDebug(): boolean {
  const [enabled, setEnabled] = useState(isSkinDebugEnabled);

  useEffect(() => {
    const sync = () => setEnabled(isSkinDebugEnabled());
    window.addEventListener(SKIN_DEBUG_CHANGE_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(SKIN_DEBUG_CHANGE_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  return enabled;
}
