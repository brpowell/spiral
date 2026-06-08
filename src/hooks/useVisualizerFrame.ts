import { useEffect, useRef, type RefObject } from "react";
import {
  copyVisualizerBins,
  startVisualizerFramePull,
  subscribeVisualizerFrames,
  VISUALIZER_BAR_COUNT,
} from "../lib/visualizerDataBridge";

export function useVisualizerFrameRef(): RefObject<number[] | null> {
  const binsRef = useRef<number[] | null>(null);

  useEffect(() => {
    const stopPull = startVisualizerFramePull();
    const stopSubscribe = subscribeVisualizerFrames((bins) => {
      if (!binsRef.current) {
        binsRef.current = new Array(VISUALIZER_BAR_COUNT);
      }
      binsRef.current = copyVisualizerBins(binsRef.current, bins);
    });
    return () => {
      stopPull();
      stopSubscribe();
    };
  }, []);

  return binsRef;
}
