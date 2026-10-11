import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { effectiveFadeSeconds } from "./canCrossfade";
import {
  CrossfadeController,
  type DualDeckEngine,
} from "./crossfadeController";
import type { DeckId } from "./audioMixer";
import type { PlaybackSource } from "./types";

vi.mock("./audioMixer", () => ({
  rampDeckGain: vi.fn(),
  setDeckGain: vi.fn(),
  getDeckGainNode: vi.fn(() => null),
}));

// Mock eligibility so this suite exercises dual-deck crossfade controller logic.
vi.mock("./canCrossfade", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./canCrossfade")>();
  return {
    ...actual,
    canCrossfade: vi.fn(() => true),
    canGapless: vi.fn(() => true),
  };
});

describe("effectiveFadeSeconds", () => {
  it("caps fade at half the outgoing track duration", () => {
    expect(effectiveFadeSeconds(8, 12)).toBe(4);
  });

  it("uses full crossfade window for long tracks", () => {
    expect(effectiveFadeSeconds(300, 7)).toBe(7);
  });
});

function createMockEngine(deckId: DeckId) {
  const listeners: Array<() => void> = [];
  let drainAtCallback: ((frame: number) => void) | null = null;
  let startedCallback: (() => void) | null = null;
  return {
    deckId,
    setDeckId: vi.fn(),
    getDeckId: () => deckId,
    load: vi.fn(async () => {}),
    play: vi.fn(async () => {}),
    pause: vi.fn(),
    seek: vi.fn(),
    getPositionSeconds: vi.fn(() => 0),
    getDurationSeconds: vi.fn(() => 180),
    isPlaying: vi.fn(() => true),
    setVolume: vi.fn(),
    setMuted: vi.fn(),
    setBalance: vi.fn(),
    setCrossfadeMix: vi.fn(),
    connectToOutputBus: vi.fn(() => null),
    release: vi.fn(),
    destroy: vi.fn(),
    primeGaplessStart: vi.fn(async () => {}),
    scheduleStartAtFrame: vi.fn(),
    forceGaplessStart: vi.fn(),
    onDrainAt: vi.fn((callback: (frame: number) => void) => {
      drainAtCallback = callback;
    }),
    onGaplessStarted: vi.fn((callback: () => void) => {
      startedCallback = callback;
    }),
    isEndOfStreamPending: vi.fn(() => false),
    reannounceDrain: vi.fn(),
    onEnd: vi.fn((callback: () => void) => {
      listeners.push(callback);
    }),
    recover: vi.fn(async () => ({ restarted: false, reloaded: false })),
    emitEnd: () => {
      for (const listener of listeners) listener();
    },
    emitDrainAt: (frame: number) => {
      drainAtCallback?.(frame);
    },
    emitStarted: () => {
      startedCallback?.();
    },
  } satisfies Partial<DualDeckEngine> & {
    deckId: DeckId;
    emitEnd: () => void;
    emitDrainAt: (frame: number) => void;
    emitStarted: () => void;
  };
}

function asDecks(
  a: ReturnType<typeof createMockEngine>,
  b: ReturnType<typeof createMockEngine>,
): Record<DeckId, DualDeckEngine> {
  return {
    a: a as unknown as DualDeckEngine,
    b: b as unknown as DualDeckEngine,
  };
}

function crossfadeScheduleArgs(
  overrides: Partial<
    Parameters<CrossfadeController["maybeScheduleCrossfade"]>[0]
  > = {},
) {
  return {
    crossfadeSeconds: 7,
    currentPlayable: { type: "library" as const, trackId: 1 },
    currentTrackId: 1,
    currentSource: { kind: "file" as const, path: "/a.wav" },
    nextPlayable: { type: "library" as const, trackId: 2 },
    nextSource: { kind: "file" as const, path: "/b.flac" },
    nextTrackId: 2,
    repeatMode: "off" as const,
    volume: 1,
    muted: false,
    balance: 0,
    outgoingDuration: 180,
    positionSeconds: 174,
    onActiveTrackChange: vi.fn(),
    ...overrides,
  };
}

