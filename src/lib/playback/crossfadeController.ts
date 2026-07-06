import type { PlayableRef } from "../../types/playable";
import type { RepeatMode } from "../../types/track";
import {
  rampDeckGain,
  type DeckId,
} from "./audioMixer";
import {
  canHowlerCrossfade,
  effectiveFadeSeconds,
} from "./canCrossfade";
import { FilePlaybackEngine } from "./filePlaybackEngine";
import type { PlaybackSource } from "./types";

const FADE_COMPLETE_BUFFER_MS = 50;

export interface CrossfadeHandoff {
  incomingPlayable: PlayableRef;
  incomingTrackListId: number;
}

export interface CrossfadeVisualState {
  outgoingTrackId: number;
  incomingTrackId: number;
  /** Linear 0–1 over the full crossfade window (matches audio gain ramps). */
  progress: number;
}

export interface CrossfadeScheduleContext {
  crossfadeSeconds: number;
  currentPlayable: PlayableRef;
  currentTrackId: number;
  currentSource: PlaybackSource;
  nextPlayable: PlayableRef;
  nextSource: PlaybackSource;
  nextTrackId: number;
  repeatMode: RepeatMode;
  volume: number;
  muted: boolean;
  balance: number;
  outgoingDuration: number;
  positionSeconds: number;
  /** Fired when incoming gain crosses outgoing (~50% of linear fade). */
  onActiveTrackChange: (handoff: CrossfadeHandoff) => void;
}

function inactiveDeck(active: DeckId): DeckId {
  return active === "a" ? "b" : "a";
}

function createDeckEngines(): Record<DeckId, FilePlaybackEngine> {
  const deckA = new FilePlaybackEngine();
  const deckB = new FilePlaybackEngine();
  deckA.setDeckId("a");
  deckB.setDeckId("b");
  return { a: deckA, b: deckB };
}

export class CrossfadeController {
  private readonly decks: Record<DeckId, FilePlaybackEngine>;
  private activeDeck: DeckId = "a";
  private fadeState: "idle" | "preloading" | "fading" | "fadeOut" = "idle";
  private fadeOutCompleteCallback: (() => void) | null = null;
  private handledEnd = false;
  private scheduleGeneration = 0;
  private fadeCompleteTimer: ReturnType<typeof setTimeout> | null = null;
  private dominanceTimer: ReturnType<typeof setTimeout> | null = null;
  private fadeOutgoingDeck: DeckId | null = null;
  private fadeIncomingDeck: DeckId | null = null;
  private activeFadeContext: CrossfadeScheduleContext | null = null;
  private fadeStartedAtMs: number | null = null;
  private fadeDurationSec = 0;
  private dominantTrackPromoted = false;
  /** Incoming target while preloading (before activeFadeContext is set). */
  private pendingIncomingTrackId: number | null = null;
  private onEndCallback: (() => void) | null = null;
  private controllerActive = false;
  private userVolume = 1;
  private userMuted = false;
  private userBalance = 0;

  constructor(decks: Record<DeckId, FilePlaybackEngine> = createDeckEngines()) {
    this.decks = decks;
    for (const engine of Object.values(this.decks)) {
      engine.onEnd(() => {
        this.handleDeckEnd(engine);
      });
    }
  }

  isControllerActive(): boolean {
    return this.controllerActive;
  }

  isCrossfadeInProgress(): boolean {
    return this.fadeState !== "idle";
  }

  /** Target track of an in-flight crossfade (preload or fade), if any. */
  getCrossfadeIncomingTrackId(): number | null {
    if (this.fadeState !== "preloading" && this.fadeState !== "fading") {
      return null;
    }
    return this.activeFadeContext?.nextTrackId ?? this.pendingIncomingTrackId;
  }

  getCrossfadeVisualState(): CrossfadeVisualState | null {
    if (this.fadeState !== "fading" || !this.activeFadeContext) return null;
    if (this.fadeStartedAtMs === null || this.fadeDurationSec <= 0) return null;

    const elapsedSec = (Date.now() - this.fadeStartedAtMs) / 1000;
    const progress = Math.min(1, Math.max(0, elapsedSec / this.fadeDurationSec));

    return {
      outgoingTrackId: this.activeFadeContext.currentTrackId,
      incomingTrackId: this.activeFadeContext.nextTrackId,
      progress,
    };
  }

