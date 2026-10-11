import { describe, expect, it } from "vitest";
import type {
  LayoutBounds,
  LayoutNode,
  LayoutTreeNode,
  SkinView,
  CanvasNode,
} from "../types/skin";
import {
  flattenLayout,
  localizeBounds,
  resolveAbsoluteBounds,
  resolveLocalBounds,
  sortChildrenByZIndex,
  validateLayoutTree,
  validateSkinManifestLayouts,
  walkLayoutTree,
} from "./skinLayout";

const dummyBitmap = {
  kind: "bitmap" as const,
  assets: { default: "x.png" },
};

function canvasRoot(children: LayoutNode[]): CanvasNode {
  return { type: "canvas", width: 100, height: 80, children };
}

function deco(id: string | undefined, bounds: LayoutBounds): LayoutNode {
  return {
    type: "decoration",
    ...(id ? { id } : {}),
    bounds,
    presentation: dummyBitmap,
  };
}

function findById(
  root: LayoutTreeNode,
  id: string,
):
  | {
      node: LayoutTreeNode;
      ancestors: LayoutTreeNode[];
    }
  | undefined {
  for (const entry of walkLayoutTree(root)) {
    if (entry.node.id === id) return entry;
  }
  return undefined;
}

function canvasStageSize(view: SkinView): { width: number; height: number } {
  if (view.layout.type !== "canvas") {
    throw new Error(`expected canvas layout root, got ${view.layout.type}`);
  }
  return { width: view.layout.width, height: view.layout.height };
}

/**
 * Synthetic stage -> drawer -> panel chain. Mixes plain x/y, right-anchored and
 * bottom-pinned placement at each nesting level.
 */
function nestedPanelView(): SkinView {
  return {
    layout: {
      type: "canvas",
      width: 400,
      height: 300,
      children: [
        deco("backdrop", { x: 0, y: 0, w: 400, h: 300 }),
        {
          type: "subview",
          id: "drawer",
          bounds: { x: 120, y: 60, w: 200, h: 150, zIndex: -1 },
          children: [
            deco("rail", { x: 0, y: 0, w: 200, h: 6 }),
            {
              type: "subview",
              id: "panel",
              bounds: { x: 40, y: 10, w: 140, h: 120 },
              children: [
                deco("gauge", { x: 8, y: 11, w: 60, h: 10, zIndex: 1 }),
                deco("badge", { right: 6, y: 4, w: 30, h: 8 }),
                deco("footer", { x: 5, bottom: 7, w: 20, h: 12 }),
              ],
            },
          ],
        },
      ],
    },
  };
}

describe("resolveLocalBounds / localizeBounds", () => {
  it("resolves x and right-anchored boxes against context size", () => {
    expect(
      resolveLocalBounds(
        { x: 10, y: 20, w: 30, h: 40 },
        { width: 200, height: 100 },
      ),
    ).toEqual({ x: 10, y: 20, w: 30, h: 40, zIndex: undefined });

    // CSS `right`: inset of the node's right edge → x = contextW - right - w
    expect(
      resolveLocalBounds(
        { right: 20, y: 20, w: 30, h: 40, zIndex: 2 },
        { width: 200, height: 100 },
      ),
    ).toEqual({ x: 150, y: 20, w: 30, h: 40, zIndex: 2 });
  });

  it("resolves stretch width and bottom-pinned height", () => {
    expect(
      resolveLocalBounds(
        { x: 0, right: 0, bottom: 0, h: 20, zIndex: 1 },
        { width: 232, height: 179 },
      ),
    ).toEqual({ x: 0, y: 159, w: 232, h: 20, zIndex: 1 });
  });

  it("round-trips absolute ↔ local without drift", () => {
    const absolute = { x: 299, y: 107, w: 71, h: 11, zIndex: 1 };
    const parentOrigin = { x: 291, y: 96 };
    const local = localizeBounds(absolute, parentOrigin);
    expect(local).toEqual({ x: 8, y: 11, w: 71, h: 11, zIndex: 1 });
    expect({
      x: parentOrigin.x + local.x,
      y: parentOrigin.y + local.y,
      w: local.w,
      h: local.h,
      zIndex: local.zIndex,
    }).toEqual(absolute);
  });
});

