import type { RefObject } from "react";
import type { SkinBindPath } from "../../types/skin";
import type { VisualizerRemoteFrame } from "../../lib/visualizerDataBridge";
import type {
  VisualizerSurface,
  VizSurfaceProfile,
} from "../../types/visualizer";

export type {
  VisualizerSurface,
  VizSurfaceProfile as VisualizerSurfaceProfile,
} from "../../types/visualizer";

export interface VisualizerContext {
  surface: VisualizerSurface;
  size: { width: number; height: number; dpr: number };

  audio: {
    bins: readonly number[];
    isPlaying: boolean;
    playbackState: "playing" | "paused" | "stopped";
    volume: number;
    /** RMS energy from frequency bins, normalized 0–1. */
    overallEnergy: number;
    /** Low-frequency bucket RMS, normalized 0–1. */
    bassEnergy: number;
    /** Mid-frequency bucket RMS, normalized 0–1. */
    midEnergy: number;
    /** High-frequency bucket RMS, normalized 0–1. */
    trebleEnergy: number;
  };

  bind(path: SkinBindPath): string | number | boolean | null;

  colors: {
    palette: string[];
    tokens: Record<string, string>;
  };

  flags: {
    reducedMotion: boolean;
  };
}

/** Runtime visualizer: resolved surfaces ready for the scene compositor. */
export interface Visualizer {
  id: string;
  /** Pack root on disk — required for scene asset layers. */
  packDir?: string;
  surfaces: Record<VisualizerSurface, VizSurfaceProfile>;
}

export interface VisualizerDrawState {
  timeDomainDataRef: { current: Uint8Array<ArrayBuffer> | null };
}

export interface VisualizerRendererProps {
  variant?: "mini" | "dock";
  /** Mini-strip expand state; only used when `showExpandToggle` is true. */
  expanded?: boolean;
  onToggleExpand?: () => void;
  showExpandToggle?: boolean;
  fillContainer?: boolean;
  remoteFrameRef?: RefObject<VisualizerRemoteFrame>;
}
