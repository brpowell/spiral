import { useVisualizerFrameRef } from "../../../hooks/useVisualizerFrame";
import { isAnySkinWindow } from "../../../lib/windowRole";
import { resolveSurfaceScene } from "../../visualizer/fallbackVisualizer";
import { SceneRenderer } from "../../visualizer/scene/SceneRenderer";
import { useResolvedVisualizer } from "../../visualizer/useResolvedVisualizer";
import type { VisualizerRendererProps } from "../../visualizer/types";
import type { CSSProperties } from "react";
import "./VisualizerSlot.css";

interface VisualizerSlotProps {
  variant?: "mini" | "dock";
  /** Mini-strip expand state; only used when `showExpandToggle` is true. */
  expanded?: boolean;
  onToggleExpand?: () => void;
  showExpandToggle?: boolean;
  /** Grow to fill the layout cell (skin / dock panel). */
  fillContainer?: boolean;
  className?: string;
  style?: CSSProperties;
  nodeId?: string;
  interactionEnabled?: boolean;
}

function slotLayoutClass(
  variant: "mini" | "dock",
  fillContainer: boolean | undefined,
): string | undefined {
  if (variant === "mini") return "visualizer-slot--mini";
  if (fillContainer) return "visualizer-slot--panel";
  return undefined;
}

function VisualizerRendererView({
  remoteFrameRef,
  ...props
}: VisualizerSlotProps & {
  remoteFrameRef?: VisualizerRendererProps["remoteFrameRef"];
}) {
  const {
    variant = "dock",
    expanded,
    onToggleExpand,
    showExpandToggle,
    fillContainer,
    className,
    style,
    nodeId,
    interactionEnabled = true,
  } = props;

  const activeVisualizer = useResolvedVisualizer();
  const scene = resolveSurfaceScene(activeVisualizer);

  return (
    <div
      className={[
        "visualizer-slot",
        slotLayoutClass(variant, fillContainer),
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      style={interactionEnabled ? style : { ...style, pointerEvents: "none" }}
      data-node-id={nodeId}
      aria-disabled={interactionEnabled ? undefined : true}
    >
      <SceneRenderer
        key={activeVisualizer.id}
        scene={scene}
        packDir={activeVisualizer.packDir}
        variant={variant}
        expanded={expanded}
        onToggleExpand={onToggleExpand}
        showExpandToggle={showExpandToggle}
        fillContainer={fillContainer}
        remoteFrameRef={remoteFrameRef}
        style={style}
      />
    </div>
  );
}

function RemoteVisualizerSlot(props: VisualizerSlotProps) {
  const frameRef = useVisualizerFrameRef();
  return <VisualizerRendererView {...props} remoteFrameRef={frameRef} />;
}

function LocalVisualizerSlot(props: VisualizerSlotProps) {
  return <VisualizerRendererView {...props} />;
}

export function VisualizerSlot(props: VisualizerSlotProps) {
  if (isAnySkinWindow()) {
    return <RemoteVisualizerSlot {...props} />;
  }
  return <LocalVisualizerSlot {...props} />;
}
