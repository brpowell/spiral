import { useEffect, useRef } from "react";
import type { SkinView } from "../types/skin";
import { useSkinBindState } from "../lib/skinBinds";
import { scheduleViewActivateEffects } from "../lib/skinViewActivateEffects";
import { useSkinModeShown } from "./useSkinModeShown";

/** Run manifest `view.onActivate` effects when the skin-mode window becomes visible. */
export function useViewActivateEffects(view: SkinView): void {
  const effects = view.onActivate;
  const skinModeShown = useSkinModeShown(!!effects?.length);
  const bindState = useSkinBindState();
  const bindStateRef = useRef(bindState);
  bindStateRef.current = bindState;

  useEffect(() => {
    if (!effects?.length || !skinModeShown) return;

    return scheduleViewActivateEffects(effects, () => bindStateRef.current);
  }, [effects, skinModeShown]);
}
