import { describe, expect, it } from "vitest";
import { evaluateSkinBind, type SkinBindState } from "./skinBinds";
import {
  evaluateSlideshowBind,
  initSlideshowState,
} from "./skinSlideshow";
import { evaluateViewBind } from "./skinViewStateContext";
import type { SlideshowPresentation } from "../types/skin";

function minimalBindState(
  overrides: Partial<SkinBindState> = {},
): SkinBindState {
  return {
    currentTrack: null,
    artUrl: null,
    playbackState: "stopped",
    positionSeconds: 0,
    repeatMode: "off",
    shuffle: false,
    volume: 1,
    balance: 0,
    muted: false,
    canGoPrevious: false,
    canGoNext: false,
    activeQueueLength: 0,
    currentTrackId: null,
    alwaysOnTop: false,
    currentPlayable: null,
    panelOpen: {},
    panelRevealed: {},
    panelSettled: {},
    visualizerName: "",
    canCycleVisualizer: false,
    playlistSourceId: "all",
    playlists: [],
    library: [],
    playbackTracks: [],
    playContextIds: [],
    manualQueueIds: [],
    eqEnabled: false,
    eqPresetId: "flat",
    eqBands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    eqCustomPresets: [],
    soundEffectsEnabled: true,
    viewState: {},
    slideshowPresentations: {},
    slideshowState: {},
    ...overrides,
  };
}

const promoPresentation: SlideshowPresentation = {
  kind: "imageSequence",
  assetPattern: "promo/c_sub_{deckIndex}_{page}",
  decks: {
    story: { deckIndex: 1, pages: 7, showPageNav: true },
    trailer: { deckIndex: 3, pages: 1, showPageNav: false },
  },
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
