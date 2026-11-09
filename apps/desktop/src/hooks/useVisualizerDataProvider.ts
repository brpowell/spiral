import { useEffect } from "react";
import { startVisualizerDataProvider } from "@/lib/visualizer/visualizerDataBridge";
import { isSkinModeWindow } from "@/lib/windows/windowRole";

export function useVisualizerDataProvider(): void {
  useEffect(() => {
    if (isSkinModeWindow()) return;
    return startVisualizerDataProvider();
  }, []);
}
