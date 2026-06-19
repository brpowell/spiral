import type { LayoutNode, LoadedSkinPack, TextStyle } from "../../../types/skin";
import { useSkinVisible } from "../../../lib/skinBinds";
import { getNodeBoundsWhen, resolveNodeBounds } from "../../../lib/skinPanels";
import type { PanelOpenState } from "../../../lib/skinPanels";
import { useSkinStore } from "../../../store/useSkinStore";
import { SkinBounds } from "./SkinBounds";
import { SkinLayoutNode } from "./SkinLayoutNode";

export interface SkinBoundedCanvasNodeProps {
  node: LayoutNode;
  pack: LoadedSkinPack;
  textStyles: Record<string, TextStyle>;
  visualizerExpanded: boolean;
  onToggleVisualizer: () => void;
  onOpenQueue: () => void;
  panelOpen: PanelOpenState;
}

export function SkinBoundedCanvasNode({
  node,
  pack,
  textStyles,
  visualizerExpanded,
  onToggleVisualizer,
  onOpenQueue,
  panelOpen,
}: SkinBoundedCanvasNodeProps) {
  const visible = useSkinVisible(node.visibleWhen);
  const panelRevealed = useSkinStore((s) => s.panelRevealed);
  const panelSettled = useSkinStore((s) => s.panelSettled);
  const panelCtx = { panelOpen, panelRevealed, panelSettled };

  const boundsWhen = getNodeBoundsWhen(node);
  const hasMotion =
    boundsWhen !== undefined && Object.keys(boundsWhen).length > 0;

  if (node.type === "dragRegion") {
    const bounds = resolveNodeBounds(node.bounds, boundsWhen, panelCtx);
    if (!bounds) return null;
    return (
      <SkinBounds
        bounds={bounds}
        debugLabel={node.id ?? "drag"}
        dragRegion
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
      textStyles={textStyles}
      visualizerExpanded={visualizerExpanded}
      onToggleVisualizer={onToggleVisualizer}
      onOpenQueue={onOpenQueue}
      panelOpen={panelOpen}
    />
  );

  const bounds = resolveNodeBounds(node.bounds, boundsWhen, panelCtx);

  if (bounds) {
    return (
      <SkinBounds
        bounds={bounds}
        debugLabel={node.id}
        motion={hasMotion}
        dragRegion={
          node.type === "decoration" && node.dragRegion === true
        }
      >
        {inner}
      </SkinBounds>
    );
  }

  return inner;
}
