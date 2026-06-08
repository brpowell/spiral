import type { DragRegionNode } from "../../../types/skin";
import { useSkinVisible } from "../../../lib/skinBinds";
import { SkinBounds } from "./SkinBounds";
import "./SkinDragRegion.css";

/** Invisible hit target for moving a frameless skin window (Tauri drag region). */
export function SkinDragRegion({ node }: { node: DragRegionNode }) {
  const visible = useSkinVisible(node.visibleWhen);
  if (!visible || !node.bounds) return null;

  return (
    <SkinBounds
      bounds={node.bounds}
      debugLabel={node.id ?? "drag"}
      dragRegion
      className="skin-drag-region"
    >
      {null}
    </SkinBounds>
  );
}
