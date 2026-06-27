import { useVisualizerFrameRef } from "../../../hooks/useVisualizerFrame";
import { isAnySkinWindow } from "../../../lib/windowRole";
import { usePrefersReducedMotion } from "../../visualizer/context";
import { resolveSurfaceScene } from "../../visualizer/packs";
import { SceneRenderer } from "../../visualizer/scene/SceneRenderer";
import { useResolvedVisualizerPack } from "../../visualizer/useResolvedVisualizerPack";
import {
  resolveVisualizerSurface,
  type VisualizerRendererProps,
} from "../../visualizer/types";
import "./VisualizerSlot.css";

interface VisualizerSlotProps {
  variant?: "mini" | "dock";
  expanded: boolean;
  onToggleExpand: () => void;
  showExpandToggle?: boolean;
  fillContainer?: boolean;
  className?: string;
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
  } = props;

  const surface = resolveVisualizerSurface(variant, expanded);
  const reducedMotion = usePrefersReducedMotion();
  const activePack = useResolvedVisualizerPack();
  const scene = resolveSurfaceScene(activePack, surface, reducedMotion);

  return (
    <div className={["visualizer-slot", className].filter(Boolean).join(" ")}>
      <SceneRenderer
        key={`${activePack.id}-${surface}`}
        scene={scene}
        packDir={activePack.packDir}
        surface={surface}
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
