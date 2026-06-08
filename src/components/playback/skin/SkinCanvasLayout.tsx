import { Fragment, useMemo, useState, type ReactNode } from "react";
import { SKIN_DEBUG_STORAGE_KEY } from "../../../lib/skinDebug";
import type {
  LayoutNode,
  LoadedSkinPack,
  SkinManifest,
  SkinView,
  TextStyle,
} from "../../../types/skin";
import {
  resolveCanvasSize,
  resolveSkinWindowBackgroundStyle,
} from "../../../lib/skinWindowPresentation";
import { SkinLayoutNode } from "./SkinLayoutNode";
import { SkinBounds } from "./SkinBounds";
import { SkinDragRegion } from "./SkinDragRegion";
import { useSkinDebug } from "../../../hooks/useSkinDebug";
import "./SkinCanvasLayout.css";

export interface SkinCanvasLayoutProps {
  pack: LoadedSkinPack;
  view: SkinView;
  viewId: string;
  className?: string;
}

function renderCanvasNode(
  node: LayoutNode,
  pack: LoadedSkinPack,
  textStyles: Record<string, TextStyle>,
  visualizerExpanded: boolean,
  onToggleVisualizer: () => void,
  onOpenQueue: () => void,
): ReactNode {
  if (node.type === "dragRegion") {
    return <SkinDragRegion key={node.id} node={node} />;
  }

  const inner = (
    <SkinLayoutNode
      node={node}
      pack={pack}
      textStyles={textStyles}
      visualizerExpanded={visualizerExpanded}
      onToggleVisualizer={onToggleVisualizer}
      onOpenQueue={onOpenQueue}
    />
  );

  if (node.bounds) {
    return (
      <SkinBounds
        key={node.id}
        bounds={node.bounds}
        debugLabel={node.id}
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

export function SkinCanvasLayout({
  pack,
  view,
  viewId,
  className,
}: SkinCanvasLayoutProps) {
  const skinDebug = useSkinDebug();
  const [visualizerExpanded, setVisualizerExpanded] = useState(false);
  const manifest: SkinManifest = pack.manifest;
  const textStyles = manifest.textStyles ?? {};
  const { width, height } = resolveCanvasSize(view, manifest);

  const onToggleVisualizer = () => setVisualizerExpanded((v) => !v);
  const onOpenQueue = () => {};

  const { nodes, shellClass, bgStyle } = useMemo(() => {
    const root = view.layout;
    const children = (
      root.type === "canvas"
        ? root.children
        : root.type === "overlay"
          ? root.children
          : [root]
    ).slice().sort(
      (a, b) => (a.bounds?.zIndex ?? 0) - (b.bounds?.zIndex ?? 0),
    );

    const windowClass = manifest.window?.background
      ? "skin-canvas-layout--has-bg"
      : "";

    const bgStyle = resolveSkinWindowBackgroundStyle(pack);

    return {
      nodes: children.map((child, index) => (
        <Fragment key={child.id ?? `canvas-node-${index}`}>
          {renderCanvasNode(
            child,
            pack,
            textStyles,
            visualizerExpanded,
            onToggleVisualizer,
            onOpenQueue,
          )}
        </Fragment>
      )),
      shellClass: ["skin-canvas-layout", windowClass, className]
        .filter(Boolean)
        .join(" "),
      bgStyle,
    };
  }, [
    view.layout,
    pack,
    textStyles,
    visualizerExpanded,
    manifest.window,
    className,
  ]);

  return (
    <div
      className={shellClass}
      style={{ ...bgStyle, width: `${width}px`, height: `${height}px` }}
      data-skin-id={pack.summary.id}
      data-view-id={viewId}
    >
      <div
        className="skin-canvas-layout__stage"
        style={{ width: `${width}px`, height: `${height}px` }}
      >
        {skinDebug ? (
          <div className="skin-canvas-layout__debug-banner" aria-hidden>
            Skin debug — spiralSkinDebug.disable() or localStorage.removeItem(
            {JSON.stringify(SKIN_DEBUG_STORAGE_KEY)})
          </div>
        ) : null}
        {nodes}
      </div>
    </div>
  );
}