describe("resolveAbsoluteBounds", () => {
  const stage = { width: 753, height: 432 };

  it("keeps root-level children stage-absolute", () => {
    const root = canvasRoot([
      {
        type: "decoration",
        id: "bg",
        bounds: { x: 100, y: 50, w: 20, h: 10, zIndex: 1 },
        presentation: { kind: "bitmap", assets: { default: "x.png" } },
      },
    ]);
    const child = root.children[0]!;
    expect(resolveAbsoluteBounds(child, [root], stage)).toEqual({
      x: 100,
      y: 50,
      w: 20,
      h: 10,
      zIndex: 1,
    });
  });
  it("sums nested parent origins down a subview chain", () => {
    const view = nestedPanelView();
    const stage = canvasStageSize(view);
    const abs = (id: string) => {
      const entry = findById(view.layout, id)!;
      return resolveAbsoluteBounds(entry.node, entry.ancestors, stage);
    };

    expect(abs("drawer")).toEqual({
      x: 120,
      y: 60,
      w: 200,
      h: 150,
      zIndex: -1,
    });
    expect(abs("panel")).toEqual({
      x: 120 + 40,
      y: 60 + 10,
      w: 140,
      h: 120,
      zIndex: undefined,
    });
    const gauge = abs("gauge")!;
    expect(gauge).toEqual({
      x: 120 + 40 + 8,
      y: 60 + 10 + 11,
      w: 60,
      h: 10,
      zIndex: 1,
    });

    // Localizing back to the panel recovers the authored bounds.
    const panel = abs("panel")!;
    expect(localizeBounds(gauge, { x: panel.x, y: panel.y })).toEqual({
      x: 8,
      y: 11,
      w: 60,
      h: 10,
      zIndex: 1,
    });
  });

  it("resolves right-anchored and bottom-pinned children against the parent box", () => {
    const view = nestedPanelView();
    const stage = canvasStageSize(view);
    const abs = (id: string) => {
      const entry = findById(view.layout, id)!;
      return resolveAbsoluteBounds(entry.node, entry.ancestors, stage)!;
    };

    // panel origin is (160, 70); its box is 140 x 120.
    expect(abs("badge")).toMatchObject({
      x: 160 + (140 - 6 - 30),
      y: 70 + 4,
      w: 30,
      h: 8,
    });
    expect(abs("footer")).toMatchObject({
      x: 160 + 5,
      y: 70 + (120 - 7 - 12),
      w: 20,
      h: 12,
    });
  });

  it("round-trips every nested group without drift", () => {
    const view = nestedPanelView();
    const stageSize = canvasStageSize(view);
    let checked = 0;

    for (const { node, ancestors } of walkLayoutTree(view.layout)) {
      if (!("bounds" in node) || !node.bounds || ancestors.length === 0) {
        continue;
      }
      const parent = ancestors[ancestors.length - 1]!;
      const abs = resolveAbsoluteBounds(node, ancestors, stageSize);
      if (!abs) continue;

      const parentAbs =
        "bounds" in parent && parent.bounds
          ? resolveAbsoluteBounds(parent, ancestors.slice(0, -1), stageSize)
          : { x: 0, y: 0, w: stageSize.width, h: stageSize.height };
      if (!parentAbs) continue;

      const local = localizeBounds(abs, { x: parentAbs.x, y: parentAbs.y });
      const authoredX =
        node.bounds.x ??
        (node.bounds.right !== undefined && node.bounds.w !== undefined
          ? parentAbs.w - node.bounds.right - node.bounds.w
          : 0);
      const authoredY =
        node.bounds.y ??
        (node.bounds.bottom !== undefined && node.bounds.h !== undefined
          ? parentAbs.h - node.bounds.bottom - node.bounds.h
          : 0);
      expect(local.x, node.id).toBe(authoredX);
      expect(local.y, node.id).toBe(authoredY);
      expect(local.w, node.id).toBe(node.bounds.w);
      expect(local.h, node.id).toBe(node.bounds.h);
      expect(parentAbs.x + local.x, node.id).toBe(abs.x);
      expect(parentAbs.y + local.y, node.id).toBe(abs.y);
      checked += 1;
    }

    // backdrop, drawer, rail, panel, gauge, badge, footer
    expect(checked).toBe(7);
  });
});

