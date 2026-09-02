import { describe, expect, it } from "vitest";
import {
  evaluateSkinBind,
  evaluateSkinCondition,
  isSkinControlEnabled,
  isSkinVisible,
} from "./skinBinds";
import { minimalBindState } from "../test/skinBindFixtures";
import { evaluateSlideshowBind, initSlideshowState } from "./skinSlideshow";
import { initScrollStripState } from "./skinScrollStrip";
import { evaluateViewBind } from "./skinViewStateContext";
import type {
  ScrollStripPresentation,
  SkinSetting,
  SlideshowPresentation,
} from "../types/skin";

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
    ...initSlideshowState([
      { id: "info-promo", presentation: promoPresentation },
    ]),
    "info-promo": { deck: "story", page: 3 },
  };

  it("matches deck and page", () => {
    expect(
      evaluateSlideshowBind(
        "slideshow.info-promo.deck.story",
        presentations,
        state,
      ),
    ).toBe(true);
    expect(
      evaluateSlideshowBind(
        "slideshow.info-promo.deck.trailer",
        presentations,
        state,
      ),
    ).toBe(false);
    expect(
      evaluateSlideshowBind(
        "slideshow.info-promo.page.3",
        presentations,
        state,
      ),
    ).toBe(true);
    expect(
      evaluateSlideshowBind(
        "slideshow.info-promo.page.4",
        presentations,
        state,
      ),
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
      evaluateSlideshowBind(
        "slideshow.info-promo.canPrev",
        presentations,
        state,
      ),
    ).toBe(true);
    expect(
      evaluateSlideshowBind(
        "slideshow.info-promo.canNext",
        presentations,
        state,
      ),
    ).toBe(true);
    expect(
      evaluateSlideshowBind(
        "slideshow.info-promo.atFirst",
        presentations,
        state,
      ),
    ).toBe(false);
    expect(
      evaluateSlideshowBind(
        "slideshow.info-promo.atLast",
        presentations,
        state,
      ),
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
    expect(evaluateSkinBind("scrollStrip.content-text.atLast", bindState)).toBe(
      true,
    );
  });
});

describe("slideshow page clamping via state transitions", () => {
  it("clamps at deck bounds when page moves", () => {
    const atLast = { deck: "story", page: 7 };
    const presentations = { "info-promo": promoPresentation };

    expect(
      evaluateSlideshowBind("slideshow.info-promo.canNext", presentations, {
        "info-promo": atLast,
      }),
    ).toBe(false);
    expect(
      evaluateSlideshowBind("slideshow.info-promo.atLast", presentations, {
        "info-promo": atLast,
      }),
    ).toBe(true);
  });
});