describe("CrossfadeController", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("consumes handled end so onEnd does not double-advance", async () => {
    const deckA = createMockEngine("a");
    const deckB = createMockEngine("b");
    const controller = new CrossfadeController(asDecks(deckA, deckB));

    const onEnd = vi.fn();
    controller.onEnd(onEnd);

    await controller.loadAndPlay(
      { kind: "file", path: "/a.wav" },
      {
        volume: 1,
        muted: false,
        balance: 0,
      },
    );

    const currentSource: PlaybackSource = { kind: "file", path: "/a.wav" };
    const nextSource: PlaybackSource = { kind: "file", path: "/b.flac" };

    controller.maybeScheduleCrossfade(
      crossfadeScheduleArgs({
        currentSource,
        nextSource,
      }),
    );

    await vi.waitFor(() => {
      expect(deckB.load).toHaveBeenCalledWith(nextSource);
      expect(deckB.play).toHaveBeenCalled();
      expect(controller.isCrossfadeInProgress()).toBe(true);
    });

    deckA.emitEnd();
    expect(controller.consumeHandledEnd()).toBe(true);
    expect(onEnd).not.toHaveBeenCalled();
  });

  it("promotes incoming track at half the fade duration", async () => {
    const deckA = createMockEngine("a");
    const deckB = createMockEngine("b");
    const controller = new CrossfadeController(asDecks(deckA, deckB));

    const onActiveTrackChange = vi.fn();

    await controller.loadAndPlay(
      { kind: "file", path: "/a.wav" },
      {
        volume: 1,
        muted: false,
        balance: 0,
      },
    );

    controller.maybeScheduleCrossfade(
      crossfadeScheduleArgs({ onActiveTrackChange }),
    );

    await vi.waitFor(() => {
      expect(deckB.play).toHaveBeenCalled();
    });

    await vi.advanceTimersByTimeAsync(3500);

    expect(onActiveTrackChange).toHaveBeenCalledWith({
      incomingPlayable: { type: "library", trackId: 2 },
      incomingTrackListId: 2,
    });
    expect(controller.getActiveEngine()).toBe(deckB);

    await vi.advanceTimersByTimeAsync(3550);

    expect(deckA.release).toHaveBeenCalled();
    expect(onActiveTrackChange).toHaveBeenCalledTimes(1);
  });

  it("reports crossfade visual state with linear progress during fade", async () => {
    const deckA = createMockEngine("a");
    const deckB = createMockEngine("b");
    const controller = new CrossfadeController(asDecks(deckA, deckB));

    await controller.loadAndPlay(
      { kind: "file", path: "/a.wav" },
      {
        volume: 1,
        muted: false,
        balance: 0,
      },
    );

    expect(controller.getCrossfadeVisualState()).toBeNull();

    controller.maybeScheduleCrossfade(crossfadeScheduleArgs());

    await vi.waitFor(() => {
      expect(deckB.play).toHaveBeenCalled();
    });

    const midFade = controller.getCrossfadeVisualState();
    expect(midFade).toEqual({
      outgoingTrackId: 1,
      incomingTrackId: 2,
      progress: expect.any(Number),
    });
    expect(midFade!.progress).toBeGreaterThanOrEqual(0);
    expect(midFade!.progress).toBeLessThan(1);

    await vi.advanceTimersByTimeAsync(7050);

    expect(controller.getCrossfadeVisualState()).toBeNull();
  });

  it("completes handoff after fade duration", async () => {
    const deckA = createMockEngine("a");
    const deckB = createMockEngine("b");
    const controller = new CrossfadeController(asDecks(deckA, deckB));

    await controller.loadAndPlay(
      { kind: "file", path: "/a.wav" },
      {
        volume: 1,
        muted: false,
        balance: 0,
      },
    );

    controller.maybeScheduleCrossfade(crossfadeScheduleArgs());

    await vi.waitFor(() => {
      expect(deckB.play).toHaveBeenCalled();
    });

    await vi.advanceTimersByTimeAsync(7050);

    expect(deckA.release).toHaveBeenCalled();
    expect(controller.getActiveEngine()).toBe(deckB);
  });

  it("cancels preload when seeking before fade starts", async () => {
    const deckA = createMockEngine("a");
    const deckB = createMockEngine("b");
    let resolveLoad!: () => void;
    deckB.load.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveLoad = resolve;
        }),
    );
    const controller = new CrossfadeController(asDecks(deckA, deckB));

    await controller.loadAndPlay(
      { kind: "file", path: "/a.wav" },
      {
        volume: 1,
        muted: false,
        balance: 0,
      },
    );

    controller.maybeScheduleCrossfade(crossfadeScheduleArgs());
    expect(controller.isCrossfadeInProgress()).toBe(true);

    controller.seekRatio(0.25);

    expect(deckB.release).toHaveBeenCalled();
    expect(deckA.seek).toHaveBeenCalledWith(45);
    expect(controller.getActiveEngine()).toBe(deckA);
    expect(controller.isCrossfadeInProgress()).toBe(false);

    resolveLoad();
    await Promise.resolve();
  });

  it("keeps incoming when seeking after outgoing ends mid-fade", async () => {
    const deckA = createMockEngine("a");
    const deckB = createMockEngine("b");
    deckB.getDurationSeconds = vi.fn(() => 200);
    const controller = new CrossfadeController(asDecks(deckA, deckB));

    await controller.loadAndPlay(
      { kind: "file", path: "/a.wav" },
      {
        volume: 1,
        muted: false,
        balance: 0,
      },
    );

    controller.maybeScheduleCrossfade(crossfadeScheduleArgs());

    await vi.waitFor(() => {
      expect(deckB.play).toHaveBeenCalled();
    });

    deckA.isPlaying = vi.fn(() => false);
    deckA.emitEnd();

    controller.seekRatio(0.1);

    expect(deckA.release).toHaveBeenCalled();
    expect(deckB.seek).toHaveBeenCalledWith(20);
    expect(controller.getActiveEngine()).toBe(deckB);
    expect(controller.isCrossfadeInProgress()).toBe(false);
  });

  it("cancels crossfade and seeks the outgoing deck before dominance", async () => {
    const deckA = createMockEngine("a");
    const deckB = createMockEngine("b");
    const controller = new CrossfadeController(asDecks(deckA, deckB));

    await controller.loadAndPlay(
      { kind: "file", path: "/a.wav" },
      {
        volume: 1,
        muted: false,
        balance: 0,
      },
    );

    controller.maybeScheduleCrossfade(crossfadeScheduleArgs());

    await vi.waitFor(() => {
      expect(deckB.play).toHaveBeenCalled();
    });

    controller.seekRatio(0.5);

    expect(deckB.release).toHaveBeenCalled();
    expect(deckA.seek).toHaveBeenCalledWith(90);
    expect(controller.getActiveEngine()).toBe(deckA);
    expect(controller.isCrossfadeInProgress()).toBe(false);
  });

  it("cancels crossfade and seeks the incoming deck after dominance", async () => {
    const deckA = createMockEngine("a");
    const deckB = createMockEngine("b");
    deckB.getDurationSeconds = vi.fn(() => 200);
    const controller = new CrossfadeController(asDecks(deckA, deckB));

    await controller.loadAndPlay(
      { kind: "file", path: "/a.wav" },
      {
        volume: 1,
        muted: false,
        balance: 0,
      },
    );

    controller.maybeScheduleCrossfade(crossfadeScheduleArgs());

    await vi.waitFor(() => {
      expect(deckB.play).toHaveBeenCalled();
    });

    await vi.advanceTimersByTimeAsync(3500);
    controller.seekRatio(0.25);

    expect(deckA.release).toHaveBeenCalled();
    expect(deckB.seek).toHaveBeenCalledWith(50);
    expect(controller.getActiveEngine()).toBe(deckB);
    expect(controller.isCrossfadeInProgress()).toBe(false);
  });

  it("does not schedule crossfade for repeat-one", async () => {
    const deckA = createMockEngine("a");
    const deckB = createMockEngine("b");
    const controller = new CrossfadeController(asDecks(deckA, deckB));

    await controller.loadAndPlay(
      { kind: "file", path: "/a.wav" },
      {
        volume: 1,
        muted: false,
        balance: 0,
      },
    );

    controller.maybeScheduleCrossfade(
      crossfadeScheduleArgs({
        nextPlayable: { type: "library", trackId: 1 },
        nextSource: { kind: "file", path: "/a.wav" },
        nextTrackId: 1,
        repeatMode: "one",
      }),
    );

    expect(deckB.load).not.toHaveBeenCalled();
  });

  it("loadAndPlay keeps controller active after hard cut reload", async () => {
    const deckA = createMockEngine("a");
    const deckB = createMockEngine("b");
    const controller = new CrossfadeController(asDecks(deckA, deckB));

    await controller.loadAndPlay(
      { kind: "file", path: "/a.wav" },
      {
        volume: 1,
        muted: false,
        balance: 0,
      },
    );

    controller.maybeScheduleCrossfade(
      crossfadeScheduleArgs({
        positionSeconds: 174,
        onActiveTrackChange: vi.fn(),
      }),
    );

    await vi.waitFor(() => {
      expect(deckB.play).toHaveBeenCalled();
    });

    await vi.advanceTimersByTimeAsync(7050);

    await controller.loadAndPlay(
      { kind: "file", path: "/a.wav" },
      {
        volume: 1,
        muted: false,
        balance: 0,
      },
    );

    expect(controller.isControllerActive()).toBe(true);
    expect(controller.isCrossfadeInProgress()).toBe(false);

    deckA.load.mockClear();
    controller.maybeScheduleCrossfade(
      crossfadeScheduleArgs({
        positionSeconds: 174,
        onActiveTrackChange: vi.fn(),
      }),
    );

    await vi.waitFor(() => {
      expect(deckA.load).toHaveBeenCalled();
    });
  });

  it("startCrossfadeNow begins crossfade regardless of remaining time", async () => {
    const deckA = createMockEngine("a");
    const deckB = createMockEngine("b");
    const controller = new CrossfadeController(asDecks(deckA, deckB));

    await controller.loadAndPlay(
      { kind: "file", path: "/a.wav" },
      {
        volume: 1,
        muted: false,
        balance: 0,
      },
    );

    controller.startCrossfadeNow(
      crossfadeScheduleArgs({
        positionSeconds: 10,
        outgoingDuration: 180,
      }),
    );

    await vi.waitFor(() => {
      expect(deckB.load).toHaveBeenCalled();
      expect(deckB.play).toHaveBeenCalled();
    });
  });

  it("connects decks and sets mixes before scheduling gain ramps", async () => {
    const { rampDeckGain } = await import("./audioMixer");
    const deckA = createMockEngine("a");
    const deckB = createMockEngine("b");
    const controller = new CrossfadeController(asDecks(deckA, deckB));

    await controller.loadAndPlay(
      { kind: "file", path: "/a.wav" },
      { volume: 1, muted: false, balance: 0 },
    );

    vi.mocked(rampDeckGain).mockClear();
    deckB.connectToOutputBus.mockClear();
    deckB.setCrossfadeMix.mockClear();
    deckA.connectToOutputBus.mockClear();
    deckA.setCrossfadeMix.mockClear();

    controller.startCrossfadeNow(
      crossfadeScheduleArgs({
        positionSeconds: 10,
        outgoingDuration: 180,
      }),
    );

    await vi.waitFor(() => {
      expect(rampDeckGain).toHaveBeenCalled();
    });

    const firstRampOrder = vi.mocked(rampDeckGain).mock.invocationCallOrder[0]!;
    expect(deckB.setCrossfadeMix.mock.invocationCallOrder[0]).toBeLessThan(
      firstRampOrder,
    );
    expect(deckB.connectToOutputBus.mock.invocationCallOrder[0]).toBeLessThan(
      firstRampOrder,
    );
    expect(deckB.play.mock.invocationCallOrder[0]).toBeLessThan(firstRampOrder);
    expect(deckB.setCrossfadeMix).toHaveBeenCalledWith(0);
    expect(deckA.setCrossfadeMix).toHaveBeenCalledWith(1);
  });

  it("chains rapid skip crossfades using the in-flight incoming track", async () => {
    const deckA = createMockEngine("a");
    const deckB = createMockEngine("b");
    const controller = new CrossfadeController(asDecks(deckA, deckB));

    await controller.loadAndPlay(
      { kind: "file", path: "/a.wav" },
      {
        volume: 1,
        muted: false,
        balance: 0,
      },
    );

    controller.startCrossfadeNow(crossfadeScheduleArgs());

    await vi.waitFor(() => {
      expect(deckB.play).toHaveBeenCalled();
    });
    expect(controller.getCrossfadeIncomingTrackId()).toBe(2);

    deckB.load.mockClear();
    deckB.play.mockClear();

    const track3Source: PlaybackSource = { kind: "file", path: "/c.flac" };
    controller.startCrossfadeNow(
      crossfadeScheduleArgs({
        nextTrackId: 3,
        nextSource: track3Source,
        nextPlayable: { type: "library", trackId: 3 },
      }),
    );

    await vi.waitFor(() => {
      expect(deckB.load).toHaveBeenCalledWith(track3Source);
      expect(deckB.play).toHaveBeenCalled();
    });
    expect(controller.getCrossfadeIncomingTrackId()).toBe(3);

    await vi.advanceTimersByTimeAsync(7050);
    expect(controller.getCrossfadeIncomingTrackId()).toBeNull();
    expect(controller.getActiveEngine()).toBe(deckB);
  });

  it("fadeOutAndStop pauses and invokes callback after fade duration", async () => {
    const deckA = createMockEngine("a");
    const deckB = createMockEngine("b");
    const controller = new CrossfadeController(asDecks(deckA, deckB));
    const onComplete = vi.fn();

    await controller.loadAndPlay(
      { kind: "file", path: "/a.wav" },
      {
        volume: 1,
        muted: false,
        balance: 0,
      },
    );

    controller.fadeOutAndStop(7, onComplete);

    expect(controller.isCrossfadeInProgress()).toBe(true);
    expect(onComplete).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(7050);

    expect(deckA.pause).toHaveBeenCalled();
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(controller.isCrossfadeInProgress()).toBe(false);
  });

  it("pause mid-fade freezes both decks; play resumes the remaining ramp", async () => {
    const { rampDeckGain, setDeckGain } = await import("./audioMixer");
    const deckA = createMockEngine("a");
    const deckB = createMockEngine("b");
    const controller = new CrossfadeController(asDecks(deckA, deckB));

    await controller.loadAndPlay(
      { kind: "file", path: "/a.wav" },
      { volume: 1, muted: false, balance: 0 },
    );

    controller.startCrossfadeNow(crossfadeScheduleArgs());

    await vi.waitFor(() => {
      expect(controller.isCrossfadeInProgress()).toBe(true);
      expect(deckB.play).toHaveBeenCalled();
    });

    vi.mocked(rampDeckGain).mockClear();
    vi.mocked(setDeckGain).mockClear();
    deckA.pause.mockClear();
    deckB.pause.mockClear();
    deckA.play.mockClear();
    deckB.play.mockClear();

    // Halfway through a 7s fade
    await vi.advanceTimersByTimeAsync(3500);
    controller.pause();

    expect(deckA.pause).toHaveBeenCalled();
    expect(deckB.pause).toHaveBeenCalled();
    expect(controller.isPlaying()).toBe(false);
    expect(controller.isCrossfadeInProgress()).toBe(true);
    expect(setDeckGain).toHaveBeenCalled();

    // Handoff must not complete while frozen
    await vi.advanceTimersByTimeAsync(10_000);
    expect(deckA.release).not.toHaveBeenCalled();
    expect(controller.isCrossfadeInProgress()).toBe(true);

    controller.play();

    await vi.waitFor(() => {
      expect(deckA.play).toHaveBeenCalled();
      expect(deckB.play).toHaveBeenCalled();
      expect(rampDeckGain).toHaveBeenCalled();
    });

    await vi.advanceTimersByTimeAsync(4000);
    expect(deckA.release).toHaveBeenCalled();
    expect(controller.isCrossfadeInProgress()).toBe(false);
  });

  it("pause during preload cancels incoming and leaves outgoing paused", async () => {
    const deckA = createMockEngine("a");
    const deckB = createMockEngine("b");
    let resolveLoad!: () => void;
    deckB.load.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveLoad = resolve;
        }),
    );

    const controller = new CrossfadeController(asDecks(deckA, deckB));

    await controller.loadAndPlay(
      { kind: "file", path: "/a.wav" },
      { volume: 1, muted: false, balance: 0 },
    );

    controller.startCrossfadeNow(crossfadeScheduleArgs());
    await vi.waitFor(() => {
      expect(deckB.load).toHaveBeenCalled();
    });

    controller.pause();

    expect(controller.isCrossfadeInProgress()).toBe(false);
    expect(deckA.pause).toHaveBeenCalled();
    expect(deckB.release).toHaveBeenCalled();

    resolveLoad();
    await Promise.resolve();
    expect(deckB.play).not.toHaveBeenCalled();
  });

  it("primes the incoming deck gated at full mix, with no gain ramp", async () => {
    const { rampDeckGain } = await import("./audioMixer");
    const deckA = createMockEngine("a");
    const deckB = createMockEngine("b");
    const controller = new CrossfadeController(asDecks(deckA, deckB));

    await controller.loadAndPlay(
      { kind: "file", path: "/a.wav" },
      { volume: 1, muted: false, balance: 0 },
    );

    vi.mocked(rampDeckGain).mockClear();
    deckB.play.mockClear();

    controller.maybeScheduleGapless(
      crossfadeScheduleArgs({ positionSeconds: 179, outgoingDuration: 180 }),
    );

    await vi.waitFor(() => {
      expect(deckB.primeGaplessStart).toHaveBeenCalled();
      expect(controller.isCrossfadeInProgress()).toBe(true);
    });

    // Silence comes from the worklet gate, not from deck gain, so the splice
    // needs no gain change and no timed fade.
    expect(deckB.setCrossfadeMix).toHaveBeenCalledWith(1);
    expect(deckB.setCrossfadeMix).not.toHaveBeenCalledWith(0);
    expect(deckB.play).not.toHaveBeenCalled();
    expect(rampDeckGain).not.toHaveBeenCalled();
  });

  it("schedules the incoming start on the outgoing deck's drain frame", async () => {
    const deckA = createMockEngine("a");
    const deckB = createMockEngine("b");
    const controller = new CrossfadeController(asDecks(deckA, deckB));

    await controller.loadAndPlay(
      { kind: "file", path: "/a.wav" },
      { volume: 1, muted: false, balance: 0 },
    );

    controller.maybeScheduleGapless(
      crossfadeScheduleArgs({ positionSeconds: 179, outgoingDuration: 180 }),
    );

    await vi.waitFor(() => {
      expect(deckA.onDrainAt).toHaveBeenCalled();
    });

    deckA.emitDrainAt(1_234_567);
    expect(deckB.scheduleStartAtFrame).toHaveBeenCalledWith(1_234_567);

    // A late chunk can push the drain point back; the incoming deck follows.
    deckA.emitDrainAt(1_234_999);
    expect(deckB.scheduleStartAtFrame).toHaveBeenLastCalledWith(1_234_999);
  });

  it("completes the handoff when the incoming deck reports it started", async () => {
    const { setDeckGain } = await import("./audioMixer");
    const deckA = createMockEngine("a");
    const deckB = createMockEngine("b");
    const controller = new CrossfadeController(asDecks(deckA, deckB));
    const onActiveTrackChange = vi.fn();
    const onEnd = vi.fn();
    controller.onEnd(onEnd);

    await controller.loadAndPlay(
      { kind: "file", path: "/a.wav" },
      { volume: 1, muted: false, balance: 0 },
    );

    controller.maybeScheduleGapless(
      crossfadeScheduleArgs({
        positionSeconds: 179,
        outgoingDuration: 180,
        onActiveTrackChange,
      }),
    );

    await vi.waitFor(() => {
      expect(deckB.onGaplessStarted).toHaveBeenCalled();
    });

    vi.mocked(setDeckGain).mockClear();
    deckA.emitDrainAt(1000);
    deckB.emitStarted();

    expect(setDeckGain).not.toHaveBeenCalled();
    expect(deckA.release).toHaveBeenCalled();
    expect(controller.getActiveEngine()).toBe(deckB);
    expect(onActiveTrackChange).toHaveBeenCalledWith({
      incomingPlayable: { type: "library", trackId: 2 },
      incomingTrackListId: 2,
    });
    expect(onEnd).not.toHaveBeenCalled();
    expect(controller.consumeHandledEnd()).toBe(false);
    expect(controller.isCrossfadeInProgress()).toBe(false);
  });

  it("suppresses the store advance when the outgoing tail drains", async () => {
    const deckA = createMockEngine("a");
    const deckB = createMockEngine("b");
    const controller = new CrossfadeController(asDecks(deckA, deckB));
    const onEnd = vi.fn();
    controller.onEnd(onEnd);

    await controller.loadAndPlay(
      { kind: "file", path: "/a.wav" },
      { volume: 1, muted: false, balance: 0 },
    );

    controller.maybeScheduleGapless(
      crossfadeScheduleArgs({ positionSeconds: 179, outgoingDuration: 180 }),
    );

    await vi.waitFor(() => {
      expect(deckB.onGaplessStarted).toHaveBeenCalled();
    });

    deckA.emitEnd();

    expect(onEnd).not.toHaveBeenCalled();
    expect(controller.consumeHandledEnd()).toBe(true);
  });

  it("force-starts the incoming deck if the splice signal never arrives", async () => {
    const deckA = createMockEngine("a");
    const deckB = createMockEngine("b");
    const controller = new CrossfadeController(asDecks(deckA, deckB));

    await controller.loadAndPlay(
      { kind: "file", path: "/a.wav" },
      { volume: 1, muted: false, balance: 0 },
    );

    controller.maybeScheduleGapless(
      crossfadeScheduleArgs({ positionSeconds: 179, outgoingDuration: 180 }),
    );

    await vi.waitFor(() => {
      expect(deckB.onGaplessStarted).toHaveBeenCalled();
    });

    deckA.emitEnd();
    expect(deckB.forceGaplessStart).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(300);

    expect(deckB.forceGaplessStart).toHaveBeenCalled();
    expect(deckA.release).toHaveBeenCalled();
    expect(controller.getActiveEngine()).toBe(deckB);
    expect(controller.isCrossfadeInProgress()).toBe(false);
  });

  it("does not double-complete when started and drained both arrive", async () => {
    const deckA = createMockEngine("a");
    const deckB = createMockEngine("b");
    const controller = new CrossfadeController(asDecks(deckA, deckB));
    const onActiveTrackChange = vi.fn();

    await controller.loadAndPlay(
      { kind: "file", path: "/a.wav" },
      { volume: 1, muted: false, balance: 0 },
    );

    controller.maybeScheduleGapless(
      crossfadeScheduleArgs({
        positionSeconds: 179,
        outgoingDuration: 180,
        onActiveTrackChange,
      }),
    );

    await vi.waitFor(() => {
      expect(deckB.onGaplessStarted).toHaveBeenCalled();
    });

    deckB.emitStarted();
    deckA.emitEnd();
    await vi.advanceTimersByTimeAsync(500);

    expect(onActiveTrackChange).toHaveBeenCalledTimes(1);
    expect(deckB.forceGaplessStart).not.toHaveBeenCalled();
  });

  it("cancels gapless preload on seek before handoff", async () => {
    const deckA = createMockEngine("a");
    const deckB = createMockEngine("b");
    let resolveLoad!: () => void;
    deckB.load.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveLoad = resolve;
        }),
    );
    const controller = new CrossfadeController(asDecks(deckA, deckB));

    await controller.loadAndPlay(
      { kind: "file", path: "/a.wav" },
      { volume: 1, muted: false, balance: 0 },
    );

    controller.maybeScheduleGapless(
      crossfadeScheduleArgs({
        positionSeconds: 179,
        outgoingDuration: 180,
      }),
    );
    expect(controller.isCrossfadeInProgress()).toBe(true);

    controller.seekRatio(0.25);

    expect(deckB.release).toHaveBeenCalled();
    expect(deckA.seek).toHaveBeenCalledWith(45);
    expect(controller.getActiveEngine()).toBe(deckA);
    expect(controller.isCrossfadeInProgress()).toBe(false);

    resolveLoad();
    await Promise.resolve();
    expect(deckB.primeGaplessStart).not.toHaveBeenCalled();
  });

  it("does not schedule gapless for repeat-one", async () => {
    const deckA = createMockEngine("a");
    const deckB = createMockEngine("b");
    const controller = new CrossfadeController(asDecks(deckA, deckB));

    await controller.loadAndPlay(
      { kind: "file", path: "/a.wav" },
      { volume: 1, muted: false, balance: 0 },
    );

    controller.maybeScheduleGapless(
      crossfadeScheduleArgs({
        positionSeconds: 179,
        outgoingDuration: 180,
        nextPlayable: { type: "library", trackId: 1 },
        nextSource: { kind: "file", path: "/a.wav" },
        nextTrackId: 1,
        repeatMode: "one",
      }),
    );

    expect(deckB.load).not.toHaveBeenCalled();
  });

  it("does not schedule gapless while remaining exceeds preload headroom", async () => {
    const deckA = createMockEngine("a");
    const deckB = createMockEngine("b");
    const controller = new CrossfadeController(asDecks(deckA, deckB));

    await controller.loadAndPlay(
      { kind: "file", path: "/a.wav" },
      { volume: 1, muted: false, balance: 0 },
    );

    controller.maybeScheduleGapless(
      crossfadeScheduleArgs({
        positionSeconds: 100,
        outgoingDuration: 180,
      }),
    );

    expect(deckB.load).not.toHaveBeenCalled();
  });

  it("schedules gapless handoff for CD↔CD sources", async () => {
    const deckA = createMockEngine("a");
    const deckB = createMockEngine("b");
    const controller = new CrossfadeController(asDecks(deckA, deckB), "cd");
    const onActiveTrackChange = vi.fn();

    const currentSource: PlaybackSource = {
      kind: "cd",
      driveId: "drive-a",
      trackNumber: 1,
    };
    const nextSource: PlaybackSource = {
      kind: "cd",
      driveId: "drive-a",
      trackNumber: 2,
    };

    await controller.loadAndPlay(currentSource, {
      volume: 1,
      muted: false,
      balance: 0,
    });

    controller.maybeScheduleGapless(
      crossfadeScheduleArgs({
        currentPlayable: {
          type: "cd",
          driveId: "drive-a",
          trackNumber: 1,
        },
        currentTrackId: -1,
        currentSource,
        nextPlayable: {
          type: "cd",
          driveId: "drive-a",
          trackNumber: 2,
        },
        nextSource,
        nextTrackId: -2,
        positionSeconds: 179,
        outgoingDuration: 180,
        onActiveTrackChange,
      }),
    );

    await vi.waitFor(() => {
      expect(deckB.load).toHaveBeenCalledWith(nextSource);
      expect(deckB.primeGaplessStart).toHaveBeenCalled();
    });

    deckA.emitDrainAt(12_345);
    expect(deckB.scheduleStartAtFrame).toHaveBeenCalledWith(12_345);

    deckB.emitStarted();
    expect(onActiveTrackChange).toHaveBeenCalledWith({
      incomingPlayable: {
        type: "cd",
        driveId: "drive-a",
        trackNumber: 2,
      },
      incomingTrackListId: -2,
    });
    expect(deckA.release).toHaveBeenCalled();
    expect(controller.getActiveEngine()).toBe(deckB);
  });
});
