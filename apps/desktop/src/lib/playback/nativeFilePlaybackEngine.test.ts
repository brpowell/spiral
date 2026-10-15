import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Handler = (event: { payload: unknown }) => void;

const { invoke, handlers } = vi.hoisted(() => ({
  invoke: vi.fn(),
  handlers: new Map<string, Handler>(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name: string, handler: Handler) => {
    handlers.set(name, handler);
    return () => handlers.delete(name);
  }),
}));

import { NativeFilePlaybackEngine } from "./nativeFilePlaybackEngine";

const SOURCE = { kind: "file" as const, path: "/music/a.flac" };

function emit(name: string, payload: unknown): void {
  const handler = handlers.get(name);
  if (!handler) throw new Error(`no listener for ${name}`);
  handler({ payload });
}

function commandsNamed(name: string): unknown[][] {
  return invoke.mock.calls.filter((call) => call[0] === name);
}

async function loadedEngine(): Promise<NativeFilePlaybackEngine> {
  const engine = new NativeFilePlaybackEngine();
  await engine.load(SOURCE);
  return engine;
}

describe("NativeFilePlaybackEngine", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    invoke.mockReset();
    handlers.clear();
    invoke.mockImplementation(async (command: string) => {
      if (command === "start_native_file_playback") {
        return {
          sessionId: 7,
          durationSeconds: 200,
          sampleRate: 44100,
          channels: 2,
        };
      }
      return undefined;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts a native session without a pcm channel", async () => {
    await loadedEngine();
    expect(commandsNamed("start_native_file_playback")).toEqual([
      ["start_native_file_playback", { path: "/music/a.flac" }],
    ]);
    expect(commandsNamed("start_file_playback")).toHaveLength(0);
  });

  it("rejects non-file sources", async () => {
    const engine = new NativeFilePlaybackEngine();
    await expect(
      engine.load({ kind: "cd", driveId: "d", trackNumber: 1 }),
    ).rejects.toThrow(/cannot load/);
  });

  it("resumes and pauses the Rust session", async () => {
    const engine = await loadedEngine();
    await engine.play();
    expect(commandsNamed("resume_file_playback")).toEqual([
      ["resume_file_playback", { sessionId: 7 }],
    ]);
    expect(engine.isPlaying()).toBe(true);

    engine.pause();
    expect(commandsNamed("pause_file_playback")).toEqual([
      ["pause_file_playback", { sessionId: 7 }],
    ]);
    expect(engine.isPlaying()).toBe(false);
  });

  it("extrapolates the playhead and resyncs to Rust position events", async () => {
    const engine = await loadedEngine();
    await engine.play();
    vi.advanceTimersByTime(2000);
    expect(engine.getPositionSeconds()).toBeCloseTo(2, 1);

    emit("file-playback-position", {
      sessionId: 7,
      positionSeconds: 1.5,
      durationSeconds: 200,
      isPlaying: true,
    });
    expect(engine.getPositionSeconds()).toBeCloseTo(1.5, 1);
  });

  it("freezes the playhead while paused", async () => {
    const engine = await loadedEngine();
    await engine.play();
    vi.advanceTimersByTime(1000);
    engine.pause();
    const frozen = engine.getPositionSeconds();
    vi.advanceTimersByTime(5000);
    expect(engine.getPositionSeconds()).toBe(frozen);
  });

  it("ignores stale position events right after a seek", async () => {
    const engine = await loadedEngine();
    await engine.play();
    engine.seek(100);
    expect(commandsNamed("seek_file_playback")).toEqual([
      ["seek_file_playback", { sessionId: 7, positionSeconds: 100 }],
    ]);

    emit("file-playback-position", {
      sessionId: 7,
      positionSeconds: 3,
      durationSeconds: 200,
      isPlaying: true,
    });
    expect(engine.getPositionSeconds()).toBeCloseTo(100, 1);

    vi.advanceTimersByTime(700);
    emit("file-playback-position", {
      sessionId: 7,
      positionSeconds: 100.8,
      durationSeconds: 200,
      isPlaying: true,
    });
    expect(engine.getPositionSeconds()).toBeCloseTo(100.8, 1);
  });

  it("clamps seeks short of the end", async () => {
    const engine = await loadedEngine();
    engine.seek(9999);
    expect(commandsNamed("seek_file_playback")[0]![1]).toEqual({
      sessionId: 7,
      positionSeconds: 199.95,
    });
  });

  it("ignores events for other sessions", async () => {
    const engine = await loadedEngine();
    const onEnd = vi.fn();
    engine.onEnd(onEnd);
    emit("file-playback-ended", { sessionId: 99 });
    expect(onEnd).not.toHaveBeenCalled();
  });

  it("reports the natural end once Rust says the mixer drained", async () => {
    const engine = await loadedEngine();
    const onEnd = vi.fn();
    engine.onEnd(onEnd);
    await engine.play();
    emit("file-playback-ended", { sessionId: 7 });
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(engine.isPlaying()).toBe(false);
    expect(engine.getPositionSeconds()).toBe(200);
  });

  it("sends volume × crossfade mix, and zero when muted", async () => {
    const engine = await loadedEngine();
    invoke.mockClear();

    engine.setVolume(0.5);
    engine.setCrossfadeMix(0.5);
    engine.setMuted(true);
    engine.setMuted(false);

    const gains = commandsNamed("set_file_playback_gain").map(
      (call) => (call[1] as { gain: number }).gain,
    );
    expect(gains).toEqual([0.5, 0.25, 0, 0.25]);
  });

  it("sends balance to the session, including one set before load", async () => {
    const engine = new NativeFilePlaybackEngine();
    engine.setBalance(-0.5);
    await engine.load(SOURCE);
    expect(commandsNamed("set_file_playback_balance")).toEqual([
      ["set_file_playback_balance", { sessionId: 7, balance: -0.5 }],
    ]);

    invoke.mockClear();
    engine.setBalance(2);
    expect(commandsNamed("set_file_playback_balance")).toEqual([
      ["set_file_playback_balance", { sessionId: 7, balance: 1 }],
    ]);
  });

  it("applies volume set before load once the session exists", async () => {
    const engine = new NativeFilePlaybackEngine();
    engine.setVolume(0.3);
    await engine.load(SOURCE);
    expect(commandsNamed("set_file_playback_gain")).toEqual([
      ["set_file_playback_gain", { sessionId: 7, gain: 0.3 }],
    ]);
  });

  it("stops the previous session when loading another file", async () => {
    const engine = await loadedEngine();
    invoke.mockImplementation(async (command: string) =>
      command === "start_native_file_playback"
        ? { sessionId: 8, durationSeconds: 10, sampleRate: 44100, channels: 2 }
        : undefined,
    );
    await engine.load({ kind: "file", path: "/music/b.flac" });
    expect(commandsNamed("stop_file_playback")).toEqual([
      ["stop_file_playback", { sessionId: 7 }],
    ]);
  });

  it("stops a session that finished starting after a newer load", async () => {
    const engine = new NativeFilePlaybackEngine();
    let release: (value: unknown) => void = () => {};
    invoke.mockImplementationOnce(
      () => new Promise((resolve) => (release = resolve)),
    );
    const slow = engine.load(SOURCE);
    await vi.advanceTimersByTimeAsync(0);
    engine.destroy();
    release({
      sessionId: 5,
      durationSeconds: 10,
      sampleRate: 44100,
      channels: 2,
    });
    await slow;
    expect(commandsNamed("stop_file_playback")).toContainEqual([
      "stop_file_playback",
      { sessionId: 5 },
    ]);
    expect(engine.getDurationSeconds()).toBe(0);
  });

  it("has no Web Audio output bus", async () => {
    const engine = await loadedEngine();
    expect(engine.connectToOutputBus()).toBeNull();
  });
});