describe("skin.pref binds", () => {
  const hideHelpBubble: SkinSetting = {
    id: "hideHelpBubble",
    name: "Hide help bubble",
    type: "boolean",
    default: false,
  };

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

  it("evaluates author-defined boolean prefs", () => {
    expect(
      evaluateSkinBind(
        "skin.pref.hideHelpBubble",
        minimalBindState({
          skinSettings: [hideHelpBubble],
          skinPreferences: { builtin: {}, custom: { hideHelpBubble: true } },
        }),
      ),
    ).toBe(true);
    expect(
      evaluateSkinBind(
        "skin.pref.hideHelpBubble",
        minimalBindState({ skinSettings: [hideHelpBubble] }),
      ),
    ).toBe(false);
  });

  it("negates skin.pref.soundEffectsEnabled in conditions", () => {
    expect(
      evaluateSkinCondition(
        { not: "skin.pref.soundEffectsEnabled" },
        minimalBindState({ soundEffectsEnabled: true }),
      ),
    ).toBe(false);
    expect(
      evaluateSkinCondition(
        { not: "skin.pref.soundEffectsEnabled" },
        minimalBindState({ soundEffectsEnabled: false }),
      ),
    ).toBe(true);
  });

  it("skips help bubble reveal when hideHelpBubble pref is set", () => {
    const when = {
      all: ["view.intro.revealed", { not: "skin.pref.hideHelpBubble" }],
    };
    expect(
      evaluateSkinCondition(
        when,
        minimalBindState({
          skinSettings: [hideHelpBubble],
          skinPreferences: { builtin: {}, custom: { hideHelpBubble: true } },
          viewState: { intro: "revealed" },
        }),
      ),
    ).toBe(false);
    expect(
      evaluateSkinCondition(
        when,
        minimalBindState({
          skinSettings: [hideHelpBubble],
          viewState: { intro: "revealed" },
        }),
      ),
    ).toBe(true);
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

  it("evaluates literal booleans", () => {
    expect(evaluateSkinCondition(false, shutterOpenIntroDone)).toBe(false);
    expect(evaluateSkinCondition(true, shutterOpenIntroDone)).toBe(true);
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
    expect(evaluateSkinCondition(condition, shutterClosedIntroDone)).toBe(
      false,
    );
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

describe("evaluateSkinBind input and playlist filter", () => {
  it("reads input.{id}.value and .empty", () => {
    const empty = minimalBindState();
    expect(evaluateSkinBind("input.plSearchEdit.value", empty)).toBe("");
    expect(evaluateSkinBind("input.plSearchEdit.empty", empty)).toBe(true);

    const typed = minimalBindState({
      inputValues: { plSearchEdit: "Radio" },
    });
    expect(evaluateSkinBind("input.plSearchEdit.value", typed)).toBe("Radio");
    expect(evaluateSkinBind("input.plSearchEdit.empty", typed)).toBe(false);
  });

  it("reads playlist.filterQuery and hasFilter", () => {
    expect(evaluateSkinBind("playlist.filterQuery", minimalBindState())).toBe(
      "",
    );
    expect(evaluateSkinBind("playlist.hasFilter", minimalBindState())).toBe(
      false,
    );
    const filtered = minimalBindState({ playlistFilterQuery: "air" });
    expect(evaluateSkinBind("playlist.filterQuery", filtered)).toBe("air");
    expect(evaluateSkinBind("playlist.hasFilter", filtered)).toBe(true);
  });
});

describe("evaluateSkinBind hover node ids", () => {
  it("is true only while the pointer is over that node", () => {
    expect(evaluateSkinBind("hover.visFrame", minimalBindState())).toBe(false);
    expect(
      evaluateSkinBind(
        "hover.visFrame",
        minimalBindState({ hoveredNodeIds: new Set(["visFrame"]) }),
      ),
    ).toBe(true);
    expect(
      evaluateSkinBind(
        "hover.subview-6",
        minimalBindState({ hoveredNodeIds: new Set(["visFrame"]) }),
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
    expect(isSkinControlEnabled(false, state)).toBe(false);
    expect(isSkinControlEnabled(true, state)).toBe(true);
  });
});

describe("isSkinVisible", () => {
  it("is visible when condition is truthy or unset", () => {
    const state = minimalBindState({ viewState: { shutter: "open" } });
    expect(isSkinVisible("view.shutter.open", state)).toBe(true);
    expect(isSkinVisible(undefined, state)).toBe(true);
    expect(isSkinVisible("view.shutter.closed", state)).toBe(false);
    expect(isSkinVisible(false, state)).toBe(false);
    expect(isSkinVisible(true, state)).toBe(true);
  });
});

describe("bind path isolation", () => {
  it("does not expose library filePath through binds", () => {
    const state = minimalBindState();
    expect(evaluateSkinBind("track.filePath", state)).toBeNull();
    expect(evaluateSkinBind("track.path", state)).toBeNull();
  });
});

describe("track.rating binds", () => {
  const ratedTrack = {
    id: 1,
    title: "Song",
    artist: "Artist",
    album: "Album",
    albumArtist: "Artist",
    trackNumber: 1,
    totalTracks: null,
    discNumber: 1,
    totalDiscs: null,
    year: null,
    genre: null,
    durationSeconds: 180,
    sampleRate: null,
    bitrate: null,
    codec: null,
    filePath: "/library/1.mp3",
    artPath: null,
    dateAdded: "2024-01-01",
    playCount: 0,
    lastPlayedAt: null,
    rating: 128,
  };

  it("returns null when no track is loaded", () => {
    expect(evaluateSkinBind("track.rating", minimalBindState())).toBeNull();
  });

  it("returns the canonical 0–255 rating", () => {
    const state = minimalBindState({ currentTrack: ratedTrack });
    expect(evaluateSkinBind("track.rating", state)).toBe(128);
  });

  it("returns 0 for an unrated track", () => {
    const state = minimalBindState({
      currentTrack: { ...ratedTrack, rating: 0 },
    });
    expect(evaluateSkinBind("track.rating", state)).toBe(0);
  });
});
