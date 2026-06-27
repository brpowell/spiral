import { describe, expect, it } from "vitest";
import {
  clampSlideshowPage,
  collectSlideshowNodes,
  initSlideshowState,
  resolveSlideshowAssetForState,
  resolveSlideshowAssetPath,
} from "./skinSlideshow";
import type { LayoutNode, SlideshowNode } from "../types/skin";

const slideshowNode: SlideshowNode = {
  type: "slideshow",
  id: "info-promo",
  presentation: {
    kind: "imageSequence",
    assetPattern: "promo/c_sub_{deckIndex}_{page}",
    decks: {
      story: { deckIndex: 1, pages: 7 },
      trailer: { deckIndex: 3, pages: 1, showPageNav: false },
    },
  },
};

describe("resolveSlideshowAssetPath", () => {
  it("resolves promo/c_sub_1_3", () => {
    expect(
      resolveSlideshowAssetPath("promo/c_sub_{deckIndex}_{page}", 1, 3),
    ).toBe("promo/c_sub_1_3");
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
    ).toBe("promo/c_sub_1_3");
  });

  it("clamps page to deck max", () => {
    expect(
      resolveSlideshowAssetForState(slideshowNode, {
        deck: "story",
        page: 99,
      }),
    ).toBe("promo/c_sub_1_7");
  });
});

describe("collectSlideshowNodes", () => {
  it("finds slideshow nodes in nested layouts", () => {
    const layout: LayoutNode = {
      type: "canvas",
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
