import { useEffect } from "react";
import type { SkinView } from "../types/skin";
import { scheduleViewActivateEffects } from "../lib/skinViewActivateEffects";
import { getSkinViewStateApi } from "../lib/skinViewStateContext";
import { useSkinModeShown } from "./useSkinModeShown";

/** Run manifest `view.onActivate` effects when the skin-mode window becomes visible. */
export function useViewActivateEffects(view: SkinView): void {
  const effects = view.onActivate;
  const skinModeShown = useSkinModeShown(!!effects?.length);

  useEffect(() => {
    if (!effects?.length || !skinModeShown) return;

    return scheduleViewActivateEffects(effects, () =>
      getSkinViewStateApi()?.values ?? {},
    );
  }, [effects, skinModeShown]);
}
