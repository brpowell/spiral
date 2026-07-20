import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { LayoutNode, SkinManifest, SkinView } from "../types/skin";
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

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

function loadManifest(relativePath: string): SkinManifest {
  return JSON.parse(readFileSync(join(repoRoot, relativePath), "utf8")) as SkinManifest;
}

function findById(root: LayoutNode, id: string): {
  node: LayoutNode;
  ancestors: LayoutNode[];
} | undefined {
  for (const entry of walkLayoutTree(root)) {
    if (entry.node.id === id) return entry;
  }
  return undefined;
}

describe("resolveLocalBounds / localizeBounds", () => {
  it("resolves x and right anchors against context size", () => {
    expect(
      resolveLocalBounds({ x: 10, y: 20, w: 30, h: 40 }, { width: 200, height: 100 }),
    ).toEqual({ x: 10, y: 20, w: 30, h: 40, zIndex: undefined });

    expect(
      resolveLocalBounds(
        { right: 50, y: 20, w: 30, h: 40, zIndex: 2 },
        { width: 200, height: 100 },
      ),
    ).toEqual({ x: 150, y: 20, w: 30, h: 40, zIndex: 2 });
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
    const root: LayoutNode = {
      type: "canvas",
      children: [
        {
          type: "decoration",
          id: "bg",
          bounds: { x: 100, y: 50, w: 20, h: 10, zIndex: 1 },
          presentation: { kind: "bitmap", assets: { default: "x.png" } },
        },
      ],
    };
    const child = root.children[0]!;
    expect(resolveAbsoluteBounds(child, [root], stage)).toEqual({
      x: 100,
      y: 50,
      w: 20,
      h: 10,
      zIndex: 1,
    });
  });

  it("sums nested parent origins (Headspace eq-panel chain)", () => {
    const headspace = loadManifest("packs/iconic/skins/headspace/skin.json");
    const view = headspace.views.main!;
    const stageSize = {
      width: view.canvas?.width ?? 753,
      height: view.canvas?.height ?? 432,
    };

    const eqDrawer = findById(view.layout, "eq-drawer");
    const eqPanel = findById(view.layout, "eq-panel");
    const eqBalance = findById(view.layout, "eq-balance");
    expect(eqDrawer && eqPanel && eqBalance).toBeTruthy();

    const drawerAbs = resolveAbsoluteBounds(
      eqDrawer!.node,
      eqDrawer!.ancestors,
      stageSize,
    );
    expect(drawerAbs).toEqual({
      x: 207,
      y: 86,
      w: 269,
      h: 170,
      zIndex: -1,
    });

    const panelAbs = resolveAbsoluteBounds(
      eqPanel!.node,
      eqPanel!.ancestors,
      stageSize,
    );
    expect(panelAbs).toEqual({
      x: 207 + 84,
      y: 86 + 10,
      w: 171,
      h: 140,
      zIndex: undefined,
    });

    const balanceAbs = resolveAbsoluteBounds(
      eqBalance!.node,
      eqBalance!.ancestors,
      stageSize,
    );
    expect(balanceAbs).toEqual({
      x: 207 + 84 + 8,
      y: 86 + 10 + 11,
      w: 71,
      h: 11,
      zIndex: 1,
    });

    // localize back to parent-relative matches authored bounds
    const panelOrigin = { x: panelAbs!.x, y: panelAbs!.y };
    expect(localizeBounds(balanceAbs!, panelOrigin)).toEqual({
      x: 8,
      y: 11,
      w: 71,
      h: 11,
      zIndex: 1,
    });
  });

  it("round-trips every Headspace nested group without drift", () => {
    const headspace = loadManifest("packs/iconic/skins/headspace/skin.json");
    const view = headspace.views.main!;
    const stageSize = {
      width: view.canvas?.width ?? 753,
      height: view.canvas?.height ?? 432,
    };

    for (const { node, ancestors } of walkLayoutTree(view.layout)) {
      if (!node.bounds || ancestors.length === 0) continue;
      const parent = ancestors[ancestors.length - 1]!;
      if (!parent.bounds && parent.type === "canvas" && ancestors.length === 1) {
        // Direct child of stage root: parent-relative === absolute
        const abs = resolveAbsoluteBounds(node, ancestors, stageSize)!;
        expect(localizeBounds(abs, { x: 0, y: 0 }).x).toBe(abs.x);
        expect(localizeBounds(abs, { x: 0, y: 0 }).y).toBe(abs.y);
        continue;
      }

      const abs = resolveAbsoluteBounds(node, ancestors, stageSize);
      if (!abs) continue;

      const parentAbs = parent.bounds
        ? resolveAbsoluteBounds(parent, ancestors.slice(0, -1), stageSize)
        : { x: 0, y: 0, w: stageSize.width, h: stageSize.height };
      if (!parentAbs) continue;

      const local = localizeBounds(abs, { x: parentAbs.x, y: parentAbs.y });
      const authoredX =
        node.bounds.x ??
        (node.bounds.right !== undefined
          ? parentAbs.w - node.bounds.right
          : 0);
      expect(local.x).toBe(authoredX);
      expect(local.y).toBe(node.bounds.y);
      expect(local.w).toBe(node.bounds.w);
      expect(local.h).toBe(node.bounds.h);

      // re-absolute
      expect(parentAbs.x + local.x).toBe(abs.x);
      expect(parentAbs.y + local.y).toBe(abs.y);
    }
  });
});

