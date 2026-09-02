import { useEffect, useRef } from "react";
import type { SkinView } from "../types/skin";
import { useSkinBindState } from "../lib/skinBinds";
import { scheduleSkinEffects } from "../lib/skinEffects";
import { useSkinModeShown } from "./useSkinModeShown";

/** Run manifest `view.onActivate` effects when this view's window becomes visible. */
export function useViewActivateEffects(view: SkinView): void {
  const effects = view.onActivate;
  const skinModeShown = useSkinModeShown(!!effects?.length);
  const bindState = useSkinBindState();
  const bindStateRef = useRef(bindState);
  bindStateRef.current = bindState;

  useEffect(() => {
    if (!effects?.length || !skinModeShown) return;

    return scheduleSkinEffects(effects, () => bindStateRef.current);
  }, [effects, skinModeShown]);
}
