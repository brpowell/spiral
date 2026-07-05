import { describe, expect, it } from "vitest";
import {
  evaluateSkinBind,
  evaluateSkinCondition,
  isSkinControlEnabled,
} from "./skinBinds";
import { minimalBindState } from "../test/skinBindFixtures";
import {
  evaluateSlideshowBind,
  initSlideshowState,
} from "./skinSlideshow";
import {
  initScrollStripState,
} from "./skinScrollStrip";
import { evaluateViewBind } from "./skinViewStateContext";
import type { ScrollStripPresentation, SlideshowPresentation } from "../types/skin";

const promoPresentation: SlideshowPresentation = {
  kind: "imageSequence",
  assetPattern: "promo/c_sub_{deckIndex}_{page}",
  decks: {
    story: { deckIndex: 1, pages: 7, showPageNav: true },
    trailer: { deckIndex: 3, pages: 1, showPageNav: false },
  },
};

const contentStripPresentation: ScrollStripPresentation = {
  kind: "bitmapVertical",
  items: [{ id: "xbox", asset: "content/c_xbox_text.gif", w: 255, h: 50 }],
  slides: [{ items: { xbox: { y: 172 } } }, { items: { xbox: { y: 92 } } }],
};

describe("evaluateViewBind", () => {
  it("matches view.screen.* derived booleans", () => {
    expect(evaluateViewBind("view.screen.menu", { screen: "menu" })).toBe(true);
    expect(evaluateViewBind("view.screen.content", { screen: "menu" })).toBe(
      false,
    );
    expect(evaluateViewBind("view.screen.content", { screen: "content" })).toBe(
      true,
    );
  });

  it("returns raw variable values for single-segment paths", () => {
    expect(evaluateViewBind("view.screen", { screen: "menu" })).toBe("menu");
  });
});

describe("evaluateSkinBind view state integration", () => {
  it("evaluates view.screen.menu through evaluateSkinBind", () => {
    const state = minimalBindState({ viewState: { screen: "menu" } });
    expect(evaluateSkinBind("view.screen.menu", state)).toBe(true);
    expect(evaluateSkinBind("view.screen.content", state)).toBe(false);
  });
});

describe("evaluateSlideshowBind", () => {
  const presentations = { "info-promo": promoPresentation };
  const state = {
    ...initSlideshowState([{ id: "info-promo", presentation: promoPresentation }]),
    "info-promo": { deck: "story", page: 3 },
  };

  it("matches deck and page", () => {
    expect(
      evaluateSlideshowBind("slideshow.info-promo.deck.story", presentations, state),
    ).toBe(true);
    expect(
      evaluateSlideshowBind("slideshow.info-promo.deck.trailer", presentations, state),
    ).toBe(false);
    expect(
      evaluateSlideshowBind("slideshow.info-promo.page.3", presentations, state),
    ).toBe(true);
    expect(
      evaluateSlideshowBind("slideshow.info-promo.page.4", presentations, state),
    ).toBe(false);
    expect(
      evaluateSlideshowBind(
        "slideshow.info-promo.deck.story.page.3",
        presentations,
        state,
      ),
    ).toBe(true);
    expect(
      evaluateSlideshowBind(
        "slideshow.info-promo.deck.story.page.7",
        presentations,
        state,
      ),
    ).toBe(false);
    expect(
      evaluateSlideshowBind(
        "slideshow.info-promo.deck.links.page.1",
        presentations,
        { ...state, "info-promo": { deck: "links", page: 1 } },
      ),
    ).toBe(true);
  });

  it("reports navigation guards", () => {
    expect(
      evaluateSlideshowBind("slideshow.info-promo.canPrev", presentations, state),
    ).toBe(true);
    expect(
      evaluateSlideshowBind("slideshow.info-promo.canNext", presentations, state),
    ).toBe(true);
    expect(
      evaluateSlideshowBind("slideshow.info-promo.atFirst", presentations, state),
    ).toBe(false);
    expect(
      evaluateSlideshowBind("slideshow.info-promo.atLast", presentations, state),
    ).toBe(false);
  });

  it("hides page nav for trailer deck", () => {
    const trailerState = {
      ...state,
      "info-promo": { deck: "trailer", page: 1 },
    };
    expect(
      evaluateSlideshowBind(
        "slideshow.info-promo.showPageNav",
        presentations,
        trailerState,
      ),
    ).toBe(false);
  });
});

