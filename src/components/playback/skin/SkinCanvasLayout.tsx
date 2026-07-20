import { useMemo, useRef, useState } from "react";
import { useSkinStore } from "../../../store/useSkinStore";
import type {
  LoadedSkinPack,
  SkinView,
} from "../../../types/skin";
import { resolveViewWindowChrome } from "../../../lib/skinModeWindowChrome";
import { resolveCanvasSize } from "../../../lib/skinPanels";
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
  view: SkinView;
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
  const panelOpen = useSkinStore((s) => s.panelOpen);
  const [visualizerExpanded, setVisualizerExpanded] = useState(false);
  const fallbackSize = resolveCanvasSize(view);
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

  const onToggleVisualizer = () => setVisualizerExpanded((v) => !v);
  const onOpenQueue = () => { };

  const stageContext = useMemo(
    () => ({ stageSize: layoutSize }),
    [layoutSize],
  );

  const rootLayoutContext = useMemo(
    () => ({
      origin: { x: 0, y: 0 },
      size: layoutSize,
      space: "stage" as const,
    }),
    [layoutSize],
  );

  const { nodes, shellClass } = useMemo(() => {
    const root = view.layout;
    const container =
      root.type === "canvas" || root.type === "overlay" ? root : null;
    const children = container
      ? sortChildrenByZIndex(container)
      : [root];

    return {
      nodes: children.map((child, index) => (
        <SkinBoundedCanvasNode
          key={child.id ?? `canvas-node-${index}`}
          node={child}
          pack={pack}
          visualizerExpanded={visualizerExpanded}
          onToggleVisualizer={onToggleVisualizer}
          onOpenQueue={onOpenQueue}
          panelOpen={panelOpen}
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
  }, [
    view.layout,
    pack,
    visualizerExpanded,
    panelOpen,
    className,
    resizable,
  ]);

  return (
    <SkinViewRuntimeProviders
      key={viewId}
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
