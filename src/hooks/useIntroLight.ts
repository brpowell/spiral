import { useEffect } from "react";
import { useSkinViewState } from "../lib/skinViewStateContext";
import { useSkinModeShown } from "./useSkinModeShown";

/** T3 main view: play the intro light sweep GIF once the skin window is visible. */
export function useIntroLight(enabled: boolean): void {
  const { values, setVariable } = useSkinViewState();
  const skinModeShown = useSkinModeShown(enabled);

  useEffect(() => {
    if (!enabled || !skinModeShown || values.introLight !== "pending") return;
    setVariable("introLight", "playing");
  }, [enabled, skinModeShown, values.introLight, setVariable]);
}
