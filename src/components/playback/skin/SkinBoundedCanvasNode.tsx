import type { LayoutNode, LoadedSkinPack } from "../../../types/skin";
import { useSkinBindState, useSkinVisible } from "../../../lib/skinBinds";
import { getNodeBoundsWhen, resolveNodeBounds } from "../../../lib/skinPanels";
import type { PanelOpenState } from "../../../lib/skinPanels";
import { useSkinStore } from "../../../store/useSkinStore";
import { SkinBounds } from "./SkinBounds";
import { useButtonGroupElevationDelta } from "./SkinButtonGroupHitRegistry";
import { SkinLayoutNode } from "./SkinLayoutNode";

export interface SkinBoundedCanvasNodeProps {
  node: LayoutNode;
  pack: LoadedSkinPack;
  visualizerExpanded: boolean;
  onToggleVisualizer: () => void;
  onOpenQueue: () => void;
  panelOpen: PanelOpenState;
}

export function SkinBoundedCanvasNode({
  node,
  pack,
  visualizerExpanded,
  onToggleVisualizer,
  onOpenQueue,
  panelOpen,
}: SkinBoundedCanvasNodeProps) {
  const visible = useSkinVisible(node.visibleWhen);
  const { viewState } = useSkinBindState();
  const panelRevealed = useSkinStore((s) => s.panelRevealed);
  const panelSettled = useSkinStore((s) => s.panelSettled);
  const panelCtx = { panelOpen, panelRevealed, panelSettled, viewState };
  const elevationDelta = useButtonGroupElevationDelta(
    node.type === "buttonGroup" ? node.id : undefined,
  );

  const boundsWhen = getNodeBoundsWhen(node);
  const hasMotion =
    boundsWhen !== undefined && Object.keys(boundsWhen).length > 0;

  if (node.type === "hitArea") {
    const bounds = resolveNodeBounds(node.bounds, boundsWhen, panelCtx);
    if (!bounds) return null;
    return (
      <SkinBounds
        bounds={bounds}
        boundsFor={node.id}
        debugLabel={node.id ? undefined : "hit"}
        motion={hasMotion}
      >
        {null}
      </SkinBounds>
    );
  }

  if (!visible) return null;

  const inner = (
    <SkinLayoutNode
      node={node}
      pack={pack}
      visualizerExpanded={visualizerExpanded}
      onToggleVisualizer={onToggleVisualizer}
      onOpenQueue={onOpenQueue}
      panelOpen={panelOpen}
    />
  );

  const bounds = resolveNodeBounds(node.bounds, boundsWhen, panelCtx);

  if (bounds) {
    const passthrough =
      node.type === "decoration" || node.type === "buttonGroup";
    const effectiveBounds =
      elevationDelta > 0 && bounds.zIndex !== undefined
        ? {
          ...bounds,
          zIndex: bounds.zIndex + elevationDelta,
        }
        : bounds;

    return (
      <SkinBounds
        bounds={effectiveBounds}
        boundsFor={node.id}
        motion={hasMotion}
        className={passthrough ? "skin-bounds--passthrough" : undefined}
      >
        {inner}
      </SkinBounds>
    );
  }

  return inner;
}
