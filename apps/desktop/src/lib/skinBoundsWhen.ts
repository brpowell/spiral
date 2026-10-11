import type {
  LayoutBounds,
  LayoutNode,
  SkinCondition,
  WhenMapOrList,
} from "../types/skin";
import { iterWhenOverlays } from "./skinWhenOverlays";

export function resolveNodeBounds(
  bounds: LayoutBounds | undefined,
  boundsWhen: WhenMapOrList<Partial<LayoutBounds>> | undefined,
  isConditionTrue: (condition: SkinCondition) => boolean,
): LayoutBounds | undefined {
  if (!bounds) return undefined;
  let resolved: LayoutBounds = { ...bounds };
  for (const { when, overlay } of iterWhenOverlays(boundsWhen)) {
    if (isConditionTrue(when)) {
      resolved = { ...resolved, ...overlay };
    }
  }
  return resolved;
}

export function getNodeBoundsWhen(
  node: LayoutNode,
): WhenMapOrList<Partial<LayoutBounds>> | undefined {
  return node.boundsWhen;
}
