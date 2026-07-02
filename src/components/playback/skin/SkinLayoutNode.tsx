import type { LayoutNode, LoadedSkinPack } from "../../../types/skin";
import type { PanelOpenState } from "../../../lib/skinPanels";
import { useSkinVisible } from "../../../lib/skinBinds";
import { skinDragRegionDeepProps } from "../../../lib/skinDragRegion";
import { SkinBoundedCanvasNode } from "./SkinBoundedCanvasNode";
import { SkinBitmapButton } from "./SkinBitmapButton";
import { SkinButtonGroup } from "./SkinButtonGroup";
import { SkinPrimitiveButton } from "./SkinPrimitiveButton";
import { SkinDecoration } from "./SkinDecoration";
import { SkinPrimitiveControl } from "./SkinPrimitiveControl";
import { SkinDigitTime } from "./SkinDigitTime";
import { SkinPlaylistView } from "../SkinPlaylistView/SkinPlaylistView";
import { SkinStripSlider } from "./SkinStripSlider";
import { SkinBitmapHorizontalSlider } from "./SkinBitmapHorizontalSlider";
import { SkinEqBandSlider } from "./SkinEqBandSlider";
import { SkinBitmapSeekbar } from "./SkinBitmapSeekbar";
import { SkinFramedVisualizer } from "./SkinFramedVisualizer";
import { SkinTiledFrame } from "./SkinTiledFrame";
import { SkinSlideshow } from "./SkinSlideshow";
import { SkinText } from "./SkinText";
import "./SkinLayoutNode.css";

export interface SkinLayoutNodeProps {
  node: LayoutNode;
  pack: LoadedSkinPack;
  visualizerExpanded: boolean;
  onToggleVisualizer: () => void;
  onOpenQueue: () => void;
  panelOpen?: PanelOpenState;
}

export function SkinLayoutNode({
  node,
  pack,
  visualizerExpanded,
  onToggleVisualizer,
  onOpenQueue,
  panelOpen = {},
}: SkinLayoutNodeProps) {
  const visible = useSkinVisible(node.visibleWhen);
  if (!visible) return null;

  if (node.type === "decoration") {
    return <SkinDecoration node={node} pack={pack} />;
  }

  if (node.type === "text") {
    return <SkinText node={node} />;
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

  if (node.type === "slideshow" && node.presentation.kind === "imageSequence") {
    return <SkinSlideshow node={node} pack={pack} />;
  }

  if (node.type === "canvas") {
    return (
      <div
        className="skin-layout-node skin-layout-node--canvas"
        data-node-id={node.id}
      >
        {node.children.map((child, index) => (
          <SkinBoundedCanvasNode
            key={child.id ?? index}
            node={child}
            pack={pack}
            visualizerExpanded={visualizerExpanded}
            onToggleVisualizer={onToggleVisualizer}
            onOpenQueue={onOpenQueue}
            panelOpen={panelOpen}
          />
        ))}
      </div>
    );
  }

  if (node.type === "tiledFrame") {
    return (
      <SkinTiledFrame node={node} pack={pack}>
        {node.children.map((child, index) => (
          <SkinBoundedCanvasNode
            key={child.id ?? index}
            node={child}
            pack={pack}
            visualizerExpanded={visualizerExpanded}
            onToggleVisualizer={onToggleVisualizer}
            onOpenQueue={onOpenQueue}
            panelOpen={panelOpen}
          />
        ))}
      </SkinTiledFrame>
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
          <SkinBoundedCanvasNode
            key={child.id ?? index}
            node={child}
            pack={pack}
            visualizerExpanded={visualizerExpanded}
            onToggleVisualizer={onToggleVisualizer}
            onOpenQueue={onOpenQueue}
            panelOpen={panelOpen}
          />
        ))}
      </div>
    );
  }

  if (node.type === "time" && node.presentation.kind === "digitStrip") {
    return <SkinDigitTime node={node} pack={pack} />;
  }

  if (node.type === "playlist" && node.presentation.kind === "compact") {
    return <SkinPlaylistView presentation={node.presentation} nodeId={node.id} />;
  }

  if (
    node.type === "seekbar" &&
    node.presentation.kind === "bitmapSeekbar"
  ) {
    return <SkinBitmapSeekbar node={node} pack={pack} />;
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

  if (node.type === "eqBand" && node.presentation.kind === "bitmapVerticalSlider") {
    return <SkinEqBandSlider node={node} pack={pack} />;
  }

  if (
    (node.type === "balance" || node.type === "volume") &&
    node.presentation.kind === "bitmapHorizontalSlider"
  ) {
    return <SkinBitmapHorizontalSlider node={node} pack={pack} />;
  }

  if (node.type === "eqBand" && node.presentation.kind === "stripSlider") {
    return <SkinStripSlider node={node} pack={pack} mode="eq" />;
  }

  if (
    node.type === "visualizer" &&
    node.presentation.kind === "framedPanel"
  ) {
    return (
      <SkinFramedVisualizer
        node={node}
        pack={pack}
        manifest={pack.manifest}
        visualizerExpanded={visualizerExpanded}
        onToggleVisualizer={onToggleVisualizer}
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
