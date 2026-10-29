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

import { NativeCdPlaybackEngine } from "./nativeCdPlaybackEngine";

const TRACK = { kind: "cd" as const, driveId: "disk4", trackNumber: 3 };

function emit(name: string, payload: unknown): void {
  const handler = handlers.get(name);
  if (!handler) throw new Error(`no listener for ${name}`);
  handler({ payload });
}

function commandsNamed(name: string): unknown[][] {
  return invoke.mock.calls.filter((call) => call[0] === name);
}

describe("NativeCdPlaybackEngine", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    invoke.mockReset();
    handlers.clear();
    let next = 20;
    invoke.mockImplementation(async (command: string) =>
      command === "start_cd_playback"
        ? {
            sessionId: next++,
            durationSeconds: 180,
            sampleRate: 44100,
            channels: 2,
          }
        : undefined,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts the track on the native output", async () => {
    const engine = new NativeCdPlaybackEngine();
    await engine.load(TRACK);
    expect(commandsNamed("start_cd_playback")).toEqual([
      ["start_cd_playback", { driveId: "disk4", trackNumber: 3 }],
    ]);
  });

  it("rejects file sources", async () => {
    const engine = new NativeCdPlaybackEngine();
    await expect(
      engine.load({ kind: "file", path: "/a.flac" }),
    ).rejects.toThrow(/cannot load/);
  });

  it("drives the CD commands for transport, gain and balance", async () => {
    const engine = new NativeCdPlaybackEngine();
    engine.setBalance(0.5);
    await engine.load(TRACK);
    await engine.play();
    engine.pause();
    engine.setVolume(0.5);

    expect(commandsNamed("resume_cd_playback")).toEqual([
      ["resume_cd_playback", { sessionId: 20 }],
    ]);
    expect(commandsNamed("pause_cd_playback")).toEqual([
      ["pause_cd_playback", { sessionId: 20 }],
    ]);
    expect(commandsNamed("set_cd_playback_balance")[0]![1]).toEqual({
      sessionId: 20,
      balance: 0.5,
    });
    expect(commandsNamed("set_cd_playback_gain").slice(-1)[0]![1]).toEqual({
      sessionId: 20,
      gain: 0.25, // volume 0.5 under the 0.5 master headroom
    });
    expect(commandsNamed("set_file_playback_gain")).toHaveLength(0);
  });

  it("allows a seek right up to the end of the track", async () => {
    const engine = new NativeCdPlaybackEngine();
    await engine.load(TRACK);
    engine.seek(9999);
    expect(commandsNamed("seek_cd_playback")[0]![1]).toEqual({
      sessionId: 20,
      positionSeconds: 180,
    });
  });

  it("links CD decks with the CD gapless command", async () => {
    const outgoing = new NativeCdPlaybackEngine();
    const incoming = new NativeCdPlaybackEngine();
    await outgoing.load(TRACK);
    await incoming.load({ ...TRACK, trackNumber: 4 });

    outgoing.armGaplessSuccessor(incoming);

    expect(commandsNamed("link_cd_gapless_playback")).toEqual([
      ["link_cd_gapless_playback", { fromSession: 20, toSession: 21 }],
    ]);
  });

  it("starts a primed deck on the CD splice event", async () => {
    const incoming = new NativeCdPlaybackEngine();
    await incoming.load(TRACK);
    const started = vi.fn();
    incoming.onGaplessStarted(started);
    await incoming.primeGaplessStart();

    emit("cd-playback-gapless-started", {
      sessionId: 20,
      driveId: "disk4",
      trackNumber: 3,
    });

    expect(started).toHaveBeenCalledTimes(1);
    expect(incoming.isPlaying()).toBe(true);
  });

  it("reports the natural end after the mixer drains", async () => {
    const engine = new NativeCdPlaybackEngine();
    await engine.load(TRACK);
    const onEnd = vi.fn();
    engine.onEnd(onEnd);
    emit("cd-playback-ended", {
      sessionId: 20,
      driveId: "disk4",
      trackNumber: 3,
    });
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it("surfaces a mid-track read failure with its drive and track", async () => {
    const engine = new NativeCdPlaybackEngine();
    await engine.load(TRACK);
    await engine.play();
    const onError = vi.fn();
    engine.onError(onError);
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    emit("cd-playback-error", {
      sessionId: 20,
      driveId: "disk4",
      trackNumber: 3,
      message: "Failed to read CD audio data",
    });

    expect(onError).toHaveBeenCalledWith({
      driveId: "disk4",
      trackNumber: 3,
      message: "Failed to read CD audio data",
    });
    expect(engine.isPlaying()).toBe(false);
    logged.mockRestore();
  });

  it("ignores events for other sessions", async () => {
    const engine = new NativeCdPlaybackEngine();
    await engine.load(TRACK);
    const onEnd = vi.fn();
    const onError = vi.fn();
    engine.onEnd(onEnd);
    engine.onError(onError);
    emit("cd-playback-ended", { sessionId: 99, driveId: "x", trackNumber: 1 });
    emit("cd-playback-error", { sessionId: 99, driveId: "x", trackNumber: 1 });
    expect(onEnd).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });
});
