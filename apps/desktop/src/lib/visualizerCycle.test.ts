import { describe, expect, it } from "vitest";
import {
  activeVisualizerName,
  adjacentVisualizerId,
  canCycleVisualizers,
} from "./visualizerCycle";
import type { VizSummary } from "../types/visualizer";

const packs: VizSummary[] = [
  {
    id: "bars",
    name: "Bars",
    author: "Spiral",
    description: "",
    isBuiltin: true,
    packId: "core",
    packName: "Core",
    packVersion: "1.0.0",
    zone: "builtin",
    previewPath: null,
  },
  {
    id: "wave",
    name: "Wave",
    author: "Spiral",
    description: "",
    isBuiltin: true,
    packId: "core",
    packName: "Core",
    packVersion: "1.0.0",
    zone: "builtin",
    previewPath: null,
  },
  {
    id: "spectrum",
    name: "Spectrum",
    author: "Spiral",
    description: "",
    isBuiltin: true,
    packId: "core",
    packName: "Core",
    packVersion: "1.0.0",
    zone: "builtin",
    previewPath: null,
  },
];

describe("visualizerCycle", () => {
  it("wraps next and previous through the installed pack list", () => {
    expect(adjacentVisualizerId(packs, "bars", "next")).toBe("wave");
    expect(adjacentVisualizerId(packs, "bars", "prev")).toBe("spectrum");
    expect(adjacentVisualizerId(packs, "spectrum", "next")).toBe("bars");
  });

  it("resolves the active visualizer display name", () => {
    expect(activeVisualizerName(packs, "wave")).toBe("Wave");
    expect(activeVisualizerName(packs, "missing")).toBe("");
  });

  it("only allows cycling when multiple packs exist", () => {
    expect(canCycleVisualizers(packs)).toBe(true);
    expect(canCycleVisualizers([packs[0]])).toBe(false);
    expect(canCycleVisualizers([])).toBe(false);
  });
});
