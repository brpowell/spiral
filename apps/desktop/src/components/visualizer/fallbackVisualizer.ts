import type { Visualizer } from "./types";

/** Inline fallback when the default bars visualizer cannot be loaded from disk. */
export const BARS_FALLBACK_VISUALIZER: Visualizer = {
  id: "spiral.core.visualizer.bars",
  children: [
    {
      kind: "canvas",
      layout: "fill",
      entry: "index.js",
    },
  ],
};