  consumeHandledEnd(): boolean {
    if (!this.handledEnd) return false;
    this.handledEnd = false;
    return true;
  }

  onEnd(callback: () => void): void {
    this.onEndCallback = callback;
  }

  getActiveEngine(): FilePlaybackEngine {
    return this.decks[this.activeDeck];
  }

  private engine(deckId: DeckId): FilePlaybackEngine {
    return this.decks[deckId];
  }

  private applyUserMixToAllActiveEngines(): void {
    this.applyUserMixToEngine(this.engine(this.activeDeck));
    if (this.fadeState === "fading") {
      this.applyUserMixToEngine(this.engine(inactiveDeck(this.activeDeck)));
    }
  }

  private applyUserMixToEngine(engine: FilePlaybackEngine): void {
    engine.setVolume(this.userVolume);
    engine.setMuted(this.userMuted);
    engine.setBalance(this.userBalance);
  }

  async loadAndPlay(
    source: PlaybackSource,
    options: { volume: number; muted: boolean; balance: number },
  ): Promise<void> {
    this.cancelCrossfade();
    this.userVolume = options.volume;
    this.userMuted = options.muted;
    this.userBalance = options.balance;

    const engine = this.getActiveEngine();
    await engine.load(source);
    this.applyUserMixToEngine(engine);
    engine.play();
    this.controllerActive = true;
    this.handledEnd = false;
  }

  deactivate(): void {
    this.cancelCrossfade();
    this.decks.a.destroy();
    this.decks.b.destroy();
    this.controllerActive = false;
    this.activeDeck = "a";
    this.handledEnd = false;
  }

  private clearFadeTimers(): void {
    if (this.fadeCompleteTimer !== null) {
      clearTimeout(this.fadeCompleteTimer);
      this.fadeCompleteTimer = null;
    }
    if (this.dominanceTimer !== null) {
      clearTimeout(this.dominanceTimer);
      this.dominanceTimer = null;
    }
  }

  private clearFadeSession(): void {
    this.fadeOutgoingDeck = null;
    this.fadeIncomingDeck = null;
    this.activeFadeContext = null;
    this.fadeStartedAtMs = null;
    this.fadeDurationSec = 0;
    this.dominantTrackPromoted = false;
    this.pendingIncomingTrackId = null;
  }

  private cancelCrossfadeIfFading(): void {
    if (this.fadeState === "fading") {
      this.cancelCrossfade();
    }
  }

  cancelCrossfade(): void {
    this.scheduleGeneration += 1;
    this.clearFadeTimers();

    if (this.fadeState === "idle") return;

    if (this.fadeState === "fadeOut") {
      const outgoingDeck = this.fadeOutgoingDeck ?? this.activeDeck;
      this.engine(outgoingDeck).setSuppressEndCallback(false);
      this.engine(outgoingDeck).setCrossfadeMix(1);
      rampDeckGain(outgoingDeck, 1, 0);
      this.fadeState = "idle";
      this.handledEnd = false;
      this.fadeOutCompleteCallback = null;
      this.clearFadeSession();
      return;
    }

    const outgoingDeck = this.fadeOutgoingDeck ?? this.activeDeck;
    const incomingDeck = this.fadeIncomingDeck ?? inactiveDeck(outgoingDeck);

    if (this.dominantTrackPromoted) {
      this.engine(outgoingDeck).destroy();
      this.engine(incomingDeck).setSuppressEndCallback(false);
      this.engine(incomingDeck).setCrossfadeMix(1);
      this.activeDeck = incomingDeck;
    } else {
      this.engine(outgoingDeck).setSuppressEndCallback(false);
      this.engine(incomingDeck).destroy();
      this.engine(outgoingDeck).setCrossfadeMix(1);
      this.activeDeck = outgoingDeck;
    }

    this.fadeState = "idle";
    this.handledEnd = false;
    this.clearFadeSession();
  }

  play(): void {
    if (!this.controllerActive) return;
    this.getActiveEngine().play();
  }

  pause(): void {
    if (!this.controllerActive) return;
    if (this.fadeState === "fading") {
      this.engine(this.activeDeck).pause();
      this.engine(inactiveDeck(this.activeDeck)).pause();
      return;
    }
    this.getActiveEngine().pause();
  }

  seek(seconds: number): void {
    if (!this.controllerActive) return;
    this.cancelCrossfadeIfFading();
    this.getActiveEngine().seek(seconds);
  }

