import type { SkinView } from "../types/skin";
import { useIntroLight } from "./useIntroLight";
import { useShutterIntro } from "./useShutterIntro";

export function useViewRuntimeEffects(view: SkinView): void {
  useShutterIntro(view.state?.shutter?.default === "intro");
  useIntroLight(view.state?.introLight?.default === "pending");
}
