import { getNativeDeck, type DeckId } from "./nativeDeckRegistry";

export type { DeckId };

/**
 * Crossfade-controller helpers: jump a deck to a mix, or fade it linearly.
 * They forward to the native engine that currently owns the deck; with none
 * loaded there is nothing to adjust.
 */
export function setDeckGain(deckId: DeckId, value: number): void {
  getNativeDeck(deckId)?.setCrossfadeMix(Math.max(0, Math.min(1, value)));
}

export function rampDeckGain(
  deckId: DeckId,
  target: number,
  durationSec: number,
): void {
  getNativeDeck(deckId)?.rampCrossfadeMix(
    Math.max(0, Math.min(1, target)),
    durationSec,
  );
}
