import { useMemo, useRef } from "react";
import type { CanvasNode, LoadedSkinPack, SkinView } from "../../../types/skin";
import { resolveViewWindowChrome } from "../../../lib/skinModeWindowChrome";
import { sortChildrenByZIndex } from "../../../lib/skinLayout";
import { resolveViewDragInference } from "../../../lib/skinWindowPresentation";
import { skinDragRegionDeepProps } from "../../../lib/skinDragRegion";
import { SkinBoundedCanvasNode } from "./SkinBoundedCanvasNode";
import { SkinButtonGroupHitRegistryProvider } from "./SkinButtonGroupHitRegistry";
import { SkinLayoutContextProvider } from "./SkinLayoutContext";
import { SkinViewRuntimeProviders } from "./SkinViewRuntimeProviders";
import { useSkinCanvasStageSize } from "../../../hooks/useSkinCanvasStageSize";
import { SkinCanvasStageContext } from "./SkinCanvasStageContext";
import "./SkinCanvasLayout.css";

export interface SkinCanvasLayoutProps {
  pack: LoadedSkinPack;
  view: SkinView & { layout: CanvasNode };
  viewId: string;
  className?: string;
  registerGlobalApi?: boolean;
}

export function SkinCanvasLayout({
  pack,
  view,
  viewId,
  className,
  registerGlobalApi = false,
}: SkinCanvasLayoutProps) {
  const root = view.layout;
  const fallbackSize = { width: root.width, height: root.height };
  const chrome = resolveViewWindowChrome(pack, viewId);
  const resizable = chrome.resizable !== false;
  const stageDragProps =
    resolveViewDragInference(view) === "auto"
      ? skinDragRegionDeepProps()
      : undefined;
  const stageRef = useRef<HTMLDivElement>(null);
  const stageSize = useSkinCanvasStageSize(stageRef, fallbackSize);
  const layoutSize = resizable ? stageSize : fallbackSize;
  const { width, height } = layoutSize;

  const stageContext = useMemo(() => ({ stageSize: layoutSize }), [layoutSize]);

  const rootLayoutContext = useMemo(
    () => ({
      origin: { x: 0, y: 0 },
      size: layoutSize,
      space: "stage" as const,
    }),
    [layoutSize],
  );

  const { nodes, shellClass } = useMemo(() => {
    const children = sortChildrenByZIndex(root);

    return {
      nodes: children.map((child, index) => (
        <SkinBoundedCanvasNode
          key={child.id ?? `canvas-node-${index}`}
          node={child}
          pack={pack}
        />
      )),
      shellClass: [
        "skin-canvas-layout",
        resizable && "skin-canvas-layout--resizable",
        className,
      ]
        .filter(Boolean)
        .join(" "),
    };
  }, [root, pack, className, resizable]);

  return (
    <SkinViewRuntimeProviders
      key={`${pack.summary.id}:${viewId}`}
      view={view}
      registerGlobalApi={registerGlobalApi}
    >
      <SkinCanvasStageContext.Provider value={stageContext}>
        <SkinLayoutContextProvider value={rootLayoutContext}>
          <SkinButtonGroupHitRegistryProvider>
            <div
              className={shellClass}
              style={
                resizable
                  ? undefined
                  : { width: `${width}px`, height: `${height}px` }
              }
              data-skin-id={pack.summary.id}
              data-view-id={viewId}
              data-resizable={resizable ? "true" : "false"}
            >
              <div
                ref={stageRef}
                className="skin-canvas-layout__stage"
                {...stageDragProps}
                style={
                  resizable
                    ? undefined
                    : { width: `${width}px`, height: `${height}px` }
                }
              >
                {nodes}
              </div>
            </div>
          </SkinButtonGroupHitRegistryProvider>
        </SkinLayoutContextProvider>
      </SkinCanvasStageContext.Provider>
    </SkinViewRuntimeProviders>
  );
}
