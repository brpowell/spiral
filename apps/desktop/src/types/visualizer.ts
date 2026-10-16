/** Mirrors Rust `VizManifest` / summary types (viz.json). */

import type { VizScene } from "../components/visualizer/scene/types";
import type { PackZone } from "./pack";

/** Host context scene. Visualizer manifests have a single layer list. */
export type VisualizerScene = "default";

export interface VizManifest {
  /** Declared contribution id (kebab slug). */
  id: string;
  name: string;
  author: string;
  description: string;
  /** Optional contribution preview. Raster only (png/jpg/jpeg/webp/gif). */
  preview?: string;
  children: VizScene;
}

export interface VizSummary {
  id: string;
  name: string;
  author: string;
  description: string;
  isBuiltin: boolean;
  authorId: string;
  version: string;
  zone: PackZone;
  previewPath: string | null;
}

export interface LoadedVisualizer {
  summary: VizSummary;
  packDir: string;
  manifest: VizManifest;
}