describe("evaluateScrollStripBind integration", () => {
  const presentations = { "content-text": contentStripPresentation };
  const state = {
    ...initScrollStripState([
      { id: "content-text", presentation: contentStripPresentation },
    ]),
    "content-text": { slide: 2 },
  };

  it("evaluates through evaluateSkinBind", () => {
    const bindState = minimalBindState({
      scrollStripPresentations: presentations,
      scrollStripState: state,
    });
    expect(
      evaluateSkinBind("scrollStrip.content-text.slide.2", bindState),
    ).toBe(true);
    expect(
      evaluateSkinBind("scrollStrip.content-text.canPrev", bindState),
    ).toBe(true);
    expect(
      evaluateSkinBind("scrollStrip.content-text.atLast", bindState),
    ).toBe(true);
  });
});

describe("slideshow page clamping via state transitions", () => {
  it("clamps at deck bounds when page moves", () => {
    const atLast = { deck: "story", page: 7 };
    const presentations = { "info-promo": promoPresentation };

    expect(
      evaluateSlideshowBind(
        "slideshow.info-promo.canNext",
        presentations,
        { "info-promo": atLast },
      ),
    ).toBe(false);
    expect(
      evaluateSlideshowBind(
        "slideshow.info-promo.atLast",
        presentations,
        { "info-promo": atLast },
      ),
    ).toBe(true);
  });
});

describe("skin.pref binds", () => {
  it("evaluates skin.pref.soundEffectsEnabled", () => {
    expect(
      evaluateSkinBind(
        "skin.pref.soundEffectsEnabled",
        minimalBindState({ soundEffectsEnabled: true }),
      ),
    ).toBe(true);
    expect(
      evaluateSkinBind(
        "skin.pref.soundEffectsEnabled",
        minimalBindState({ soundEffectsEnabled: false }),
      ),
    ).toBe(false);
  });
});

describe("evaluateSkinCondition", () => {
  const shutterOpenIntroDone = minimalBindState({
    viewState: { shutter: "open", xIntro: "done" },
  });
  const shutterClosedIntroDone = minimalBindState({
    viewState: { shutter: "closed", xIntro: "done" },
  });
  const shutterOpenIntroPlaying = minimalBindState({
    viewState: { shutter: "open", xIntro: "playing" },
  });

  it("evaluates leaf binds", () => {
    expect(
      evaluateSkinCondition("view.shutter.open", shutterOpenIntroDone),
    ).toBe(true);
    expect(
      evaluateSkinCondition("view.shutter.open", shutterClosedIntroDone),
    ).toBe(false);
  });

  it("evaluates all", () => {
    const condition = {
      all: ["view.shutter.open", "view.xIntro.done"],
    };
    expect(evaluateSkinCondition(condition, shutterOpenIntroDone)).toBe(true);
    expect(evaluateSkinCondition(condition, shutterClosedIntroDone)).toBe(false);
    expect(evaluateSkinCondition(condition, shutterOpenIntroPlaying)).toBe(
      false,
    );
  });

  it("evaluates any and not", () => {
    expect(
      evaluateSkinCondition(
        { any: ["view.shutter.closing", "view.shutter.closed"] },
        minimalBindState({ viewState: { shutter: "closed" } }),
      ),
    ).toBe(true);
    expect(
      evaluateSkinCondition(
        { not: "view.xIntro.playing" },
        shutterOpenIntroDone,
      ),
    ).toBe(true);
    expect(
      evaluateSkinCondition(
        { not: "view.xIntro.playing" },
        shutterOpenIntroPlaying,
      ),
    ).toBe(false);
  });
});

describe("isSkinControlEnabled", () => {
  it("is enabled when condition is truthy or unset", () => {
    const state = minimalBindState({ viewState: { shutter: "open" } });
    expect(isSkinControlEnabled("view.shutter.open", state)).toBe(true);
    expect(isSkinControlEnabled(undefined, state)).toBe(true);
    expect(isSkinControlEnabled("view.shutter.closed", state)).toBe(false);
  });
});
