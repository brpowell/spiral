import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CanvasNode, LoadedSkinPack, SkinView } from "../../../types/skin";
import { SkinCanvasLayout } from "./SkinCanvasLayout";

vi.mock("./SkinBoundedCanvasNode", () => ({
  SkinBoundedCanvasNode: () => null,
}));

vi.mock("../../../hooks/useSkinCanvasStageSize", () => ({
  useSkinCanvasStageSize: (_ref: unknown, fallback: unknown) => fallback,
}));

const pack = {
  packDir: "/packs/demo",
  summary: { id: "demo" },
  manifest: { views: {} },
} as unknown as LoadedSkinPack;

function view(): SkinView & { layout: CanvasNode } {
  return {
    state: {
      shutter: { default: "preroll" },
      compartment: { default: "closed" },
    },
    layout: {
      type: "canvas",
      sizing: "manual",
      width: 300,
      height: 200,
      children: [],
    },
  } as unknown as SkinView & { layout: CanvasNode };
}

describe("SkinCanvasLayout", () => {
  it("exposes view state as data-state-* below data-skin-id for skin.css scoping", () => {
    const { container } = render(
      <SkinCanvasLayout pack={pack} view={view()} viewId="mainview" />,
    );

    const stage = container.querySelector(".skin-canvas-layout__stage");
    expect(stage).toHaveAttribute("data-state-shutter", "preroll");
    expect(stage).toHaveAttribute("data-state-compartment", "closed");

    // Scoping rewrites author selectors to `[data-skin-id] [data-state-*]`, so
    // the attributes must not share a node with data-skin-id.
    expect(stage).not.toHaveAttribute("data-skin-id");
    expect(container.querySelector("[data-skin-id='demo']")).toContainElement(
      stage as HTMLElement,
    );
  });
});
