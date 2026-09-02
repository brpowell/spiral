import { useMemo } from "react";
import {
  useSkinViewState,
  viewStateDataAttributes,
} from "../../../lib/skinViewStateContext";
import { hoverNodeDataAttributes } from "../../../lib/skinHover";
import { useSkinHoveredNodeIds } from "../../../lib/skinHoverContext";
import { primaryViewId } from "../../../lib/skinWindowPresentation";
import type {
  CanvasNode,
  ColumnNode,
  LoadedSkinPack,
  RowNode,
  SkinView,
} from "../../../types/skin";
import { SkinCanvasLayout } from "./SkinCanvasLayout";
import { SkinLayoutNode } from "./SkinLayoutNode";
import { SkinViewRuntimeProviders } from "./SkinViewRuntimeProviders";
import "./SkinLayoutRenderer.css";

export interface SkinLayoutRendererProps {
  pack: LoadedSkinPack;
  viewId?: string;
  className?: string;
  registerGlobalApi?: boolean;
}

function SkinFlowLayout({
  pack,
  view,
  resolvedView,
  className,
}: {
  pack: LoadedSkinPack;
  view: SkinView & { layout: RowNode | ColumnNode };
  resolvedView: string;
  className?: string;
}) {
  const { values } = useSkinViewState();
  const viewStateAttrs = viewStateDataAttributes(values);
  const hoverAttrs = hoverNodeDataAttributes(useSkinHoveredNodeIds());

  const shellClass = useMemo(
    () =>
      ["skin-layout", "skin-layout--flow", className].filter(Boolean).join(" "),
    [className],
  );

  return (
    <div className={shellClass} data-skin-id={pack.summary.id}>
      <div
        className={`skin-layout__flow skin-layout__flow--${resolvedView}`}
        aria-label="Skin mode player"
        {...viewStateAttrs}
        {...hoverAttrs}
      >
        <SkinLayoutNode node={view.layout} pack={pack} />
      </div>
    </div>
  );
}

export function SkinLayoutRenderer({
  pack,
  viewId,
  className,
  registerGlobalApi = false,
}: SkinLayoutRendererProps) {
  const { views } = pack.manifest;
  const fallback = primaryViewId(views) ?? Object.keys(views)[0];
  const resolvedView = viewId && views[viewId] ? viewId : fallback;
  if (!resolvedView) return null;
  const view = views[resolvedView];

  if (!view) return null;

  const body =
    view.layout.type === "canvas" ? (
      <SkinCanvasLayout
        pack={pack}
        view={view as SkinView & { layout: CanvasNode }}
        viewId={resolvedView}
        className={className}
        registerGlobalApi={registerGlobalApi}
      />
    ) : (
      <SkinViewRuntimeProviders
        view={view}
        registerGlobalApi={registerGlobalApi}
      >
        <SkinFlowLayout
          pack={pack}
          view={view as SkinView & { layout: RowNode | ColumnNode }}
          resolvedView={resolvedView}
          className={className}
        />
      </SkinViewRuntimeProviders>
    );

  return body;
}