describe("walkLayoutTree / sortChildrenByZIndex / flattenLayout", () => {
  it("walks depth-first with ancestor chains", () => {
    const root = canvasRoot([
      {
        type: "subview",
        id: "group",
        bounds: { x: 0, y: 0, w: 10, h: 10 },
        children: [deco("hit", { x: 1, y: 2, w: 3, h: 4 })],
      },
    ]);
    const ids = [...walkLayoutTree(root)].map((e) => ({
      id: e.node.id ?? e.node.type,
      depth: e.depth,
      ancestorIds: e.ancestors.map((a) => a.id ?? a.type),
    }));
    expect(ids).toEqual([
      { id: "canvas", depth: 0, ancestorIds: [] },
      { id: "group", depth: 1, ancestorIds: ["canvas"] },
      { id: "hit", depth: 2, ancestorIds: ["canvas", "group"] },
    ]);
  });

  it("sorts siblings by zIndex", () => {
    const container: LayoutNode = {
      type: "subview",
      bounds: { x: 0, y: 0, w: 10, h: 10 },
      children: [
        deco("a", { x: 0, y: 0, w: 1, h: 1, zIndex: 5 }),
        deco("b", { x: 0, y: 0, w: 1, h: 1 }),
        deco("c", { x: 0, y: 0, w: 1, h: 1, zIndex: 2 }),
      ],
    };
    expect(sortChildrenByZIndex(container).map((n) => n.id)).toEqual([
      "b",
      "c",
      "a",
    ]);
  });

  it("flattens with absolute bounds", () => {
    const view: SkinView = {
      layout: canvasRoot([
        {
          type: "subview",
          id: "g",
          bounds: { x: 10, y: 20, w: 50, h: 40 },
          children: [deco("h", { x: 5, y: 6, w: 7, h: 8 })],
        },
      ]),
    };
    const flat = flattenLayout(view, { width: 100, height: 80 });
    const hit = flat.find((e) => e.node.id === "h");
    expect(hit?.absoluteBounds).toEqual({
      x: 15,
      y: 26,
      w: 7,
      h: 8,
      zIndex: undefined,
    });
  });
});

describe("validateLayoutTree", () => {
  it("flags duplicate ids", () => {
    const view: SkinView = {
      layout: canvasRoot([
        deco("same", { x: 0, y: 0, w: 1, h: 1 }),
        deco("same", { x: 1, y: 1, w: 1, h: 1 }),
      ]),
    };
    const result = validateLayoutTree(view);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.code === "duplicate-id")).toBe(true);
  });

  it("accepts nested subview groups", () => {
    const view: SkinView = {
      layout: canvasRoot([
        {
          type: "subview",
          id: "cluster",
          bounds: { x: 0, y: 0, w: 10, h: 10 },
          children: [deco("hit", { x: 1, y: 1, w: 2, h: 2 })],
        },
      ]),
    };
    const result = validateLayoutTree(view);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("warns on missing ids", () => {
    const view: SkinView = {
      layout: canvasRoot([deco(undefined, { x: 0, y: 0, w: 1, h: 1 })]),
    };
    const result = validateLayoutTree(view);
    expect(result.ok).toBe(true);
    expect(result.warnings.some((w) => w.code === "missing-id")).toBe(true);
  });
});

describe("nested layout lint", () => {
  it("accepts a deeply nested subview chain with mixed anchoring (errors only)", () => {
    const result = validateSkinManifestLayouts({ main: nestedPanelView() });
    expect(result.ok, JSON.stringify(result.errors)).toBe(true);
    expect(result.errors).toEqual([]);
  });
});
