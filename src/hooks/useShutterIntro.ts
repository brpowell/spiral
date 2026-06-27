import { useEffect } from "react";
import {
  cancelShutterIntro,
  scheduleShutterIntro,
} from "../lib/skinShutter";
import { useSkinViewState } from "../lib/skinViewStateContext";
import { useSkinModeShown } from "./useSkinModeShown";

/** T3 main view: after 1s on load, play the shutter-open GIF (WMP `introTimer`). */
export function useShutterIntro(enabled: boolean): void {
  const { values } = useSkinViewState();
  const skinModeShown = useSkinModeShown(enabled);

  useEffect(() => {
    if (!enabled) return;

    if (!skinModeShown || values.shutter !== "intro") {
      if (values.shutter !== "intro") {
        cancelShutterIntro();
      }
      return;
    }

    scheduleShutterIntro();
    return cancelShutterIntro;
  }, [enabled, values.shutter, skinModeShown]);
}
