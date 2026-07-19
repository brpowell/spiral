/** Mirrors Rust renderer contribution manifest (renderer.json). */

export type VizRendererEngine = "canvas2d" | "webgl";

export interface RendererManifest {
  /** Declared contribution id (kebab slug). */
  id: string;
  name: string;
  author: string;
  description: string;
  engine: VizRendererEngine;
  /** JS module path relative to the contribution folder. */
  entry: string;
}
