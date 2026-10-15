import type { PlayableRef } from "../../types/playable";
import type { RepeatMode } from "../../types/track";
import { rampDeckGain, setDeckGain, type DeckId } from "./audioMixer";
import {
  canCrossfade,
  canGapless,
  effectiveFadeSeconds,
  GAPLESS_PRELOAD_HEADROOM_SECONDS,
} from "./canCrossfade";
import { CdDeckEngine } from "./cdDeckEngine";
import {
  CdPlaybackEngine,
  type CdPlaybackStreamError,
} from "./cdPlaybackEngine";
import { FilePlaybackEngine } from "./fileDeckEngine";
import type { PlaybackSource, RecoverOptions, RecoverResult } from "./types";

const FADE_COMPLETE_BUFFER_MS = 50;

/**
 * If the incoming deck never reports that it hit its scheduled start frame,
 * un-gate it rather than leaving playback stalled on a drained deck.
 */
const GAPLESS_START_FALLBACK_MS = 250;

type HandoffState =
  | "idle"
  | "preloading"
  | "fading"
  | "fadeOut"
  /** Incoming gated at full mix; wait for outgoing drain frame to splice. */
  | "gaplessPrimed";

/** Only one medium's dual decks are active at a time (file XOR CD). */
type DeckMedium = "file" | "cd";

/**
 * Deck engine surface used by the dual-deck handoff controller.
 * Implemented by both {@link FilePlaybackEngine} and {@link CdDeckEngine}.
 */
export interface DualDeckEngine {
  load(source: PlaybackSource): Promise<void>;
  play(): void | Promise<void>;
  pause(): void;
  seek(seconds: number): void;
  getPositionSeconds(): number;
  getDurationSeconds(): number;
  isPlaying(): boolean;
  setVolume(volume: number): void;
  setMuted(muted: boolean): void;
  setBalance(balance: number): void;
  setDeckId(deckId: DeckId): void;
  getDeckId(): DeckId;
  setCrossfadeMix(mix: number): void;
  connectToOutputBus(options?: { applyMix?: boolean }): AnalyserNode | null;
  /** Stop the deck and keep its audio nodes for the next track. */
  release(): void;
  destroy(): void;
  onEnd(callback: () => void): void;
  primeGaplessStart(): Promise<void>;
  scheduleStartAtFrame(frame: number): void;
  forceGaplessStart(): void;
  onDrainAt(callback: (frame: number) => void): void;
  onGaplessStarted(callback: () => void): void;
  /** True while the worklet is still playing after decoder EOS. */
  isEndOfStreamPending(): boolean;
  /** Ask the worklet to re-emit drainAt (late gapless subscribe). */
  reannounceDrain(): void;
  /** Native output: this deck's session id, for linking a gapless splice. */
  getSessionId?(): number | null;
  /**
   * Native output: have the mixer start `incoming` on the exact sample this
   * deck runs out. Absent on engines that splice by context frame instead.
   */
  armGaplessSuccessor?(incoming: DualDeckEngine): void;
  recover(options: RecoverOptions): Promise<RecoverResult>;
}

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

function mediumForSource(source: PlaybackSource): DeckMedium | null {
  if (source.kind === "file") return "file";
  if (source.kind === "cd") return "cd";
  return null;
}

function createDeckEngines(medium: DeckMedium): Record<DeckId, DualDeckEngine> {
  if (medium === "cd") {
    const deckA = new CdDeckEngine();
    const deckB = new CdDeckEngine();
    deckA.setDeckId("a");
    deckB.setDeckId("b");
    return { a: deckA, b: deckB };
  }
  const deckA = new FilePlaybackEngine();
  const deckB = new FilePlaybackEngine();
  deckA.setDeckId("a");
  deckB.setDeckId("b");
  return { a: deckA, b: deckB };
}

export class CrossfadeController {
  private decks: Record<DeckId, DualDeckEngine>;
  private medium: DeckMedium = "file";
  private activeDeck: DeckId = "a";
  private fadeState: HandoffState = "idle";
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
  private onCdErrorCallback: ((error: CdPlaybackStreamError) => void) | null =
    null;
  private controllerActive = false;
  private userVolume = 1;
  private userMuted = false;
  private userBalance = 0;
  /** True while a dual-deck fade is frozen by pause (timers cleared, gains held). */
  private fadePaused = false;

