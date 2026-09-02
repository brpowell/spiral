import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ButtonNode,
  LoadedSkinPack,
  SubviewNode,
} from "../../../types/skin";
import { SkinBoundedCanvasNode } from "./SkinBoundedCanvasNode";
import { SkinLayoutContextProvider } from "./SkinLayoutContext";

const evaluateSkinCondition = vi.hoisted(() => vi.fn(() => false));

vi.mock("../../../lib/skinBinds", () => ({
  useSkinVisible: () => true,
  useSkinBindState: () => ({ viewState: {}, hoveredNodeIds: new Set() }),
  evaluateSkinCondition,
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
  beforeEach(() => {
    evaluateSkinCondition.mockImplementation(() => false);
  });

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

  it("fades authored opacity and disables pointers while hidden", () => {
    const node: SubviewNode = {
      type: "subview",
      id: "visMeta",
      bounds: { x: 0, y: 0, w: 100, h: 44, zIndex: 32 },
      style: { opacity: 0 },
      styleWhen: { "hover.visFrame": { opacity: 1 } },
      transition: { durationMs: 200, easing: "ease-out" },
      children: [],
    };

    const { container } = renderNode(node);
    const bounds = container.querySelector("[data-bounds-for='visMeta']");
    expect(bounds).toHaveClass("skin-bounds--pointer-idle");
    expect(bounds).toHaveClass("skin-bounds--motion");
    expect(bounds).toHaveStyle({ opacity: "0" });
  });

  it("snaps when a matching transitionWhen overlay sets durationMs 0", () => {
    evaluateSkinCondition.mockImplementation(
      (path) => path === "view.intro.showing",
    );

    const node: SubviewNode = {
      type: "subview",
      id: "introLogo",
      bounds: { x: 19, y: 43, w: 400, h: 226 },
      style: { opacity: 1 },
      transition: { durationMs: 1000, easing: "linear" },
      transitionWhen: { "view.intro.showing": { durationMs: 0 } },
      children: [],
    };

    const { container } = renderNode(node);
    const bounds = container.querySelector("[data-bounds-for='introLogo']");
    expect(bounds).not.toHaveClass("skin-bounds--motion");
  });
});
