import type { LayoutNode, LoadedSkinPack } from "../../../types/skin";
import { useSkinVisible } from "../../../lib/skinBinds";
import {
  getNodeBoundsWhen,
  resolveNodeBounds,
} from "../../../lib/skinBoundsWhen";
import { resolveLocalBounds } from "../../../lib/skinLayout";
import { resolveSkinWindowHitKind } from "../../../lib/skinWindowHit";
import { SkinBounds } from "./SkinBounds";
import { useButtonGroupElevationDelta } from "./SkinButtonGroupHitRegistry";
import {
  SkinLayoutContextProvider,
  useSkinLayoutContext,
} from "./SkinLayoutContext";
import { SkinLayoutNode } from "./SkinLayoutNode";
import { useSkinViewState } from "../../../lib/skinViewStateContext";

export interface SkinBoundedCanvasNodeProps {
  node: LayoutNode;
  pack: LoadedSkinPack;
}

export function SkinBoundedCanvasNode({
  node,
  pack,
}: SkinBoundedCanvasNodeProps) {
  const visible = useSkinVisible(node.visibleWhen);
  const { values: viewState } = useSkinViewState();
  const parentLayout = useSkinLayoutContext();
  const elevationDelta = useButtonGroupElevationDelta(
    node.type === "buttonGroup" ? node.id : undefined,
  );

  const boundsWhen = getNodeBoundsWhen(node);

  if (!visible) return null;

  const inner = <SkinLayoutNode node={node} pack={pack} />;

  const bounds = resolveNodeBounds(node.bounds, boundsWhen, viewState);

  if (bounds) {
    // Subview boxes never capture; only nested controls do. Authored
    // `passthrough` additionally leaves overflow unclipped.
    const passthrough =
      node.type === "decoration" ||
      node.type === "buttonGroup" ||
      node.type === "subview";
    const unclipped =
      node.type === "decoration" ||
      node.type === "buttonGroup" ||
      (node.type === "subview" && node.passthrough === true);
    const effectiveBounds =
      elevationDelta > 0 && bounds.zIndex !== undefined
        ? {
            ...bounds,
            zIndex: bounds.zIndex + elevationDelta,
          }
        : bounds;

    const local = resolveLocalBounds(effectiveBounds, parentLayout.size);
    const childLayout = {
      origin: {
        x: parentLayout.origin.x + local.x,
        y: parentLayout.origin.y + local.y,
      },
      size: { width: local.w, height: local.h },
      space: "parent" as const,
    };

    return (
      <SkinLayoutContextProvider value={childLayout}>
        <SkinBounds
          bounds={local}
          boundsFor={node.id}
          transition={node.transition}
          windowHit={resolveSkinWindowHitKind(node)}
          className={
            [
              passthrough && "skin-bounds--passthrough",
              unclipped && "skin-bounds--unclipped",
            ]
              .filter(Boolean)
              .join(" ") || undefined
          }
        >
          {inner}
        </SkinBounds>
      </SkinLayoutContextProvider>
    );
  }

  return inner;
}