  constructor(
    decks: Record<DeckId, DualDeckEngine> = createDeckEngines("file"),
    medium: DeckMedium = "file",
  ) {
    this.decks = decks;
    this.medium = medium;
    this.wireDeckCallbacks();
  }

  private wireDeckCallbacks(): void {
    for (const engine of Object.values(this.decks)) {
      engine.onEnd(() => {
        this.handleDeckEnd(engine);
      });
      if (
        engine instanceof CdDeckEngine ||
        engine instanceof CdPlaybackEngine
      ) {
        engine.onError((error) => {
          this.onCdErrorCallback?.(error);
        });
      }
    }
  }

  /**
   * Tear down current decks and create a pair for `medium`.
   * Enforces the capacity policy: only one medium's dual sessions are live.
   */
  private ensureMedium(medium: DeckMedium): void {
    if (this.medium === medium) return;
    this.cancelCrossfade();
    this.decks.a.destroy();
    this.decks.b.destroy();
    this.decks = createDeckEngines(medium);
    this.medium = medium;
    this.activeDeck = "a";
    this.wireDeckCallbacks();
  }

  isControllerActive(): boolean {
    return this.controllerActive;
  }

  isCrossfadeInProgress(): boolean {
    return this.fadeState !== "idle";
  }

  /** Target track of an in-flight handoff (preload, fade, or gapless wait), if any. */
  getCrossfadeIncomingTrackId(): number | null {
    if (
      this.fadeState !== "preloading" &&
      this.fadeState !== "fading" &&
      this.fadeState !== "gaplessPrimed"
    ) {
      return null;
    }
    return this.activeFadeContext?.nextTrackId ?? this.pendingIncomingTrackId;
  }

  getCrossfadeVisualState(): CrossfadeVisualState | null {
    if (this.fadeState !== "fading" || !this.activeFadeContext) return null;
    if (this.fadeStartedAtMs === null || this.fadeDurationSec <= 0) return null;

    const progress = this.getFadeProgress();

    return {
      outgoingTrackId: this.activeFadeContext.currentTrackId,
      incomingTrackId: this.activeFadeContext.nextTrackId,
      progress,
    };
  }

  /** Linear 0–1 fade progress; frozen while pause holds the transition. */
  private getFadeProgress(): number {
    if (this.fadeStartedAtMs === null || this.fadeDurationSec <= 0) return 0;
    const elapsedSec = (Date.now() - this.fadeStartedAtMs) / 1000;
    return Math.min(1, Math.max(0, elapsedSec / this.fadeDurationSec));
  }

  consumeHandledEnd(): boolean {
    if (!this.handledEnd) return false;
    this.handledEnd = false;
    return true;
  }

  onEnd(callback: () => void): void {
    this.onEndCallback = callback;
  }

  onCdError(callback: ((error: CdPlaybackStreamError) => void) | null): void {
    this.onCdErrorCallback = callback;
  }

  getActiveEngine(): DualDeckEngine {
    return this.decks[this.activeDeck];
  }

  private engine(deckId: DeckId): DualDeckEngine {
    return this.decks[deckId];
  }

  private applyUserMixToAllActiveEngines(): void {
    this.applyUserMixToEngine(this.engine(this.activeDeck));
    if (this.fadeState === "fading" || this.fadeState === "gaplessPrimed") {
      this.applyUserMixToEngine(this.engine(inactiveDeck(this.activeDeck)));
    }
  }

  private applyUserMixToEngine(engine: DualDeckEngine): void {
    engine.setVolume(this.userVolume);
    engine.setMuted(this.userMuted);
    engine.setBalance(this.userBalance);
  }

