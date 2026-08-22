import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
  ButtonNode,
  LoadedSkinPack,
  SubviewNode,
} from "../../../types/skin";
import { SkinBoundedCanvasNode } from "./SkinBoundedCanvasNode";
import { SkinLayoutContextProvider } from "./SkinLayoutContext";

vi.mock("../../../lib/skinBinds", () => ({
  useSkinVisible: () => true,
}));

vi.mock("./SkinLayoutNode", () => ({
  SkinLayoutNode: () => null,
}));

const pack = { packDir: "/packs/test" } as LoadedSkinPack;

const layout = {
  origin: { x: 0, y: 0 },
  size: { width: 400, height: 400 },
  space: "stage" as const,
};

function renderNode(node: SubviewNode | ButtonNode) {
  return render(
    <SkinLayoutContextProvider value={layout}>
      <SkinBoundedCanvasNode node={node} pack={pack} />
    </SkinLayoutContextProvider>,
  );
}

describe("SkinBoundedCanvasNode", () => {
  it("lets grouping subviews pass pointer events", () => {
    const node: SubviewNode = {
      type: "subview",
      id: "group",
      bounds: { x: 0, y: 0, w: 100, h: 100, zIndex: 3 },
      children: [],
    };

    const { container } = renderNode(node);
    const bounds = container.querySelector("[data-bounds-for='group']");
    expect(bounds).toHaveClass("skin-bounds--passthrough");
    expect(bounds).not.toHaveClass("skin-bounds--unclipped");
  });

  it("leaves authored passthrough subviews unclipped", () => {
    const node: SubviewNode = {
      type: "subview",
      id: "svFrame",
      passthrough: true,
      bounds: { x: 0, y: 0, w: 100, h: 100 },
      children: [],
    };

    const { container } = renderNode(node);
    const bounds = container.querySelector("[data-bounds-for='svFrame']");
    expect(bounds).toHaveClass("skin-bounds--passthrough");
    expect(bounds).toHaveClass("skin-bounds--unclipped");
  });

  it("keeps control bounds interactive", () => {
    const node: ButtonNode = {
      type: "button",
      id: "close",
      bounds: { x: 0, y: 0, w: 17, h: 17 },
      presentation: {
        kind: "bitmap",
        assets: { default: "close.png" },
      },
    };

    const { container } = renderNode(node);
    const bounds = container.querySelector("[data-bounds-for='close']");
    expect(bounds).not.toHaveClass("skin-bounds--passthrough");
    expect(bounds).toHaveAttribute("data-skin-window-hit", "control");
  });
});