  seekRatio(ratio: number): void {
    if (!this.controllerActive) return;
    this.cancelCrossfadeIfFading();
    const duration = this.getDurationSeconds();
    if (!duration || !Number.isFinite(duration)) return;
    this.getActiveEngine().seek(Math.max(0, Math.min(1, ratio)) * duration);
  }

  getPositionSeconds(): number {
    if (!this.controllerActive) return 0;
    return this.getActiveEngine().getPositionSeconds();
  }

  getDurationSeconds(): number {
    if (!this.controllerActive) return 0;
    return this.getActiveEngine().getDurationSeconds();
  }

  isPlaying(): boolean {
    if (!this.controllerActive) return false;
    if (this.fadeState === "fading") {
      return (
        this.engine(this.activeDeck).isPlaying() ||
        this.engine(inactiveDeck(this.activeDeck)).isPlaying()
      );
    }
    return this.getActiveEngine().isPlaying();
  }

  setVolume(volume: number): void {
    this.userVolume = volume;
    if (!this.controllerActive) return;
    this.applyUserMixToAllActiveEngines();
  }

  setMuted(muted: boolean): void {
    this.userMuted = muted;
    if (!this.controllerActive) return;
    this.applyUserMixToAllActiveEngines();
  }

  setBalance(balance: number): void {
    this.userBalance = balance;
    if (!this.controllerActive) return;
    this.applyUserMixToAllActiveEngines();
  }

  maybeScheduleCrossfade(ctx: CrossfadeScheduleContext): void {
    if (!this.controllerActive) return;
    if (this.fadeState !== "idle") return;
    if (ctx.repeatMode === "one") return;
    if (ctx.nextTrackId === ctx.currentTrackId) return;
    if (!canHowlerCrossfade(ctx.currentSource, ctx.nextSource)) return;

    const fadeSec = effectiveFadeSeconds(
      ctx.outgoingDuration,
      ctx.crossfadeSeconds,
    );
    const remaining = ctx.outgoingDuration - ctx.positionSeconds;
    if (remaining > fadeSec) return;

    this.startCrossfadeNow(ctx);
  }

  /** Manual skip crossfade — starts immediately regardless of remaining time. */
  startCrossfadeNow(ctx: CrossfadeScheduleContext): void {
    if (!this.controllerActive) return;
    if (ctx.repeatMode === "one") return;
    if (ctx.nextTrackId === ctx.currentTrackId) return;
    if (!canHowlerCrossfade(ctx.currentSource, ctx.nextSource)) return;

    this.cancelCrossfade();

    const fadeSec = effectiveFadeSeconds(
      ctx.outgoingDuration,
      ctx.crossfadeSeconds,
    );
    const generation = ++this.scheduleGeneration;
    const outgoingDeck = this.activeDeck;
    const incomingDeck = inactiveDeck(outgoingDeck);
    const outgoingEngine = this.engine(outgoingDeck);
    const incomingEngine = this.engine(incomingDeck);

    this.pendingIncomingTrackId = ctx.nextTrackId;
    this.fadeState = "preloading";

    void (async () => {
      try {
        await incomingEngine.load(ctx.nextSource);
        if (generation !== this.scheduleGeneration) return;

        this.userVolume = ctx.volume;
        this.userMuted = ctx.muted;
        this.userBalance = ctx.balance;

        this.applyUserMixToEngine(outgoingEngine);
        this.applyUserMixToEngine(incomingEngine);
        incomingEngine.setSuppressEndCallback(true);
        outgoingEngine.setSuppressEndCallback(true);

        incomingEngine.play();
        incomingEngine.setCrossfadeMix(0);
        outgoingEngine.connectToOutputBus();
        outgoingEngine.setCrossfadeMix(1);

        this.beginCrossfadeTransition(
          ctx,
          fadeSec,
          generation,
          outgoingDeck,
          incomingDeck,
        );
      } catch (err) {
        console.error("Crossfade preload failed:", err);
        if (generation !== this.scheduleGeneration) return;
        incomingEngine.destroy();
        outgoingEngine.setSuppressEndCallback(false);
        this.fadeState = "idle";
        this.handledEnd = false;
      }
    })();
  }

