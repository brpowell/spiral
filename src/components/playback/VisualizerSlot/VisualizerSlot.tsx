import { AudioVisualizer } from "../../AudioVisualizer/AudioVisualizer";
import { useVisualizerFrameRef } from "../../../hooks/useVisualizerFrame";
import { isSkinModeWindow } from "../../../lib/windowRole";
import "./VisualizerSlot.css";

interface VisualizerSlotProps {
  variant?: "mini" | "dock";
  expanded: boolean;
  onToggleExpand: () => void;
  showExpandToggle?: boolean;
  fillContainer?: boolean;
  className?: string;
}

function RemoteVisualizerSlot({
  variant,
  expanded,
  onToggleExpand,
  showExpandToggle,
  fillContainer,
  className,
}: VisualizerSlotProps) {
  const binsRef = useVisualizerFrameRef();

  return (
    <div className={["visualizer-slot", className].filter(Boolean).join(" ")}>
      <AudioVisualizer
        variant={variant}
        expanded={expanded}
        onToggleExpand={onToggleExpand}
        showExpandToggle={showExpandToggle}
        fillContainer={fillContainer}
        frequencyBinsRef={binsRef}
      />
    </div>
  );
}

function LocalVisualizerSlot({
  variant,
  expanded,
  onToggleExpand,
  showExpandToggle,
  fillContainer,
  className,
}: VisualizerSlotProps) {
  return (
    <div className={["visualizer-slot", className].filter(Boolean).join(" ")}>
      <AudioVisualizer
        variant={variant}
        expanded={expanded}
        onToggleExpand={onToggleExpand}
        showExpandToggle={showExpandToggle}
        fillContainer={fillContainer}
      />
    </div>
  );
}

export function VisualizerSlot(props: VisualizerSlotProps) {
  if (isSkinModeWindow()) {
    return <RemoteVisualizerSlot {...props} />;
  }
  return <LocalVisualizerSlot {...props} />;
}
