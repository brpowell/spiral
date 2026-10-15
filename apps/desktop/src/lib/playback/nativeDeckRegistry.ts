import type { DeckId } from "./audioMixer";

/** What the deck-level gain helpers need from a native engine. */
export interface NativeDeckGain {
  setCrossfadeMix(mix: number): void;
  rampCrossfadeMix(target: number, durationSec: number): void;
}

const decks: Partial<Record<DeckId, NativeDeckGain>> = {};

/**
 * The crossfade controller drives deck gains through `rampDeckGain` /
 * `setDeckGain`, which target Web Audio gain nodes. Native decks have none, so
 * the engine that currently owns a deck id registers here and those helpers
 * forward to it.
 */
export function registerNativeDeck(deckId: DeckId, deck: NativeDeckGain): void {
  decks[deckId] = deck;
}

export function unregisterNativeDeck(
  deckId: DeckId,
  deck: NativeDeckGain,
): void {
  if (decks[deckId] === deck) delete decks[deckId];
}

export function getNativeDeck(deckId: DeckId): NativeDeckGain | null {
  return decks[deckId] ?? null;
}