  async loadAndPlay(
    source: PlaybackSource,
    options: { volume: number; muted: boolean; balance: number },
  ): Promise<void> {
    const medium = mediumForSource(source);
    if (!medium) {
      throw new Error(
        `CrossfadeController cannot load source kind: ${source.kind}`,
      );
    }
    this.ensureMedium(medium);
    this.cancelCrossfade();
    this.userVolume = options.volume;
    this.userMuted = options.muted;
    this.userBalance = options.balance;

    const engine = this.getActiveEngine();
    await engine.load(source);
    this.applyUserMixToEngine(engine);
    engine.setCrossfadeMix(1);
    await engine.play();
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
    this.fadePaused = false;
  }

  private cancelCrossfadeOnSeek(): void {
    if (this.fadeState === "idle") return;

    // Outgoing may have already hit EOS (session dead). Promote incoming before
    // cancel so we do not keep a dead deck and destroy the live one.
    if (
      (this.fadeState === "fading" || this.fadeState === "gaplessPrimed") &&
      !this.dominantTrackPromoted &&
      this.fadeOutgoingDeck !== null &&
      this.fadeIncomingDeck !== null &&
      this.activeFadeContext &&
      !this.engine(this.fadeOutgoingDeck).isPlaying()
    ) {
      this.promoteIncomingToActive(
        this.fadeIncomingDeck,
        this.activeFadeContext,
      );
    }

    this.cancelCrossfade();
  }

  cancelCrossfade(): void {
    this.scheduleGeneration += 1;
    this.clearFadeTimers();

    if (this.fadeState === "idle") return;

    if (this.fadeState === "fadeOut") {
      const outgoingDeck = this.fadeOutgoingDeck ?? this.activeDeck;
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
      this.engine(outgoingDeck).release();
      this.engine(incomingDeck).setCrossfadeMix(1);
      this.activeDeck = incomingDeck;
    } else {
      this.engine(incomingDeck).release();
      this.engine(outgoingDeck).setCrossfadeMix(1);
      this.activeDeck = outgoingDeck;
    }

    this.fadeState = "idle";
    this.handledEnd = false;
    this.clearFadeSession();
  }

  play(): void {
    if (!this.controllerActive) return;
    if (this.fadePaused && this.fadeState === "fading") {
      void this.resumeFrozenFade();
      return;
    }
    void this.getActiveEngine().play();
  }

  pause(): void {
    if (!this.controllerActive) return;

    if (this.fadeState === "preloading" || this.fadeState === "gaplessPrimed") {
      // Drop the incomplete / waiting handoff so resume is a clean single-deck pause.
      this.cancelCrossfade();
      this.getActiveEngine().pause();
      return;
    }

    if (this.fadeState === "fading") {
      this.freezeFade();
      return;
    }

    if (this.fadeState === "fadeOut") {
      this.settleFadeOutOnPause();
      return;
    }

    this.getActiveEngine().pause();
  }

  /**
   * Hold both decks and gain ramps in place. Timers are cleared so handoff
   * cannot fire while the UI is paused; resumeFrozenFade continues the rest.
   */
  private freezeFade(): void {
    if (this.fadeState !== "fading" || this.fadePaused) return;
    if (this.fadeOutgoingDeck === null || this.fadeIncomingDeck === null)
      return;

    const progress = this.getFadeProgress();
    this.fadePaused = true;
    this.clearFadeTimers();

    // Snap mixes to the wall-clock progress (AudioParam.value is unreliable
    // mid-automation) and stop both decode sessions.
    setDeckGain(this.fadeOutgoingDeck, 1 - progress);
    setDeckGain(this.fadeIncomingDeck, progress);
    this.engine(this.fadeOutgoingDeck).setCrossfadeMix(1 - progress);
    this.engine(this.fadeIncomingDeck).setCrossfadeMix(progress);

    this.engine(this.fadeOutgoingDeck).pause();
    this.engine(this.fadeIncomingDeck).pause();

    // Keep fadeStartedAtMs consistent with frozen progress for visuals / resume.
    if (this.fadeDurationSec > 0) {
      this.fadeStartedAtMs =
        Date.now() - progress * this.fadeDurationSec * 1000;
    }
  }

