import { useMemo, useState } from "react";
import { SKIN_DEBUG_STORAGE_KEY } from "../../../lib/skinDebug";
import { useSkinStore } from "../../../store/useSkinStore";
import type {
  LoadedSkinPack,
  SkinManifest,
  SkinView,
} from "../../../types/skin";
import {
  resolveCanvasSize,
  resolveSkinWindowBackgroundStyle,
} from "../../../lib/skinWindowPresentation";
import { SkinBoundedCanvasNode } from "./SkinBoundedCanvasNode";
import { useSkinDebug } from "../../../hooks/useSkinDebug";
import "./SkinCanvasLayout.css";

export interface SkinCanvasLayoutProps {
  pack: LoadedSkinPack;
  view: SkinView;
  viewId: string;
  className?: string;
}

export function SkinCanvasLayout({
  pack,
  view,
  viewId,
  className,
}: SkinCanvasLayoutProps) {
  const skinDebug = useSkinDebug();
  const panelOpen = useSkinStore((s) => s.panelOpen);
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
        <SkinBoundedCanvasNode
          key={child.id ?? `canvas-node-${index}`}
          node={child}
          pack={pack}
          textStyles={textStyles}
          visualizerExpanded={visualizerExpanded}
          onToggleVisualizer={onToggleVisualizer}
          onOpenQueue={onOpenQueue}
          panelOpen={panelOpen}
        />
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
    panelOpen,
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
