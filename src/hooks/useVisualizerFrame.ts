import { useEffect, useRef, type RefObject } from "react";
import {
  copyVisualizerFrame,
  startVisualizerFramePull,
  subscribeVisualizerFrames,
  type VisualizerRemoteFrame,
} from "../lib/visualizerDataBridge";

const EMPTY_REMOTE_FRAME: VisualizerRemoteFrame = {
  bins: null,
  waveform: null,
};

export function useVisualizerFrameRef(): RefObject<VisualizerRemoteFrame> {
  const frameRef = useRef<VisualizerRemoteFrame>(EMPTY_REMOTE_FRAME);

  useEffect(() => {
    const stopPull = startVisualizerFramePull();
    const stopSubscribe = subscribeVisualizerFrames((frame) => {
      copyVisualizerFrame(frameRef.current, frame);
    });
    return () => {
      stopPull();
      stopSubscribe();
    };
  }, []);

  return frameRef;
}
