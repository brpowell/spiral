/** Mirrors Rust `VizManifest` / summary types (viz.json v1). */

import type { SceneLayer } from "../components/visualizer/scene/types";

export type VisualizerRendererId = "bars" | "wave" | "spectrum";

export type WebGLRendererId = "neon-tunnel";

export type VisualizerSurface = "mini" | "panel" | "expanded";

export type VisualizerAuthoringSurface = VisualizerSurface | "default";

export interface VizSurfaceProfile {
  scene: SceneLayer[];
}

export interface VizManifest {
  version: number;
  name: string;
  author: string;
  description: string;
  preview?: string;
  surfaces: Record<VisualizerSurface, VizSurfaceProfile>;
  reducedSurfaces?: Partial<
    Record<VisualizerAuthoringSurface, VizSurfaceProfile>
  >;
}

export interface VizSummary {
  id: string;
  name: string;
  author: string;
  description: string;
  isBuiltin: boolean;
  previewPath: string | null;
}

export interface LoadedVisualizerPack {
  summary: VizSummary;
  packDir: string;
  manifest: VizManifest;
}
