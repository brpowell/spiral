import { useMemo, useState, type ReactNode } from "react";
import { SkinShell } from "../SkinShell/SkinShell";
import type {
  LayoutNode,
  LoadedSkinPack,
  ShellSlot,
  SkinManifest,
} from "../../../types/skin";
import { resolveViewLayoutMode } from "../../../lib/skinWindowPresentation";
import { skinDragRegionDeepProps } from "../../../lib/skinDragRegion";
import { SkinCanvasLayout } from "./SkinCanvasLayout";
import { SkinLayoutNode } from "./SkinLayoutNode";
import { SkinOverlayRoot } from "./SkinOverlayRoot";
import "./SkinLayoutRenderer.css";

function emptySlots(): Record<ShellSlot, ReactNode[]> {
  return {
    header: [],
    art: [],
    info: [],
    controls: [],
    visualizer: [],
    footer: [],
  };
}

function collectRegions(
  node: LayoutNode,
  slots: Record<ShellSlot, ReactNode[]>,
  pack: LoadedSkinPack,
  visualizerExpanded: boolean,
  onToggleVisualizer: () => void,
  onOpenQueue: () => void,
): ReactNode[] {
  const overlays: ReactNode[] = [];

  const walk = (current: LayoutNode): void => {
    if (current.type === "region") {
      const content = current.children.map((child, index) => (
        <SkinLayoutNode
          key={child.id ?? `${current.slot}-${index}`}
          node={child}
          pack={pack}
          visualizerExpanded={visualizerExpanded}
          onToggleVisualizer={onToggleVisualizer}
          onOpenQueue={onOpenQueue}
        />
      ));
      const regionContent =
        content.length === 1 ? (
          content[0]
        ) : (
          <div className="skin-slot-stack">{content}</div>
        );
      slots[current.slot].push(
        current.dragRegion ? (
          <div
            key={current.id ?? current.slot}
            className="skin-region-drag"
            {...skinDragRegionDeepProps()}
          >
            {regionContent}
          </div>
        ) : (
          regionContent
        ),
      );
      return;
    }

    if (
      current.type === "stack" ||
      current.type === "row" ||
      current.type === "column"
    ) {
      for (const child of current.children) {
        walk(child);
      }
      return;
    }

    if (current.type === "overlay") {
      const isAbsolute =
        current.position === "absolute" || current.zIndex !== undefined;
      const inner = current.children.map((child, index) => (
        <SkinLayoutNode
          key={child.id ?? `overlay-${index}`}
          node={child}
          pack={pack}
          visualizerExpanded={visualizerExpanded}
          onToggleVisualizer={onToggleVisualizer}
          onOpenQueue={onOpenQueue}
        />
      ));
      if (isAbsolute) {
        overlays.push(
          <SkinOverlayRoot
            key={current.id ?? `overlay-${overlays.length}`}
            zIndex={current.zIndex}
            id={current.id}
          >
            {inner}
          </SkinOverlayRoot>,
        );
      } else {
        for (const child of current.children) {
          walk(child);
        }
      }
      return;
    }

    if (current.type === "decoration") {
      overlays.push(
        <SkinLayoutNode
          key={current.id ?? `decoration-${overlays.length}`}
          node={current}
          pack={pack}
          visualizerExpanded={visualizerExpanded}
          onToggleVisualizer={onToggleVisualizer}
          onOpenQueue={onOpenQueue}
        />,
      );
    }
  };

  walk(node);
  return overlays;
}

function slotContent(nodes: ReactNode[]): ReactNode | undefined {
  if (nodes.length === 0) return undefined;
  if (nodes.length === 1) return nodes[0];
  return <div className="skin-slot-stack">{nodes}</div>;
}

export interface SkinLayoutRendererProps {
  pack: LoadedSkinPack;
  viewId?: string;
  className?: string;
  registerGlobalApi?: boolean;
}

function SkinSlotsLayout({
  pack,
  view,
  resolvedView,
  className,
  manifest,
}: {
  pack: LoadedSkinPack;
  view: NonNullable<SkinLayoutRendererProps["pack"]["manifest"]["views"][string]>;
  resolvedView: string;
  className?: string;
  manifest: SkinManifest;
}) {
  const [visualizerExpanded, setVisualizerExpanded] = useState(false);
  const onToggleVisualizer = () => setVisualizerExpanded((v) => !v);
  const onOpenQueue = () => {};

  const { slots, overlays, shellClass } = useMemo(() => {
    const slotNodes = emptySlots();
    const overlayNodes = view
      ? collectRegions(
          view.layout,
          slotNodes,
          pack,
          visualizerExpanded,
          onToggleVisualizer,
          onOpenQueue,
        )
      : [];

    return {
      slots: slotNodes,
      overlays: overlayNodes,
      shellClass: ["skin-layout", className].filter(Boolean).join(" "),
    };
  }, [view, pack, visualizerExpanded, className]);

  const hasFooterVolume = slots.footer.length > 0;

  return (
    <div className={shellClass} data-skin-id={pack.summary.id}>
      {overlays.length > 0 ? (
        <div className="skin-layout__overlays">{overlays}</div>
      ) : null}
      <SkinShell
        key={`${pack.summary.id}-${resolvedView}`}
        className={`skin-layout__shell skin-layout__shell--${resolvedView}`}
        manifest={manifest}
        header={slotContent(slots.header)}
        art={slotContent(slots.art)}
        info={slotContent(slots.info)}
        controls={slotContent(slots.controls)}
        visualizer={slotContent(slots.visualizer)}
        footer={slotContent(slots.footer)}
        visualizerExpanded={visualizerExpanded}
        onToggleVisualizer={onToggleVisualizer}
        showVolume={!hasFooterVolume}
      />
    </div>
  );
}

export function SkinLayoutRenderer({
  pack,
  viewId,
  className,
  registerGlobalApi = false,
}: SkinLayoutRendererProps) {
  const manifest: SkinManifest = pack.manifest;
  const resolvedView =
    viewId && manifest.views[viewId] ? viewId : manifest.defaultView;
  const view = manifest.views[resolvedView];

  if (!view) return null;

  if (resolveViewLayoutMode(view) === "canvas") {
    return (
      <SkinCanvasLayout
        pack={pack}
        view={view}
        viewId={resolvedView}
        className={className}
        registerGlobalApi={registerGlobalApi}
      />
    );
  }

  return (
    <SkinSlotsLayout
      pack={pack}
      view={view}
      resolvedView={resolvedView}
      className={className}
      manifest={manifest}
    />
  );
}
