import type { EqualizerState } from "../equalizer/types";
import { getNativeDeck } from "./nativeDeckRegistry";
import { applyNativeEqualizer } from "./nativeEqualizer";
import {
  applyEqualizerState as applyEqChainState,
  disposeEqualizerChain,
  ensureEqualizerChain,
} from "./eqAudio";

const FFT_SIZE = 256;
const SMOOTHING = 0.8;

/** Shared with visualizer bridge — must match `AnalyserNode.fftSize`. */
export const ANALYSER_FFT_SIZE = FFT_SIZE;
export const ANALYSER_FREQUENCY_BIN_COUNT = FFT_SIZE / 2;

export type DeckId = "a" | "b";

/** The slice of `AnalyserNode` the visualizers read. */
export interface AudioAnalyser {
  readonly fftSize: number;
  readonly frequencyBinCount: number;
  getByteFrequencyData(array: Uint8Array<ArrayBuffer>): void;
  getByteTimeDomainData(array: Uint8Array<ArrayBuffer>): void;
}

interface DeckSlot {
  source: AudioNode | null;
  gain: GainNode | null;
}

interface OutputBus {
  context: AudioContext | OfflineAudioContext;
  mixer: GainNode;
  analyser: AnalyserNode;
}

let outputBus: OutputBus | null = null;
const decks: Record<DeckId, DeckSlot> = {
  a: { source: null, gain: null },
  b: { source: null, gain: null },
};

function resetOutputBusIfContextChanged(
  ctx: AudioContext | OfflineAudioContext,
): void {
  if (outputBus && outputBus.context !== ctx) {
    outputBus = null;
    decks.a = { source: null, gain: null };
    decks.b = { source: null, gain: null };
    disposeEqualizerChain();
  }
}

function ensureOutputBus(ctx: AudioContext | OfflineAudioContext): OutputBus {
  resetOutputBusIfContextChanged(ctx);
  if (outputBus) return outputBus;

  const mixer = ctx.createGain();
  mixer.gain.value = 1;

  const analyser = ctx.createAnalyser();
  analyser.fftSize = FFT_SIZE;
  analyser.smoothingTimeConstant = SMOOTHING;

  const eq = ensureEqualizerChain(ctx);
  mixer.connect(eq.input);
  eq.output.connect(analyser);
  analyser.connect(ctx.destination);

  outputBus = { context: ctx, mixer, analyser };
  return outputBus;
}

function disconnectDeckSlot(slot: DeckSlot): void {
  if (slot.source) {
    try {
      slot.source.disconnect();
    } catch {
      // already disconnected
    }
  }
  if (slot.gain) {
    try {
      slot.gain.disconnect();
    } catch {
      // already disconnected
    }
  }
  slot.source = null;
  slot.gain = null;
}

function activeDeckCount(): number {
  return (["a", "b"] as const).filter((deckId) => decks[deckId].gain !== null)
    .length;
}

/** Route a deck source through per-deck gain into the shared EQ → analyser bus. */
export function connectDeckOutput(
  deckId: DeckId,
  source: AudioNode,
): AnalyserNode {
  const bus = ensureOutputBus(source.context);
  const slot = decks[deckId];

  if (slot.source !== source) {
    disconnectDeckSlot(slot);

    try {
      source.disconnect();
    } catch {
      // e.g. source may have been connected → destination
    }

    const deckGain = source.context.createGain();
    deckGain.gain.value = 1;
    source.connect(deckGain);
    deckGain.connect(bus.mixer);
    slot.source = source;
    slot.gain = deckGain;
  }

  return bus.analyser;
}

export function disconnectDeckOutput(deckId: DeckId): void {
  disconnectDeckSlot(decks[deckId]);
  if (activeDeckCount() === 0) {
    outputBus = null;
    disposeEqualizerChain();
  }
}

export function setDeckGain(deckId: DeckId, value: number): void {
  const native = getNativeDeck(deckId);
  if (native) {
    native.setCrossfadeMix(value);
    return;
  }
  const gainNode = decks[deckId].gain;
  if (!gainNode) return;

  const ctx = gainNode.context;
  const now = ctx.currentTime;
  const clamped = Math.max(0, Math.min(1, value));
  gainNode.gain.cancelScheduledValues(now);
  gainNode.gain.setValueAtTime(clamped, now);
}

export function rampDeckGain(
  deckId: DeckId,
  target: number,
  durationSec: number,
): void {
  const native = getNativeDeck(deckId);
  if (native) {
    native.rampCrossfadeMix(target, durationSec);
    return;
  }
  const gainNode = decks[deckId].gain;
  if (!gainNode) return;

  const ctx = gainNode.context;
  const now = ctx.currentTime;
  const clampedTarget = Math.max(0, Math.min(1, target));
  gainNode.gain.cancelScheduledValues(now);
  gainNode.gain.setValueAtTime(gainNode.gain.value, now);
  gainNode.gain.linearRampToValueAtTime(clampedTarget, now + durationSec);
}

export function getDeckGainNode(deckId: DeckId): GainNode | null {
  return decks[deckId].gain;
}

export function getAnalyser(): AudioAnalyser | null {
  return outputBus?.analyser ?? null;
}

export function disconnectAllDeckOutputs(): void {
  disconnectDeckOutput("a");
  disconnectDeckOutput("b");
}

export function applyEqualizerState(
  state: Pick<EqualizerState, "enabled" | "bands" | "preampGain">,
): void {
  applyEqChainState(state);
  applyNativeEqualizer(state);
}
