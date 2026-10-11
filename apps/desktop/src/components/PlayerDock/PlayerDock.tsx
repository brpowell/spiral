import { useState } from "react";
import { NowPlayingBar } from "../NowPlayingBar/NowPlayingBar";
import "./PlayerDock.css";

export function PlayerDock() {
  const [visualizerExpanded, setVisualizerExpanded] = useState(false);

  return (
    <NowPlayingBar
      visualizerExpanded={visualizerExpanded}
      onToggleVisualizer={() => setVisualizerExpanded((v) => !v)}
    />
  );
}