  /** Fade the active deck to silence when the queue ends. */
  fadeOutAndStop(fadeSec: number, onComplete: () => void): void {
    if (!this.controllerActive) {
      onComplete();
      return;
    }

    this.cancelCrossfade();

    const outgoingDeck = this.activeDeck;
    const outgoingEngine = this.engine(outgoingDeck);
    outgoingEngine.setSuppressEndCallback(true);
    outgoingEngine.connectToOutputBus();
    outgoingEngine.setCrossfadeMix(1);

    const generation = ++this.scheduleGeneration;
    this.fadeState = "fadeOut";
    this.handledEnd = true;
    this.fadeOutgoingDeck = outgoingDeck;
    this.fadeOutCompleteCallback = onComplete;
    rampDeckGain(outgoingDeck, 0, fadeSec);

    this.fadeCompleteTimer = setTimeout(() => {
      if (generation !== this.scheduleGeneration) return;
      if (this.fadeState !== "fadeOut") return;

      outgoingEngine.setSuppressEndCallback(false);
      outgoingEngine.pause();
      this.fadeState = "idle";
      this.handledEnd = false;
      const callback = this.fadeOutCompleteCallback;
      this.fadeOutCompleteCallback = null;
      this.clearFadeSession();
      callback?.();
    }, fadeSec * 1000 + FADE_COMPLETE_BUFFER_MS);
  }

  private beginCrossfadeTransition(
    ctx: CrossfadeScheduleContext,
    fadeSec: number,
    generation: number,
    outgoingDeck: DeckId,
    incomingDeck: DeckId,
  ): void {
    this.fadeState = "fading";
    this.handledEnd = true;
    this.fadeOutgoingDeck = outgoingDeck;
    this.fadeIncomingDeck = incomingDeck;
    this.activeFadeContext = ctx;
    this.fadeStartedAtMs = Date.now();
    this.fadeDurationSec = fadeSec;
    this.dominantTrackPromoted = false;
    rampDeckGain(outgoingDeck, 0, fadeSec);
    rampDeckGain(incomingDeck, 1, fadeSec);

    this.dominanceTimer = setTimeout(() => {
      if (generation !== this.scheduleGeneration) return;
      if (this.fadeState !== "fading") return;
      this.promoteIncomingToActive(incomingDeck, ctx);
    }, (fadeSec / 2) * 1000);

    this.fadeCompleteTimer = setTimeout(() => {
      if (generation !== this.scheduleGeneration) return;
      this.completeHandoff(incomingDeck, ctx);
    }, fadeSec * 1000 + FADE_COMPLETE_BUFFER_MS);
  }

  private promoteIncomingToActive(
    incomingDeck: DeckId,
    ctx: CrossfadeScheduleContext,
  ): void {
    if (this.dominantTrackPromoted) return;

    this.dominantTrackPromoted = true;
    this.activeDeck = incomingDeck;
    ctx.onActiveTrackChange({
      incomingPlayable: ctx.nextPlayable,
      incomingTrackListId: ctx.nextTrackId,
    });
  }

  private completeHandoff(
    incomingDeck: DeckId,
    ctx: CrossfadeScheduleContext,
  ): void {
    const outgoingDeck = this.fadeOutgoingDeck ?? inactiveDeck(incomingDeck);
    this.clearFadeTimers();

    this.promoteIncomingToActive(incomingDeck, ctx);

    this.engine(outgoingDeck).setSuppressEndCallback(false);
    this.engine(outgoingDeck).destroy();
    this.engine(incomingDeck).setCrossfadeMix(1);
    this.engine(incomingDeck).setSuppressEndCallback(false);
    this.activeDeck = incomingDeck;
    this.fadeState = "idle";
    this.clearFadeSession();
  }

  private handleDeckEnd(engine: FilePlaybackEngine): void {
    if (!this.controllerActive) return;

    const deck: DeckId = engine === this.decks.a ? "a" : "b";

    if (this.fadeState === "fading" || this.fadeState === "fadeOut") {
      if (deck === this.fadeOutgoingDeck) {
        this.handledEnd = true;
        if (this.fadeState === "fading") {
          const ctx = this.activeFadeContext;
          const incomingDeck = this.fadeIncomingDeck;
          if (ctx && incomingDeck && !this.dominantTrackPromoted) {
            this.promoteIncomingToActive(incomingDeck, ctx);
          }
        }
      }
      return;
    }

    if (deck !== this.activeDeck) return;
    this.onEndCallback?.();
  }
}

export const crossfadeController = new CrossfadeController();
