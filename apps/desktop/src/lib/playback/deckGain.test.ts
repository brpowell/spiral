import { afterEach, describe, expect, it, vi } from "vitest";
import { rampDeckGain, setDeckGain } from "./deckGain";
import { registerNativeDeck, unregisterNativeDeck } from "./nativeDeckRegistry";

describe("deck gain helpers", () => {
  const deck = { setCrossfadeMix: vi.fn(), rampCrossfadeMix: vi.fn() };

  afterEach(() => {
    unregisterNativeDeck("a", deck);
    deck.setCrossfadeMix.mockReset();
    deck.rampCrossfadeMix.mockReset();
  });

  it("forwards ramps and sets to the registered native deck", () => {
    registerNativeDeck("a", deck);
    rampDeckGain("a", 0, 3);
    setDeckGain("a", 0.4);
    expect(deck.rampCrossfadeMix).toHaveBeenCalledWith(0, 3);
    expect(deck.setCrossfadeMix).toHaveBeenCalledWith(0.4);
  });

  it("clamps targets to 0–1", () => {
    registerNativeDeck("a", deck);
    rampDeckGain("a", 2, 1);
    setDeckGain("a", -1);
    expect(deck.rampCrossfadeMix).toHaveBeenCalledWith(1, 1);
    expect(deck.setCrossfadeMix).toHaveBeenCalledWith(0);
  });

  it("does nothing for decks nobody owns", () => {
    registerNativeDeck("a", deck);
    rampDeckGain("b", 1, 2);
    setDeckGain("b", 1);
    unregisterNativeDeck("a", deck);
    rampDeckGain("a", 1, 2);
    expect(deck.rampCrossfadeMix).not.toHaveBeenCalled();
    expect(deck.setCrossfadeMix).not.toHaveBeenCalled();
  });
});
