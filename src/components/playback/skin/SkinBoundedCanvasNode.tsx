import type { LayoutNode, LoadedSkinPack } from "../../../types/skin";
import { useSkinBindState, useSkinVisible } from "../../../lib/skinBinds";
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

export interface SkinBoundedCanvasNodeProps {
  node: LayoutNode;
  pack: LoadedSkinPack;
}

export function SkinBoundedCanvasNode({
  node,
  pack,
}: SkinBoundedCanvasNodeProps) {
  const visible = useSkinVisible(node.visibleWhen);
  const { viewState } = useSkinBindState();
  const parentLayout = useSkinLayoutContext();
  const elevationDelta = useButtonGroupElevationDelta(
    node.type === "buttonGroup" ? node.id : undefined,
  );

  const boundsWhen = getNodeBoundsWhen(node);
  const hasMotion =
    boundsWhen !== undefined && Object.keys(boundsWhen).length > 0;

  if (!visible) return null;

  const inner = <SkinLayoutNode node={node} pack={pack} />;

  const bounds = resolveNodeBounds(node.bounds, boundsWhen, viewState);

  if (bounds) {
    const passthrough =
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
          motion={hasMotion}
          windowHit={resolveSkinWindowHitKind(node)}
          className={passthrough ? "skin-bounds--passthrough" : undefined}
        >
          {inner}
        </SkinBounds>
      </SkinLayoutContextProvider>
    );
  }

  return inner;
}
