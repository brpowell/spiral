import { useEffect } from "react";
import { startVisualizerDataProvider } from "../lib/visualizerDataBridge";
import { isSkinModeWindow } from "../lib/windowRole";

export function useVisualizerDataProvider(): void {
  useEffect(() => {
    if (isSkinModeWindow()) return;
    return startVisualizerDataProvider();
  }, []);
}
