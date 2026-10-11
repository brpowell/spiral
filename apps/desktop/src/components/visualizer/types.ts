import type { RefObject } from "react";
import type { SkinBindPath } from "../../types/skin";
import type { VisualizerRemoteFrame } from "../../lib/visualizerDataBridge";
import type { VisualizerScene } from "../../types/visualizer";
import type { VizScene } from "./scene/types";
import type { VizFrameTrack } from "./vizTrack";

/**
 * Active theme, as a draw module sees it.
 * This is the display name and resolved tokens only — not the pack's theme record.
 */
export interface VizFrameTheme {
  /** Display name, such as `"Obsidian"` or `"Sprig"`. */
  name: string;
  /**
   * Resolved CSS tokens for the active theme.
   * Color values are CSS colors (`color-bg`, `color-text-primary`, `color-accent`,
   * `color-danger`, and the `color-alert-*` keys). `font-ui` is a font stack.
   * Other theme tokens may be present.
   */
  tokens: Record<string, string>;
}

export type { VisualizerScene } from "../../types/visualizer";

export interface VisualizerContext {
  scene: VisualizerScene;
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

  /** Active theme. The draw-module frame receives this same object. */
  theme: VizFrameTheme;

  flags: {
    reducedMotion: boolean;
  };

  /** Current track. Empty title and no art when nothing is loaded. */
  trackMetadata: VizFrameTrack;
}

/** Runtime visualizer: resolved layers ready for the scene compositor. */
export interface Visualizer {
  id: string;
  /** Pack root on disk — required for scene asset layers. */
  packDir?: string;
  children: VizScene;
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
