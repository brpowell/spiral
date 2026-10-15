import { afterEach, describe, expect, it, vi } from "vitest";
import { rampDeckGain, setDeckGain } from "./audioMixer";
import { registerNativeDeck, unregisterNativeDeck } from "./nativeDeckRegistry";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

describe("deck gain helpers with a native deck", () => {
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

  it("leaves other decks and unregistered decks alone", () => {
    registerNativeDeck("a", deck);
    rampDeckGain("b", 1, 2);
    unregisterNativeDeck("a", deck);
    rampDeckGain("a", 1, 2);
    expect(deck.rampCrossfadeMix).not.toHaveBeenCalled();
  });
});