  private async resumeFrozenFade(): Promise<void> {
    if (!this.fadePaused || this.fadeState !== "fading") return;
    if (
      this.fadeOutgoingDeck === null ||
      this.fadeIncomingDeck === null ||
      !this.activeFadeContext
    ) {
      this.fadePaused = false;
      return;
    }

    const progress = this.getFadeProgress();
    const remainingSec = Math.max(0.05, this.fadeDurationSec * (1 - progress));
    const generation = this.scheduleGeneration;
    const outgoingDeck = this.fadeOutgoingDeck;
    const incomingDeck = this.fadeIncomingDeck;
    const ctx = this.activeFadeContext;

    this.fadePaused = false;
    this.fadeStartedAtMs = Date.now() - progress * this.fadeDurationSec * 1000;

    await this.engine(outgoingDeck).play();
    await this.engine(incomingDeck).play();
    if (generation !== this.scheduleGeneration || this.fadePaused) return;

    rampDeckGain(outgoingDeck, 0, remainingSec);
    rampDeckGain(incomingDeck, 1, remainingSec);

    if (!this.dominantTrackPromoted) {
      const remainingToDominance =
        this.fadeDurationSec / 2 - progress * this.fadeDurationSec;
      if (remainingToDominance <= 0) {
        this.promoteIncomingToActive(incomingDeck, ctx);
      } else {
        this.dominanceTimer = setTimeout(() => {
          if (generation !== this.scheduleGeneration) return;
          if (this.fadeState !== "fading" || this.fadePaused) return;
          this.promoteIncomingToActive(incomingDeck, ctx);
        }, remainingToDominance * 1000);
      }
    }

    this.fadeCompleteTimer = setTimeout(
      () => {
        if (generation !== this.scheduleGeneration) return;
        if (this.fadePaused) return;
        this.completeHandoff(incomingDeck, ctx);
      },
      remainingSec * 1000 + FADE_COMPLETE_BUFFER_MS,
    );
  }

  /** Queue-end fade: jump to silence and finish rather than resume mid-fade-out. */
  private settleFadeOutOnPause(): void {
    this.clearFadeTimers();
    const outgoingDeck = this.fadeOutgoingDeck ?? this.activeDeck;
    const outgoingEngine = this.engine(outgoingDeck);
    outgoingEngine.pause();
    setDeckGain(outgoingDeck, 0);
    outgoingEngine.setCrossfadeMix(0);
    this.fadeState = "idle";
    this.handledEnd = false;
    const callback = this.fadeOutCompleteCallback;
    this.fadeOutCompleteCallback = null;
    this.clearFadeSession();
    callback?.();
  }

  isPlaying(): boolean {
    if (!this.controllerActive) return false;
    if (this.fadePaused) return false;
    if (this.fadeState === "fading") {
      return (
        this.engine(this.activeDeck).isPlaying() ||
        this.engine(inactiveDeck(this.activeDeck)).isPlaying()
      );
    }
    return this.getActiveEngine().isPlaying();
  }

  seek(seconds: number): void {
    if (!this.controllerActive) return;
    this.cancelCrossfadeOnSeek();
    this.getActiveEngine().seek(seconds);
  }

  seekRatio(ratio: number): void {
    if (!this.controllerActive) return;
    this.cancelCrossfadeOnSeek();
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
    if (!canCrossfade(ctx.currentSource, ctx.nextSource)) return;

    const fadeSec = effectiveFadeSeconds(
      ctx.outgoingDuration,
      ctx.crossfadeSeconds,
    );
    const remaining = ctx.outgoingDuration - ctx.positionSeconds;
    if (remaining > fadeSec) return;

    this.startCrossfadeNow(ctx);
  }

  /**
   * Near EOS with crossfade off: preload the next file into a gated worklet and
   * splice on the outgoing deck's drain frame (no timed fade, no gain step).
   */
  maybeScheduleGapless(ctx: CrossfadeScheduleContext): void {
    if (!this.controllerActive) return;
    if (this.fadeState !== "idle") return;
    if (ctx.repeatMode === "one") return;
    if (ctx.nextTrackId === ctx.currentTrackId) return;
    if (!canGapless(ctx.currentSource, ctx.nextSource)) return;

    const remaining = ctx.outgoingDuration - ctx.positionSeconds;
    if (remaining > GAPLESS_PRELOAD_HEADROOM_SECONDS) return;

    this.startGaplessPreload(ctx);
  }

