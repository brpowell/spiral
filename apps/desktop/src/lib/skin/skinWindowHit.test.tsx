import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SKIN_WINDOW_HIT_ATTR,
  clearSkinArtworkAlphaCache,
  isOverSkinWindowContent,
  setSkinArtworkAlphaForTest,
} from "./skinWindowHit";

afterEach(() => {
  clearSkinArtworkAlphaCache();
  document.body.replaceChildren();
});

function bitmapDecoration(url: string): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.className = "skin-decoration skin-decoration--bitmap";
  canvas.dataset.assetUrl = url;
  return canvas;
}

function stubRect(
  el: HTMLElement,
  rect: { left: number; top: number; right: number; bottom: number },
) {
  vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
    x: rect.left,
    y: rect.top,
    width: rect.right - rect.left,
    height: rect.bottom - rect.top,
    ...rect,
    toJSON() {
      return rect;
    },
  } as DOMRect);
}

describe("isOverSkinWindowContent", () => {
  it("passes through transparent decoration pixels", () => {
    const bounds = document.createElement("div");
    bounds.className = "skin-bounds";
    bounds.setAttribute(SKIN_WINDOW_HIT_ATTR, "artwork");
    const canvas = bitmapDecoration("https://example.test/head.png");
    bounds.append(canvas);
    document.body.append(bounds);

    stubRect(bounds, { left: 0, top: 0, right: 10, bottom: 10 });
    stubRect(canvas, { left: 0, top: 0, right: 10, bottom: 10 });
    setSkinArtworkAlphaForTest("https://example.test/head.png", {
      width: 2,
      height: 2,
      alpha: new Uint8Array([0, 0, 0, 255]),
    });

    expect(
      isOverSkinWindowContent(1, 1, document, { width: 100, height: 100 }),
    ).toBe(false);
    expect(
      isOverSkinWindowContent(8, 8, document, { width: 100, height: 100 }),
    ).toBe(true);
  });

  it("ignores empty grouping subviews", () => {
    const bounds = document.createElement("div");
    bounds.className = "skin-bounds";
    bounds.setAttribute(SKIN_WINDOW_HIT_ATTR, "group");
    const inner = document.createElement("div");
    inner.className = "skin-layout-node skin-layout-node--subview";
    bounds.append(inner);
    document.body.append(bounds);
    stubRect(bounds, { left: 0, top: 0, right: 80, bottom: 170 });

    expect(
      isOverSkinWindowContent(10, 10, document, { width: 200, height: 200 }),
    ).toBe(false);
  });

  it("keeps painted grouping subviews interactive", () => {
    const bounds = document.createElement("div");
    bounds.className = "skin-bounds";
    bounds.setAttribute(SKIN_WINDOW_HIT_ATTR, "group");
    const inner = document.createElement("div");
    inner.className = "skin-layout-node skin-layout-node--subview";
    inner.style.backgroundColor = "#285f03";
    bounds.append(inner);
    document.body.append(bounds);
    stubRect(bounds, { left: 0, top: 0, right: 171, bottom: 140 });

    expect(
      isOverSkinWindowContent(20, 20, document, { width: 200, height: 200 }),
    ).toBe(true);
  });

  it("treats tiled-frame chrome tiles as solid so aux title bars stay draggable", () => {
    const tile = document.createElement("div");
    tile.className = "skin-tiled-frame__tile";
    document.body.append(tile);
    stubRect(tile, { left: 0, top: 0, right: 279, bottom: 43 });

    expect(
      isOverSkinWindowContent(40, 12, document, { width: 279, height: 245 }),
    ).toBe(true);
    expect(
      isOverSkinWindowContent(40, 80, document, { width: 279, height: 245 }),
    ).toBe(false);
  });

  it("treats tiled-frame content as solid when fill controls omit bounds", () => {
    const content = document.createElement("div");
    content.className = "skin-tiled-frame__content";
    document.body.append(content);
    stubRect(content, { left: 24, top: 43, right: 256, bottom: 222 });

    expect(
      isOverSkinWindowContent(80, 100, document, { width: 279, height: 245 }),
    ).toBe(true);
  });

  it("samples artwork from authored bounds when the decoration box is empty", () => {
    const bounds = document.createElement("div");
    bounds.className = "skin-bounds";
    bounds.setAttribute(SKIN_WINDOW_HIT_ATTR, "artwork");
    const canvas = bitmapDecoration("https://example.test/head.png");
    bounds.append(canvas);
    document.body.append(bounds);

    stubRect(bounds, { left: 261, top: 0, right: 495, bottom: 394 });
    stubRect(canvas, { left: 0, top: 0, right: 0, bottom: 0 });
    setSkinArtworkAlphaForTest("https://example.test/head.png", {
      width: 2,
      height: 2,
      alpha: new Uint8Array([0, 0, 0, 255]),
    });

    expect(
      isOverSkinWindowContent(270, 10, document, { width: 760, height: 394 }),
    ).toBe(false);
    expect(
      isOverSkinWindowContent(450, 350, document, { width: 760, height: 394 }),
    ).toBe(true);
  });

  it("ignores hit targets in inactive view layers", () => {
    const layer = document.createElement("div");
    layer.className = "skin-view-layer skin-view-layer--inactive";
    const bounds = document.createElement("div");
    bounds.className = "skin-bounds";
    bounds.setAttribute(SKIN_WINDOW_HIT_ATTR, "artwork");
    const canvas = bitmapDecoration("https://example.test/mini.png");
    bounds.append(canvas);
    layer.append(bounds);
    document.body.append(layer);

    stubRect(bounds, { left: 0, top: 0, right: 400, bottom: 81 });
    stubRect(canvas, { left: 0, top: 0, right: 400, bottom: 81 });
    setSkinArtworkAlphaForTest("https://example.test/mini.png", {
      width: 1,
      height: 1,
      alpha: new Uint8Array([255]),
    });

    expect(
      isOverSkinWindowContent(40, 20, document, { width: 317, height: 330 }),
    ).toBe(false);
  });
});
