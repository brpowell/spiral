import { useVisualizerFrameRef } from "../../../hooks/useVisualizerFrame";
import { isAnySkinWindow } from "../../../lib/windowRole";
import { resolveSurfaceScene } from "../../visualizer/fallbackVisualizer";
import { SceneRenderer } from "../../visualizer/scene/SceneRenderer";
import { useResolvedVisualizer } from "../../visualizer/useResolvedVisualizer";
import type { VisualizerRendererProps } from "../../visualizer/types";
import "./VisualizerSlot.css";

interface VisualizerSlotProps {
  variant?: "mini" | "dock";
  expanded: boolean;
  onToggleExpand: () => void;
  showExpandToggle?: boolean;
  fillContainer?: boolean;
  className?: string;
  nodeId?: string;
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
    nodeId,
  } = props;

  const activeVisualizer = useResolvedVisualizer();
  const scene = resolveSurfaceScene(activeVisualizer);

  return (
    <div
      className={["visualizer-slot", className].filter(Boolean).join(" ")}
      data-node-id={nodeId}
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
