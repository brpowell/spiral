/** Mirrors Rust `VizManifest` / summary types (viz.json). */

import type { VizScene } from "../components/visualizer/scene/types";
import type { PackZone } from "./pack";

/**
 * Canvas and webgl layers both reference a fully-qualified renderer contribution id
 * (`authorId.packId.renderer.id`).
 */
export type VizRendererRef = string;

/** Reserved surface key in viz.json. Additional surfaces may return later. */
export type VisualizerSurface = "default";

export interface VizSurfaceProfile {
  scene: VizScene;
}

export interface VizManifest {
  /** Declared contribution id (kebab slug). */
  id: string;
  name: string;
  author: string;
  description: string;
  /** Optional contribution preview. Raster only (png/jpg/jpeg/webp/gif). */
  preview?: string;
  surfaces: Record<VisualizerSurface, VizSurfaceProfile>;
}

export interface VizSummary {
  id: string;
  name: string;
  author: string;
  description: string;
  isBuiltin: boolean;
  /** Spiral pack (.spk) that contains this visualizer contribution. */
  packId: string;
  packName: string;
  packVersion: string;
  zone: PackZone;
  previewPath: string | null;
}

export interface LoadedVisualizer {
  summary: VizSummary;
  packDir: string;
  manifest: VizManifest;
}