describe("walkLayoutTree / sortChildrenByZIndex / flattenLayout", () => {
  it("walks depth-first with ancestor chains", () => {
    const root: LayoutNode = {
      type: "canvas",
      children: [
        {
          type: "subview",
          id: "group",
          bounds: { x: 0, y: 0, w: 10, h: 10 },
          children: [
            {
              type: "hitArea",
              id: "hit",
              bounds: { x: 1, y: 2, w: 3, h: 4 },
            },
          ],
        },
      ],
    };
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
        {
          type: "hitArea",
          id: "a",
          bounds: { x: 0, y: 0, w: 1, h: 1, zIndex: 5 },
        },
        {
          type: "hitArea",
          id: "b",
          bounds: { x: 0, y: 0, w: 1, h: 1 },
        },
        {
          type: "hitArea",
          id: "c",
          bounds: { x: 0, y: 0, w: 1, h: 1, zIndex: 2 },
        },
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
      layoutMode: "canvas",
      canvas: { width: 100, height: 80 },
      layout: {
        type: "canvas",
        children: [
          {
            type: "subview",
            id: "g",
            bounds: { x: 10, y: 20, w: 50, h: 40 },
            children: [
              {
                type: "hitArea",
                id: "h",
                bounds: { x: 5, y: 6, w: 7, h: 8 },
              },
            ],
          },
        ],
      },
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
      layout: {
        type: "canvas",
        children: [
          {
            type: "hitArea",
            id: "same",
            bounds: { x: 0, y: 0, w: 1, h: 1 },
          },
          {
            type: "hitArea",
            id: "same",
            bounds: { x: 1, y: 1, w: 1, h: 1 },
          },
        ],
      },
    };
    const result = validateLayoutTree(view);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.code === "duplicate-id")).toBe(true);
  });

  it("rejects nested canvas", () => {
    const view: SkinView = {
      layout: {
        type: "canvas",
        children: [
          {
            type: "canvas",
            id: "nested",
            bounds: { x: 0, y: 0, w: 10, h: 10 },
            children: [],
          },
        ],
      },
    };
    const result = validateLayoutTree(view);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.code === "nested-canvas")).toBe(true);
  });

  it("rejects subview as root", () => {
    const view: SkinView = {
      layout: {
        type: "subview",
        bounds: { x: 0, y: 0, w: 10, h: 10 },
        children: [],
      },
    };
    const result = validateLayoutTree(view);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.code === "subview-as-root")).toBe(true);
  });

  it("accepts nested subview groups", () => {
    const view: SkinView = {
      layout: {
        type: "canvas",
        children: [
          {
            type: "subview",
            id: "cluster",
            bounds: { x: 0, y: 0, w: 10, h: 10 },
            children: [
              {
                type: "hitArea",
                id: "hit",
                bounds: { x: 1, y: 1, w: 2, h: 2 },
              },
            ],
          },
        ],
      },
    };
    const result = validateLayoutTree(view);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("warns on missing ids", () => {
    const view: SkinView = {
      layout: {
        type: "canvas",
        children: [
          {
            type: "hitArea",
            bounds: { x: 0, y: 0, w: 1, h: 1 },
          },
        ],
      },
    };
    const result = validateLayoutTree(view);
    expect(result.ok).toBe(true);
    expect(result.warnings.some((w) => w.code === "missing-id")).toBe(true);
  });
});

describe("pack layout lint", () => {
  it("validates all iconic skin manifests (errors only)", () => {
    const skinsDir = join(repoRoot, "packs/iconic/skins");
    const skinIds = readdirSync(skinsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

    expect(skinIds.length).toBeGreaterThan(0);

    for (const skinId of skinIds) {
      const manifest = loadManifest(`packs/iconic/skins/${skinId}/skin.json`);
      const result = validateSkinManifestLayouts(manifest.views);
      expect(result.ok, `${skinId}: ${JSON.stringify(result.errors)}`).toBe(
        true,
      );
    }
  });
});