describe("NativeFilePlaybackEngine crossfade ramps", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    invoke.mockReset();
    handlers.clear();
    invoke.mockImplementation(async (command: string) =>
      command === "start_native_file_playback"
        ? { sessionId: 7, durationSeconds: 200, sampleRate: 44100, channels: 2 }
        : undefined,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts a ramp from the current mix to the target", async () => {
    const engine = await loadedEngine();
    engine.setCrossfadeMix(0);
    invoke.mockClear();

    engine.rampCrossfadeMix(1, 7);

    expect(commandsNamed("ramp_file_playback_gain")).toEqual([
      [
        "ramp_file_playback_gain",
        { sessionId: 7, fromGain: 0, toGain: 1, durationMs: 7000 },
      ],
    ]);
  });

  it("scales the ramp by volume and mute", async () => {
    const engine = await loadedEngine();
    engine.setVolume(0.5);
    invoke.mockClear();

    engine.rampCrossfadeMix(0, 4);
    expect(commandsNamed("ramp_file_playback_gain")[0]![1]).toEqual({
      sessionId: 7,
      fromGain: 0.5,
      toGain: 0,
      durationMs: 4000,
    });
  });

  it("chains a second ramp from where the first has got to", async () => {
    const engine = await loadedEngine();
    engine.setCrossfadeMix(0);
    engine.rampCrossfadeMix(1, 10);
    vi.advanceTimersByTime(5000);
    invoke.mockClear();

    engine.rampCrossfadeMix(0, 2);

    const args = commandsNamed("ramp_file_playback_gain")[0]![1] as {
      fromGain: number;
    };
    expect(args.fromGain).toBeCloseTo(0.5, 1);
  });

  it("keeps the fade on schedule when volume changes mid-fade", async () => {
    const engine = await loadedEngine();
    engine.setCrossfadeMix(0);
    engine.rampCrossfadeMix(1, 10);
    vi.advanceTimersByTime(4000);
    invoke.mockClear();

    engine.setVolume(0.5);

    const ramp = commandsNamed("ramp_file_playback_gain")[0]![1] as {
      fromGain: number;
      toGain: number;
      durationMs: number;
    };
    expect(ramp.fromGain).toBeCloseTo(0.2, 1); // 0.5 × (4s of 10s)
    expect(ramp.toGain).toBeCloseTo(0.5, 5);
    expect(ramp.durationMs).toBeGreaterThan(5900);
    expect(ramp.durationMs).toBeLessThanOrEqual(6000);
    expect(commandsNamed("set_file_playback_gain")).toHaveLength(0);
  });

  it("a plain mix change cancels the ramp", async () => {
    const engine = await loadedEngine();
    engine.rampCrossfadeMix(0, 10);
    invoke.mockClear();

    engine.setCrossfadeMix(1);
    vi.advanceTimersByTime(1000);
    engine.setVolume(0.8);

    expect(commandsNamed("ramp_file_playback_gain")).toHaveLength(0);
    expect(commandsNamed("set_file_playback_gain").slice(-1)[0]![1]).toEqual({
      sessionId: 7,
      gain: 0.8,
    });
  });

  it("a zero-length ramp is an immediate set", async () => {
    const engine = await loadedEngine();
    invoke.mockClear();
    engine.rampCrossfadeMix(0.25, 0);
    expect(commandsNamed("ramp_file_playback_gain")).toHaveLength(0);
    expect(commandsNamed("set_file_playback_gain")[0]![1]).toEqual({
      sessionId: 7,
      gain: 0.25,
    });
  });

  it("registers as the deck's gain target and unregisters when retired", async () => {
    const { getNativeDeck } = await import("./nativeDeckRegistry");
    const engine = await loadedEngine();
    expect(getNativeDeck("a")).toBe(engine);
    engine.destroy();
    expect(getNativeDeck("a")).toBeNull();
  });
});

