import type { RefObject } from "react";
import type { SkinBindPath } from "../../types/skin";
import type { VisualizerRemoteFrame } from "../../lib/visualizerDataBridge";
import type {
  VisualizerAuthoringSurface,
  VisualizerSurface,
  VizSurfaceProfile,
} from "../../types/visualizer";

export type {
  VisualizerAuthoringSurface,
  VisualizerSurface,
  VizSurfaceProfile as VisualizerSurfaceProfile,
  WebGLRendererId,
} from "../../types/visualizer";

export type VisualizerRendererId = "bars" | "wave" | "spectrum";

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

export type VisualizerOrientation = "horizontal" | "vertical";

/** Shared param surface for built-in renderers (pack manifest v1). */
export interface RendererParams {
  barCount?: number;
  mirror?: boolean;
  glow?: number;
  orientation?: VisualizerOrientation;
}

export interface VisualizerPack {
  id: string;
  /** Pack root on disk — required for scene asset layers. */
  packDir?: string;
  surfaces: Record<VisualizerSurface, VizSurfaceProfile>;
  reducedSurfaces?: Partial<Record<VisualizerAuthoringSurface, VizSurfaceProfile>>;
}

export interface VisualizerDrawState {
  idlePhaseRef: { current: number };
  frequencyDataRef: { current: Uint8Array<ArrayBuffer> | null };
  timeDomainDataRef: { current: Uint8Array<ArrayBuffer> | null };
}

export interface VisualizerDrawArgs {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  context: VisualizerContext;
  remoteBins: number[] | null;
  remoteWaveform: number[] | null;
  state: VisualizerDrawState;
}

export interface VisualizerRendererProps {
  surface: VisualizerSurface;
  variant?: "mini" | "dock";
  expanded: boolean;
  onToggleExpand: () => void;
  showExpandToggle?: boolean;
  fillContainer?: boolean;
  remoteFrameRef?: RefObject<VisualizerRemoteFrame>;
}

export function resolveVisualizerSurface(
  variant: "mini" | "dock",
  expanded: boolean,
): VisualizerSurface {
  if (variant === "mini" && expanded) return "expanded";
  if (variant === "mini") return "mini";
  return "panel";
}