  /** Manual skip crossfade — starts immediately regardless of remaining time. */
  startCrossfadeNow(ctx: CrossfadeScheduleContext): void {
    if (!this.controllerActive) return;
    if (ctx.repeatMode === "one") return;
    if (ctx.nextTrackId === ctx.currentTrackId) return;
    if (!canCrossfade(ctx.currentSource, ctx.nextSource)) return;

    this.cancelCrossfade();

    const fadeSec = effectiveFadeSeconds(
      ctx.outgoingDuration,
      ctx.crossfadeSeconds,
    );
    this.beginDualDeckPreload(ctx, { mode: "crossfade", fadeSec });
  }

  private startGaplessPreload(ctx: CrossfadeScheduleContext): void {
    this.cancelCrossfade();
    this.beginDualDeckPreload(ctx, { mode: "gapless" });
  }

  private beginDualDeckPreload(
    ctx: CrossfadeScheduleContext,
    options: { mode: "crossfade"; fadeSec: number } | { mode: "gapless" },
  ): void {
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

        // Wire both decks and set starting mixes BEFORE play/ramps.
        // Ramping a missing deck gain no-ops; setCrossfadeMix after a ramp
        // cancels scheduled AudioParam values.
        //
        // Gapless rides at full mix the whole time — the incoming deck is silent
        // because its worklet is gated, so the splice needs no gain change and
        // therefore introduces no step discontinuity.
        incomingEngine.setCrossfadeMix(options.mode === "gapless" ? 1 : 0);
        incomingEngine.connectToOutputBus({ applyMix: true });
        outgoingEngine.setCrossfadeMix(1);
        outgoingEngine.connectToOutputBus({ applyMix: true });

        if (options.mode === "gapless") {
          await incomingEngine.primeGaplessStart();
          if (generation !== this.scheduleGeneration) return;
          this.beginGaplessWait(ctx, generation, outgoingDeck, incomingDeck);
          return;
        }

        await incomingEngine.play();
        if (generation !== this.scheduleGeneration) return;

        this.beginCrossfadeTransition(
          ctx,
          options.fadeSec,
          generation,
          outgoingDeck,
          incomingDeck,
        );
      } catch (err) {
        console.error(
          options.mode === "gapless"
            ? "Gapless preload failed:"
            : "Crossfade preload failed:",
          err,
        );
        if (generation !== this.scheduleGeneration) return;
        incomingEngine.release();
        this.fadeState = "idle";
        this.handledEnd = false;
        this.pendingIncomingTrackId = null;
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
    outgoingEngine.connectToOutputBus();
    outgoingEngine.setCrossfadeMix(1);

    const generation = ++this.scheduleGeneration;
    this.fadeState = "fadeOut";
    this.handledEnd = true;
    this.fadeOutgoingDeck = outgoingDeck;
    this.fadeOutCompleteCallback = onComplete;
    rampDeckGain(outgoingDeck, 0, fadeSec);

    this.fadeCompleteTimer = setTimeout(
      () => {
        if (generation !== this.scheduleGeneration) return;
        if (this.fadeState !== "fadeOut") return;

        outgoingEngine.pause();
        this.fadeState = "idle";
        this.handledEnd = false;
        const callback = this.fadeOutCompleteCallback;
        this.fadeOutCompleteCallback = null;
        this.clearFadeSession();
        callback?.();
      },
      fadeSec * 1000 + FADE_COMPLETE_BUFFER_MS,
    );
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

    this.dominanceTimer = setTimeout(
      () => {
        if (generation !== this.scheduleGeneration) return;
        if (this.fadeState !== "fading") return;
        this.promoteIncomingToActive(incomingDeck, ctx);
      },
      (fadeSec / 2) * 1000,
    );

    this.fadeCompleteTimer = setTimeout(
      () => {
        if (generation !== this.scheduleGeneration) return;
        this.completeHandoff(incomingDeck, ctx);
      },
      fadeSec * 1000 + FADE_COMPLETE_BUFFER_MS,
    );
  }