describe("NativeFilePlaybackEngine gapless", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    invoke.mockReset();
    handlers.clear();
    let next = 7;
    invoke.mockImplementation(async (command: string) => {
      if (command === "start_native_file_playback") {
        return {
          sessionId: next++,
          durationSeconds: 200,
          sampleRate: 44100,
          channels: 2,
        };
      }
      return undefined;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function pair() {
    const outgoing = new NativeFilePlaybackEngine();
    const incoming = new NativeFilePlaybackEngine();
    await outgoing.load(SOURCE);
    await incoming.load({ kind: "file", path: "/music/b.flac" });
    return { outgoing, incoming };
  }

  it("links the two Rust sessions so the mixer splices them", async () => {
    const { outgoing, incoming } = await pair();
    outgoing.armGaplessSuccessor(incoming);
    expect(commandsNamed("link_gapless_playback")).toEqual([
      ["link_gapless_playback", { fromSession: 7, toSession: 8 }],
    ]);
  });

  it("does not link when the other deck has no session", async () => {
    const { outgoing } = await pair();
    outgoing.armGaplessSuccessor(new NativeFilePlaybackEngine());
    expect(commandsNamed("link_gapless_playback")).toHaveLength(0);
  });

  it("keeps a primed deck silent at position zero until Rust starts it", async () => {
    const { incoming } = await pair();
    await incoming.primeGaplessStart();
    vi.advanceTimersByTime(3000);
    expect(incoming.getPositionSeconds()).toBe(0);
    expect(incoming.isPlaying()).toBe(false);
  });

  it("starts the playhead from zero when Rust reports the splice", async () => {
    const { incoming } = await pair();
    const started = vi.fn();
    incoming.onGaplessStarted(started);
    await incoming.primeGaplessStart();

    emit("file-playback-gapless-started", { sessionId: 8 });

    expect(started).toHaveBeenCalledTimes(1);
    expect(incoming.isPlaying()).toBe(true);
    vi.advanceTimersByTime(1500);
    expect(incoming.getPositionSeconds()).toBeCloseTo(1.5, 1);
  });

  it("ignores a splice event for another session", async () => {
    const { incoming } = await pair();
    const started = vi.fn();
    incoming.onGaplessStarted(started);
    await incoming.primeGaplessStart();
    emit("file-playback-gapless-started", { sessionId: 99 });
    expect(started).not.toHaveBeenCalled();
  });

  it("fires the start callback once when forced after a splice", async () => {
    const { incoming } = await pair();
    const started = vi.fn();
    incoming.onGaplessStarted(started);
    await incoming.primeGaplessStart();
    emit("file-playback-gapless-started", { sessionId: 8 });
    incoming.forceGaplessStart();
    expect(started).toHaveBeenCalledTimes(1);
  });

  it("forcing the start resumes the Rust session and reports started", async () => {
    const { incoming } = await pair();
    const started = vi.fn();
    incoming.onGaplessStarted(started);
    await incoming.primeGaplessStart();

    incoming.forceGaplessStart();

    expect(commandsNamed("resume_file_playback")).toEqual([
      ["resume_file_playback", { sessionId: 8 }],
    ]);
    expect(started).toHaveBeenCalledTimes(1);
    expect(incoming.isPlaying()).toBe(true);
  });

  it("advertises gapless", () => {
    expect(new NativeFilePlaybackEngine().capabilities.gapless).toBe(true);
  });
});
