import { describe, expect, it } from "vitest";
import {
  clampSlideshowPage,
  collectSlideshowNodes,
  initSlideshowState,
  resolveSlideshowAssetForState,
  resolveSlideshowAssetPath,
} from "./skinSlideshow";
import type { LayoutTreeNode, SlideshowNode } from "../types/skin";

const slideshowNode: SlideshowNode = {
  type: "slideshow",
  id: "info-promo",
  presentation: {
    kind: "imageSequence",
    assetPattern: "promo/c_sub_{deckIndex}_{page}.png",
    decks: {
      story: { deckIndex: 1, pages: 7 },
      trailer: { deckIndex: 3, pages: 1, showPageNav: false },
    },
  },
};

describe("resolveSlideshowAssetPath", () => {
  it("resolves promo/c_sub_1_3.png", () => {
    expect(
      resolveSlideshowAssetPath("promo/c_sub_{deckIndex}_{page}.png", 1, 3),
    ).toBe("promo/c_sub_1_3.png");
  });
});

describe("clampSlideshowPage", () => {
  it("clamps below 1 and above max pages", () => {
    expect(clampSlideshowPage(0, 7)).toBe(1);
    expect(clampSlideshowPage(99, 7)).toBe(7);
    expect(clampSlideshowPage(3, 7)).toBe(3);
  });
});

describe("initSlideshowState", () => {
  it("starts with no active deck and page 1", () => {
    expect(
      initSlideshowState([
        { id: "info-promo", presentation: slideshowNode.presentation },
      ]),
    ).toEqual({
      "info-promo": { deck: null, page: 1 },
    });
  });
});

describe("resolveSlideshowAssetForState", () => {
  it("returns null before a deck is selected", () => {
    expect(
      resolveSlideshowAssetForState(slideshowNode, { deck: null, page: 1 }),
    ).toBeNull();
  });

  it("resolves asset for active deck and page", () => {
    expect(
      resolveSlideshowAssetForState(slideshowNode, {
        deck: "story",
        page: 3,
      }),
    ).toBe("promo/c_sub_1_3.png");
  });

  it("clamps page to deck max", () => {
    expect(
      resolveSlideshowAssetForState(slideshowNode, {
        deck: "story",
        page: 99,
      }),
    ).toBe("promo/c_sub_1_7.png");
  });
});

describe("collectSlideshowNodes", () => {
  it("finds slideshow nodes in nested layouts", () => {
    const layout: LayoutTreeNode = {
      type: "canvas",
      width: 100,
      height: 80,
      children: [
        {
          type: "overlay",
          children: [slideshowNode],
        },
      ],
    };

    expect(collectSlideshowNodes(layout)).toEqual([
      { id: "info-promo", presentation: slideshowNode.presentation },
    ]);
  });
});
