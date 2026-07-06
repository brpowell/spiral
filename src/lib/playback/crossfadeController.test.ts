import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { effectiveFadeSeconds } from "./canCrossfade";
import { CrossfadeController } from "./crossfadeController";
import type { FilePlaybackEngine } from "./filePlaybackEngine";
import type { DeckId } from "./audioMixer";
import type { PlaybackSource } from "./types";

vi.mock("./audioMixer", () => ({
  rampDeckGain: vi.fn(),
  setDeckGain: vi.fn(),
  getDeckGainNode: vi.fn(() => null),
}));

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
  return {
    deckId,
    setDeckId: vi.fn(),
    getDeckId: () => deckId,
    setSuppressEndCallback: vi.fn(),
    load: vi.fn(async () => {}),
    play: vi.fn(),
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
    destroy: vi.fn(),
    onEnd: vi.fn((callback: () => void) => {
      listeners.push(callback);
    }),
    emitEnd: () => {
      for (const listener of listeners) listener();
    },
  } satisfies Partial<FilePlaybackEngine> & {
    deckId: DeckId;
    emitEnd: () => void;
  };
}

function crossfadeScheduleArgs(
  overrides: Partial<Parameters<CrossfadeController["maybeScheduleCrossfade"]>[0]> = {},
) {
  return {
    crossfadeSeconds: 7,
    currentPlayable: { type: "library" as const, trackId: 1 },
    currentTrackId: 1,
    currentSource: { kind: "file" as const, path: "/a.mp3" },
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
    const controller = new CrossfadeController({
      a: deckA as unknown as FilePlaybackEngine,
      b: deckB as unknown as FilePlaybackEngine,
    });

    const onEnd = vi.fn();
    controller.onEnd(onEnd);

    await controller.loadAndPlay({ kind: "file", path: "/a.mp3" }, {
      volume: 1,
      muted: false,
      balance: 0,
    });

    const currentSource: PlaybackSource = { kind: "file", path: "/a.mp3" };
    const nextSource: PlaybackSource = { kind: "file", path: "/b.flac" };

    controller.maybeScheduleCrossfade(
      crossfadeScheduleArgs({
        currentSource,
        nextSource,
      }),
    );

    await vi.waitFor(() => {
      expect(deckB.load).toHaveBeenCalledWith(nextSource);
    });

    deckA.emitEnd();
    expect(controller.consumeHandledEnd()).toBe(true);
    expect(onEnd).not.toHaveBeenCalled();
  });

  it("promotes incoming track at half the fade duration", async () => {
    const deckA = createMockEngine("a");
    const deckB = createMockEngine("b");
    const controller = new CrossfadeController({
      a: deckA as unknown as FilePlaybackEngine,
      b: deckB as unknown as FilePlaybackEngine,
    });

    const onActiveTrackChange = vi.fn();

    await controller.loadAndPlay({ kind: "file", path: "/a.mp3" }, {
      volume: 1,
      muted: false,
      balance: 0,
    });

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

    expect(deckA.destroy).toHaveBeenCalled();
    expect(onActiveTrackChange).toHaveBeenCalledTimes(1);
  });

  it("reports crossfade visual state with linear progress during fade", async () => {
    const deckA = createMockEngine("a");
    const deckB = createMockEngine("b");
    const controller = new CrossfadeController({
      a: deckA as unknown as FilePlaybackEngine,
      b: deckB as unknown as FilePlaybackEngine,
    });

    await controller.loadAndPlay({ kind: "file", path: "/a.mp3" }, {
      volume: 1,
      muted: false,
      balance: 0,
    });

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
    const controller = new CrossfadeController({
      a: deckA as unknown as FilePlaybackEngine,
      b: deckB as unknown as FilePlaybackEngine,
    });

    await controller.loadAndPlay({ kind: "file", path: "/a.mp3" }, {
      volume: 1,
      muted: false,
      balance: 0,
    });

    controller.maybeScheduleCrossfade(crossfadeScheduleArgs());

    await vi.waitFor(() => {
      expect(deckB.play).toHaveBeenCalled();
    });

    await vi.advanceTimersByTimeAsync(7050);

    expect(deckA.destroy).toHaveBeenCalled();
    expect(controller.getActiveEngine()).toBe(deckB);
  });

  it("cancels crossfade and seeks the outgoing deck before dominance", async () => {
    const deckA = createMockEngine("a");
    const deckB = createMockEngine("b");
    const controller = new CrossfadeController({
      a: deckA as unknown as FilePlaybackEngine,
      b: deckB as unknown as FilePlaybackEngine,
    });

    await controller.loadAndPlay({ kind: "file", path: "/a.mp3" }, {
      volume: 1,
      muted: false,
      balance: 0,
    });

    controller.maybeScheduleCrossfade(crossfadeScheduleArgs());

    await vi.waitFor(() => {
      expect(deckB.play).toHaveBeenCalled();
    });

    controller.seekRatio(0.5);

    expect(deckB.destroy).toHaveBeenCalled();
    expect(deckA.seek).toHaveBeenCalledWith(90);
    expect(controller.getActiveEngine()).toBe(deckA);
    expect(controller.isCrossfadeInProgress()).toBe(false);
  });

  it("cancels crossfade and seeks the incoming deck after dominance", async () => {
    const deckA = createMockEngine("a");
    const deckB = createMockEngine("b");
    deckB.getDurationSeconds = vi.fn(() => 200);
    const controller = new CrossfadeController({
      a: deckA as unknown as FilePlaybackEngine,
      b: deckB as unknown as FilePlaybackEngine,
    });

    await controller.loadAndPlay({ kind: "file", path: "/a.mp3" }, {
      volume: 1,
      muted: false,
      balance: 0,
    });

    controller.maybeScheduleCrossfade(crossfadeScheduleArgs());

    await vi.waitFor(() => {
      expect(deckB.play).toHaveBeenCalled();
    });

    await vi.advanceTimersByTimeAsync(3500);
    controller.seekRatio(0.25);

    expect(deckA.destroy).toHaveBeenCalled();
    expect(deckB.seek).toHaveBeenCalledWith(50);
    expect(controller.getActiveEngine()).toBe(deckB);
    expect(controller.isCrossfadeInProgress()).toBe(false);
  });

  it("does not schedule crossfade for repeat-one", async () => {
    const deckA = createMockEngine("a");
    const deckB = createMockEngine("b");
    const controller = new CrossfadeController({
      a: deckA as unknown as FilePlaybackEngine,
      b: deckB as unknown as FilePlaybackEngine,
    });

    await controller.loadAndPlay({ kind: "file", path: "/a.mp3" }, {
      volume: 1,
      muted: false,
      balance: 0,
    });

    controller.maybeScheduleCrossfade(
      crossfadeScheduleArgs({
        nextPlayable: { type: "library", trackId: 1 },
        nextSource: { kind: "file", path: "/a.mp3" },
        nextTrackId: 1,
        repeatMode: "one",
      }),
    );

    expect(deckB.load).not.toHaveBeenCalled();
  });

  it("loadAndPlay keeps controller active after hard cut reload", async () => {
    const deckA = createMockEngine("a");
    const deckB = createMockEngine("b");
    const controller = new CrossfadeController({
      a: deckA as unknown as FilePlaybackEngine,
      b: deckB as unknown as FilePlaybackEngine,
    });

    await controller.loadAndPlay({ kind: "file", path: "/a.mp3" }, {
      volume: 1,
      muted: false,
      balance: 0,
    });

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

    await controller.loadAndPlay({ kind: "file", path: "/a.mp3" }, {
      volume: 1,
      muted: false,
      balance: 0,
    });

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
    const controller = new CrossfadeController({
      a: deckA as unknown as FilePlaybackEngine,
      b: deckB as unknown as FilePlaybackEngine,
    });

    await controller.loadAndPlay({ kind: "file", path: "/a.mp3" }, {
      volume: 1,
      muted: false,
      balance: 0,
    });

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

  it("chains rapid skip crossfades using the in-flight incoming track", async () => {
    const deckA = createMockEngine("a");
    const deckB = createMockEngine("b");
    const controller = new CrossfadeController({
      a: deckA as unknown as FilePlaybackEngine,
      b: deckB as unknown as FilePlaybackEngine,
    });

    await controller.loadAndPlay({ kind: "file", path: "/a.mp3" }, {
      volume: 1,
      muted: false,
      balance: 0,
    });

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
    const controller = new CrossfadeController({
      a: deckA as unknown as FilePlaybackEngine,
      b: deckB as unknown as FilePlaybackEngine,
    });
    const onComplete = vi.fn();

    await controller.loadAndPlay({ kind: "file", path: "/a.mp3" }, {
      volume: 1,
      muted: false,
      balance: 0,
    });

    controller.fadeOutAndStop(7, onComplete);

    expect(controller.isCrossfadeInProgress()).toBe(true);
    expect(onComplete).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(7050);

    expect(deckA.pause).toHaveBeenCalled();
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(controller.isCrossfadeInProgress()).toBe(false);
  });
});
