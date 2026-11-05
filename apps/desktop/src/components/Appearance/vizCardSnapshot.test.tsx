import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useVisualizerStore } from "../../store/useVisualizerStore";
import type { VizSummary } from "../../types/visualizer";
import { useVizCardSnapshotPrewarm } from "./vizCardSnapshot";

function pack(id: string, previewPath: string | null = null): VizSummary {
  return {
    id,
    name: id,
    author: "test",
    description: "",
    isBuiltin: false,
    publisherId: "test",
    version: "1.0.0",
    zone: "managed",
    previewPath,
  };
}

describe("useVizCardSnapshotPrewarm", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("loads every pack without an authored preview, one after another", async () => {
    const getVisualizer = vi.fn(async () => {
      throw new Error("not snapshotable");
    });
    useVisualizerStore.setState({
      visualizers: [pack("a"), pack("b", "preview.png"), pack("c")],
      getVisualizer,
    });

    renderHook(() => useVizCardSnapshotPrewarm());

    await waitFor(() => expect(getVisualizer).toHaveBeenCalledTimes(2));
    expect(getVisualizer.mock.calls.map(([id]) => id)).toEqual(["a", "c"]);
  });
});
