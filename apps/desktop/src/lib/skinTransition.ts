import type {
  SkinCondition,
  SkinLayoutTransition,
  WhenMapOrList,
} from "../types/skin";
import { iterWhenOverlays } from "./skinWhenOverlays";

/** Shallow-merge `transitionWhen` overlays onto `transition` (last match wins). */
export function resolveNodeTransition(
  transition: SkinLayoutTransition | undefined,
  transitionWhen: WhenMapOrList<SkinLayoutTransition> | undefined,
  isConditionTrue: (condition: SkinCondition) => boolean,
): SkinLayoutTransition | undefined {
  let resolved = transition;
  for (const { when, overlay } of iterWhenOverlays(transitionWhen)) {
    if (isConditionTrue(when)) {
      resolved = { ...resolved, ...overlay };
    }
  }
  return resolved;
}
