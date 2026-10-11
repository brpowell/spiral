import { useMemo } from "react";
import type {
  LayoutNode,
  LoadedSkinPack,
  SkinCondition,
} from "../../../types/skin";
import {
  evaluateSkinCondition,
  useSkinBindState,
  useSkinVisible,
} from "../../../lib/skinBinds";
import {
  getNodeBoundsWhen,
  resolveNodeBounds,
} from "../../../lib/skinBoundsWhen";
import {
  useSkinHoverLeaveEffects,
  useSkinHoverPointerHandlers,
} from "../../../lib/skinHoverContext";
import { resolveLocalBounds } from "../../../lib/skinLayout";
import { resolveNodeStyle } from "../../../lib/skinNodeStyle";
import { resolveNodeTransition } from "../../../lib/skinTransition";
import { iterWhenOverlays } from "../../../lib/skinWhenOverlays";
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
  const bindState = useSkinBindState();
  const parentLayout = useSkinLayoutContext();
  const elevationDelta = useButtonGroupElevationDelta(
    node.type === "buttonGroup" ? node.id : undefined,
  );
  const hoverIds = useMemo(() => (node.id ? [node.id] : []), [node.id]);
  const hoverPointer = useSkinHoverPointerHandlers(
    hoverIds,
    node.id ?? "",
    visible,
  );
  useSkinHoverLeaveEffects(node.id, node.onHoverLeave, () => bindState);

  const boundsWhen = getNodeBoundsWhen(node);

  if (!visible) return null;

  const inner = <SkinLayoutNode node={node} pack={pack} />;

  const isConditionTrue = (condition: SkinCondition) =>
    evaluateSkinCondition(condition, bindState);
  const bounds = resolveNodeBounds(node.bounds, boundsWhen, isConditionTrue);
  const resolvedStyle = resolveNodeStyle(
    node.style,
    node.styleWhen,
    isConditionTrue,
  );
  const transition = resolveNodeTransition(
    node.transition,
    node.transitionWhen,
    isConditionTrue,
  );
  const opacityAuthored =
    node.style?.opacity !== undefined ||
    iterWhenOverlays(node.styleWhen).some(
      ({ overlay }) => overlay.opacity !== undefined,
    );
  const opacity = opacityAuthored ? (resolvedStyle?.opacity ?? 1) : undefined;

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
          transition={transition}
          windowHit={resolveSkinWindowHitKind(node)}
          opacity={opacity}
          pointerIdle={opacity === 0}
          onPointerEnter={hoverPointer?.onPointerEnter}
          onPointerLeave={hoverPointer?.onPointerLeave}
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
