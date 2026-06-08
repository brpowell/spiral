import type { LayoutNode, LoadedSkinPack, TextStyle } from "../../../types/skin";
import { useSkinVisible } from "../../../lib/skinBinds";
import { skinDragRegionDeepProps } from "../../../lib/skinDragRegion";
import { SkinBitmapButton } from "./SkinBitmapButton";
import { SkinButtonGroup } from "./SkinButtonGroup";
import { SkinPrimitiveButton } from "./SkinPrimitiveButton";
import { SkinDecoration } from "./SkinDecoration";
import { SkinPrimitiveControl } from "./SkinPrimitiveControl";
import { SkinDigitTime } from "./SkinDigitTime";
import { SkinStripSlider } from "./SkinStripSlider";
import { SkinText } from "./SkinText";
import "./SkinLayoutNode.css";

export interface SkinLayoutNodeProps {
  node: LayoutNode;
  pack: LoadedSkinPack;
  textStyles: Record<string, TextStyle>;
  visualizerExpanded: boolean;
  onToggleVisualizer: () => void;
  onOpenQueue: () => void;
}

export function SkinLayoutNode({
  node,
  pack,
  textStyles,
  visualizerExpanded,
  onToggleVisualizer,
  onOpenQueue,
}: SkinLayoutNodeProps) {
  const visible = useSkinVisible(node.visibleWhen);
  if (!visible) return null;

  if (node.type === "decoration") {
    return <SkinDecoration node={node} pack={pack} />;
  }

  if (node.type === "text") {
    return <SkinText node={node} textStyles={textStyles} />;
  }

  if (node.type === "button" && node.presentation.kind === "bitmap") {
    return <SkinBitmapButton node={node} pack={pack} />;
  }

  if (node.type === "button" && node.presentation.kind === "primitive") {
    return <SkinPrimitiveButton node={node} />;
  }

  if (node.type === "buttonGroup" && node.presentation.kind === "buttonGroup") {
    return <SkinButtonGroup node={node} pack={pack} />;
  }

  if (node.type === "canvas") {
    return (
      <div className="skin-layout-node skin-layout-node--canvas" data-node-id={node.id}>
        {node.children.map((child, index) => (
          <SkinLayoutNode
            key={child.id ?? index}
            node={child}
            pack={pack}
            textStyles={textStyles}
            visualizerExpanded={visualizerExpanded}
            onToggleVisualizer={onToggleVisualizer}
            onOpenQueue={onOpenQueue}
          />
        ))}
      </div>
    );
  }

  if (
    node.type === "stack" ||
    node.type === "row" ||
    node.type === "column" ||
    node.type === "overlay"
  ) {
    const layoutClass = `skin-layout-node skin-layout-node--${node.type}`;
    return (
      <div
        className={layoutClass}
        data-node-id={node.id}
        {...(node.dragRegion ? skinDragRegionDeepProps() : {})}
      >
        {node.children.map((child, index) => (
          <SkinLayoutNode
            key={child.id ?? index}
            node={child}
            pack={pack}
            textStyles={textStyles}
            visualizerExpanded={visualizerExpanded}
            onToggleVisualizer={onToggleVisualizer}
            onOpenQueue={onOpenQueue}
          />
        ))}
      </div>
    );
  }

  if (node.type === "time" && node.presentation.kind === "digitStrip") {
    return <SkinDigitTime node={node} pack={pack} />;
  }

  if (
    (node.type === "seekbar" || node.type === "volume") &&
    node.presentation.kind === "stripSlider"
  ) {
    return (
      <SkinStripSlider
        node={node}
        pack={pack}
        mode={node.type === "volume" ? "volume" : "seek"}
      />
    );
  }

  if (
    node.type === "seekbar" ||
    node.type === "artwork" ||
    node.type === "transport" ||
    node.type === "visualizer" ||
    node.type === "volume" ||
    node.type === "queue"
  ) {
    return (
      <SkinPrimitiveControl
        node={node}
        manifest={pack.manifest}
        visualizerExpanded={visualizerExpanded}
        onToggleVisualizer={onToggleVisualizer}
        onOpenQueue={onOpenQueue}
      />
    );
  }

  return null;
}