  /**
   * Both decks share one AudioContext, so they share `currentFrame`. The
   * outgoing worklet reports the exact frame its tail runs out and the incoming
   * worklet starts on that frame — no silence and no gain step at the join.
   */
  private beginGaplessWait(
    ctx: CrossfadeScheduleContext,
    generation: number,
    outgoingDeck: DeckId,
    incomingDeck: DeckId,
  ): void {
    this.fadeState = "gaplessPrimed";
    this.handledEnd = false;
    this.fadeOutgoingDeck = outgoingDeck;
    this.fadeIncomingDeck = incomingDeck;
    this.activeFadeContext = ctx;
    this.dominantTrackPromoted = false;

    this.engine(outgoingDeck).armGaplessSuccessor?.(this.engine(incomingDeck));

    this.engine(outgoingDeck).onDrainAt((frame) => {
      if (generation !== this.scheduleGeneration) return;
      if (this.fadeState !== "gaplessPrimed") return;
      this.engine(incomingDeck).scheduleStartAtFrame(frame);
    });

    this.engine(incomingDeck).onGaplessStarted(() => {
      if (generation !== this.scheduleGeneration) return;
      if (this.fadeState !== "gaplessPrimed") return;
      this.completeGaplessHandoff();
    });

    // Decoder may already be past EOS (deep read-ahead); re-emit drainAt so we
    // do not wait for the 250ms force-start fallback.
    if (this.engine(outgoingDeck).isEndOfStreamPending()) {
      this.engine(outgoingDeck).reannounceDrain();
    }
  }

  private completeGaplessHandoff(): void {
    // Reachable from the incoming deck's start signal and from the fallback
    // timer; whichever lands first owns the swap.
    if (this.fadeState !== "gaplessPrimed") return;

    const ctx = this.activeFadeContext;
    const incomingDeck = this.fadeIncomingDeck;
    const outgoingDeck = this.fadeOutgoingDeck;
    this.clearFadeTimers();

    if (!ctx || incomingDeck === null || outgoingDeck === null) {
      this.fadeState = "idle";
      this.clearFadeSession();
      this.handledEnd = false;
      this.onEndCallback?.();
      return;
    }

    // No gain changes here: the incoming deck already sits at full mix and
    // started itself on the scheduled frame; the outgoing deck is drained.
    this.promoteIncomingToActive(incomingDeck, ctx);
    this.engine(outgoingDeck).release();
    this.activeDeck = incomingDeck;
    this.fadeState = "idle";
    this.clearFadeSession();
    // Outgoing end was handled here (no onEndCallback); do not leave a stale
    // handledEnd that would swallow the next track's natural end.
    this.handledEnd = false;
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

    this.engine(outgoingDeck).release();
    this.engine(incomingDeck).setCrossfadeMix(1);
    this.activeDeck = incomingDeck;
    this.fadeState = "idle";
    this.clearFadeSession();
    // Fade owned the outgoing end; clear so the next natural end can advance.
    this.handledEnd = false;
  }

  private handleDeckEnd(engine: DualDeckEngine): void {
    if (!this.controllerActive) return;

    const deck: DeckId = engine === this.decks.a ? "a" : "b";

    if (this.fadeState === "gaplessPrimed") {
      if (deck !== this.fadeOutgoingDeck) return;
      // The outgoing tail has finished; the incoming deck should already have
      // spliced in on the scheduled frame. Suppress the store advance and only
      // force the swap if that signal never arrived.
      this.handledEnd = true;
      const generation = this.scheduleGeneration;
      const incomingDeck = this.fadeIncomingDeck;
      this.clearFadeTimers();
      this.fadeCompleteTimer = setTimeout(() => {
        if (generation !== this.scheduleGeneration) return;
        if (this.fadeState !== "gaplessPrimed") return;
        if (incomingDeck !== null) {
          this.engine(incomingDeck).forceGaplessStart();
        }
        this.completeGaplessHandoff();
      }, GAPLESS_START_FALLBACK_MS);
      return;
    }

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
