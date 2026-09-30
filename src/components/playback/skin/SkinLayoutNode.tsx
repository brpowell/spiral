import type { LayoutNode, LoadedSkinPack } from "../../../types/skin";
import { useSkinVisible } from "../../../lib/skinBinds";
import { skinDragRegionDeepProps } from "../../../lib/skinDragRegion";
import { sortChildrenByZIndex } from "../../../lib/skinLayout";
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
import { SkinBitmapVerticalSlider } from "./SkinBitmapVerticalSlider";
import { SkinFramedVisualizer } from "./SkinFramedVisualizer";
import { SkinTiledFrame } from "./SkinTiledFrame";
import { SkinSlideshow } from "./SkinSlideshow";
import { SkinScrollStrip } from "./SkinScrollStrip";
import {
  styleFromSkinNode,
  useResolvedNodeStyle,
} from "../../../lib/skinNodeStyle";
import { SkinRating } from "./SkinRating";
import { SkinText } from "./SkinText";
import { SkinInput } from "./SkinInput";

export interface SkinLayoutNodeProps {
  node: LayoutNode;
  pack: LoadedSkinPack;
}

function nodeClassName(
  ...parts: Array<string | undefined | false>
): string | undefined {
  const joined = parts.filter(Boolean).join(" ");
  return joined || undefined;
}

function renderBoundedChildren(children: LayoutNode[], pack: LoadedSkinPack) {
  return children.map((child, index) => (
    <SkinBoundedCanvasNode key={child.id ?? index} node={child} pack={pack} />
  ));
}

export function SkinLayoutNode({ node, pack }: SkinLayoutNodeProps) {
  const visible = useSkinVisible(node.visibleWhen);
  const resolvedStyle = useResolvedNodeStyle(node.style, node.styleWhen);
  const css = styleFromSkinNode(resolvedStyle, {
    omitOpacity: node.bounds !== undefined,
  });
  if (!visible) return null;

  if (node.type === "decoration") {
    return <SkinDecoration node={node} pack={pack} />;
  }

  if (node.type === "text") {
    return <SkinText node={node} />;
  }

  if (node.type === "input") {
    return <SkinInput node={node} />;
  }

  if (node.type === "button" && node.presentation.kind === "bitmap") {
    return <SkinBitmapButton node={node} pack={pack} />;
  }

  if (node.type === "button" && node.presentation.kind === "primitive") {
    return <SkinPrimitiveButton node={node} pack={pack} />;
  }

  if (node.type === "buttonGroup" && node.presentation.kind === "buttonGroup") {
    return <SkinButtonGroup node={node} pack={pack} />;
  }

  if (node.type === "slideshow" && node.presentation.kind === "imageSequence") {
    return <SkinSlideshow node={node} pack={pack} />;
  }

  if (
    node.type === "scrollStrip" &&
    node.presentation.kind === "bitmapVertical"
  ) {
    return <SkinScrollStrip node={node} pack={pack} />;
  }

  if (node.type === "subview") {
    const children = sortChildrenByZIndex(node);
    return (
      <div
        className={nodeClassName(
          "skin-layout-node",
          "skin-layout-node--subview",
          node.className,
        )}
        data-node-id={node.id}
        style={css}
        {...(node.dragRegion ? skinDragRegionDeepProps() : {})}
      >
        {renderBoundedChildren(children, pack)}
      </div>
    );
  }

  if (node.type === "tiledFrame") {
    const children = sortChildrenByZIndex(node);
    return (
      <SkinTiledFrame node={node} pack={pack}>
        {renderBoundedChildren(children, pack)}
      </SkinTiledFrame>
    );
  }

  if (
    node.type === "row" ||
    node.type === "column" ||
    node.type === "overlay"
  ) {
    const children = sortChildrenByZIndex(node);
    return (
      <div
        className={nodeClassName(
          "skin-layout-node",
          `skin-layout-node--${node.type}`,
          node.className,
        )}
        data-node-id={node.id}
        style={css}
        {...(node.dragRegion ? skinDragRegionDeepProps() : {})}
      >
        {renderBoundedChildren(children, pack)}
      </div>
    );
  }

  if (node.type === "time" && node.presentation.kind === "digitStrip") {
    return <SkinDigitTime node={node} pack={pack} />;
  }

  if (node.type === "playlist") {
    return <SkinPlaylistView node={node} />;
  }

  if (node.type === "slider" && node.presentation.kind === "stripSlider") {
    if (
      node.control !== "volume" &&
      node.control !== "seek" &&
      node.control !== "eq"
    ) {
      return null;
    }
    const mode =
      node.control === "volume"
        ? "volume"
        : node.control === "eq"
          ? "eq"
          : "seek";
    return <SkinStripSlider node={node} pack={pack} mode={mode} />;
  }

  if (
    node.type === "slider" &&
    node.presentation.kind === "bitmapVerticalSlider"
  ) {
    return <SkinBitmapVerticalSlider node={node} pack={pack} />;
  }

  if (
    node.type === "slider" &&
    node.presentation.kind === "bitmapHorizontalSlider"
  ) {
    return <SkinBitmapHorizontalSlider node={node} pack={pack} />;
  }

  if (node.type === "visualizer" && node.presentation.kind === "framedPanel") {
    return <SkinFramedVisualizer node={node} pack={pack} />;
  }

  if (node.type === "rating") {
    return <SkinRating node={node} />;
  }

  if (
    (node.type === "slider" &&
      (node.control === "seek" || node.control === "volume") &&
      node.presentation.kind === "primitive") ||
    node.type === "artwork" ||
    node.type === "visualizer"
  ) {
    return <SkinPrimitiveControl node={node} />;
  }

  return null;
}
