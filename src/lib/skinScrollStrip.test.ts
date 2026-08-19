import { describe, expect, it } from "vitest";
import {
  clampScrollStripSlide,
  collectScrollStripNodes,
  evaluateScrollStripBind,
  initScrollStripState,
  buildScrollStripInitialTops,
  resolveScrollStripItemTop,
  resolveScrollStripSlideLayout,
  scrollStripSlideCount,
} from "./skinScrollStrip";
import type { LayoutTreeNode, ScrollStripNode } from "../types/skin";

const scrollStripNode: ScrollStripNode = {
  type: "scrollStrip",
  id: "content-text",
  bounds: { x: 65, y: 92, w: 255, h: 168, zIndex: 8 },
  presentation: {
    kind: "bitmapVertical",
    transitionMs: 500,
    items: [
      { id: "xbox", asset: "content/c_xbox_text.gif", w: 255, h: 50 },
      { id: "games", asset: "content/c_games_text.gif", w: 255, h: 50 },
      { id: "web", asset: "content/c_web_text.gif", w: 255, h: 50 },
    ],
    slides: [
      { items: { xbox: { y: 172 }, games: { y: 235 } } },
      { items: { xbox: { y: 92 }, games: { y: 172 }, web: { y: 235 } } },
    ],
  },
};

describe("clampScrollStripSlide", () => {
  it("clamps below 1 and above slide count", () => {
    expect(clampScrollStripSlide(0, 5)).toBe(1);
    expect(clampScrollStripSlide(99, 5)).toBe(5);
    expect(clampScrollStripSlide(3, 5)).toBe(3);
  });
});

describe("scrollStripSlideCount", () => {
  it("returns slide array length", () => {
    expect(scrollStripSlideCount(scrollStripNode.presentation)).toBe(2);
  });
});

describe("initScrollStripState", () => {
  it("starts at slide 1", () => {
    expect(
      initScrollStripState([
        { id: "content-text", presentation: scrollStripNode.presentation },
      ]),
    ).toEqual({
      "content-text": { slide: 1 },
    });
  });
});

describe("resolveScrollStripSlideLayout", () => {
  it("returns item positions for active slide", () => {
    expect(resolveScrollStripSlideLayout(scrollStripNode, 1)).toEqual({
      xbox: { y: 172 },
      games: { y: 235 },
    });
    expect(resolveScrollStripSlideLayout(scrollStripNode, 2)).toEqual({
      xbox: { y: 92 },
      games: { y: 172 },
      web: { y: 235 },
    });
  });
});

describe("resolveScrollStripItemTop", () => {
  it("converts stage-absolute Y to strip-local top", () => {
    expect(resolveScrollStripItemTop(172, 92)).toBe(80);
    expect(resolveScrollStripItemTop(235, 92)).toBe(143);
  });
});

describe("buildScrollStripInitialTops", () => {
  it("seeds each item at its first slide appearance", () => {
    expect(buildScrollStripInitialTops(scrollStripNode, 92)).toEqual({
      xbox: 80,
      games: 143,
      web: 143,
    });
  });

  it("uses absolute strip origin when nested under a parent group", () => {
    // Parent origin 100 + local bounds.y 92 = absolute 192
    expect(buildScrollStripInitialTops(scrollStripNode, 192)).toEqual({
      xbox: 172 - 192,
      games: 235 - 192,
      web: 235 - 192,
    });
  });
});

describe("evaluateScrollStripBind", () => {
  const presentations = { "content-text": scrollStripNode.presentation };
  const state = {
    ...initScrollStripState([
      { id: "content-text", presentation: scrollStripNode.presentation },
    ]),
    "content-text": { slide: 2 },
  };

  it("matches slide and navigation guards", () => {
    expect(
      evaluateScrollStripBind(
        "scrollStrip.content-text.slide.2",
        presentations,
        state,
      ),
    ).toBe(true);
    expect(
      evaluateScrollStripBind(
        "scrollStrip.content-text.slide.1",
        presentations,
        state,
      ),
    ).toBe(false);
    expect(
      evaluateScrollStripBind(
        "scrollStrip.content-text.canPrev",
        presentations,
        state,
      ),
    ).toBe(true);
    expect(
      evaluateScrollStripBind(
        "scrollStrip.content-text.canNext",
        presentations,
        state,
      ),
    ).toBe(false);
    expect(
      evaluateScrollStripBind(
        "scrollStrip.content-text.atLast",
        presentations,
        state,
      ),
    ).toBe(true);
  });
});

describe("collectScrollStripNodes", () => {
  it("finds scrollStrip nodes in nested layouts", () => {
    const layout: LayoutTreeNode = {
      type: "canvas",
      width: 100,
      height: 80,
      children: [
        {
          type: "overlay",
          children: [scrollStripNode],
        },
      ],
    };

    expect(collectScrollStripNodes(layout)).toEqual([
      { id: "content-text", presentation: scrollStripNode.presentation },
    ]);
  });
});
