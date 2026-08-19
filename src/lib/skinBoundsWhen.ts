import type { LayoutBounds, LayoutNode } from "../types/skin";
import { evaluateViewBind, type ViewStateValues } from "./skinViewStateContext";

export function resolveNodeBounds(
  bounds: LayoutBounds | undefined,
  boundsWhen: Record<string, Partial<LayoutBounds>> | undefined,
  viewState: ViewStateValues = {},
): LayoutBounds | undefined {
  if (!bounds) return undefined;
  let resolved: LayoutBounds = { ...bounds };
  if (boundsWhen) {
    for (const [condition, override] of Object.entries(boundsWhen)) {
      const viewValue = evaluateViewBind(condition, viewState);
      if (viewValue) {
        resolved = { ...resolved, ...override };
      }
    }
  }
  return resolved;
}

export function getNodeBoundsWhen(
  node: LayoutNode,
): Record<string, Partial<LayoutBounds>> | undefined {
  return node.boundsWhen;
}
