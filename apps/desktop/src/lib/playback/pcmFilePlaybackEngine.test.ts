import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RecoverOptions } from "./types";

const { sharedPcmContextNeedsRebuild } = vi.hoisted(() => ({
  sharedPcmContextNeedsRebuild: vi.fn(() => false),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));

vi.mock("./pcmSharedContext", () => ({
  sharedPcmContextNeedsRebuild,
  recreateSharedPcmAudioContextSync: vi.fn(),
  closeReplacedPcmAudioContext: vi.fn(),
  unlockAudioContext: vi.fn(),
  getSharedPcmAudioContext: vi.fn(),
  ensureSharedPcmWorkletModule: vi.fn(async () => {}),
}));

import { PcmFilePlaybackEngine } from "./pcmFilePlaybackEngine";

const playingFile: RecoverOptions = {
  wasPlaying: true,
  positionSeconds: 42,
  source: { kind: "file", path: "/tmp/track.flac" },
};

type EngineSession = {
  current: { sessionId: number } | null;
};

function attachLiveSession(engine: PcmFilePlaybackEngine): void {
  (engine as unknown as EngineSession).current = { sessionId: 7 };
}

describe("PcmFilePlaybackEngine.recover", () => {
  beforeEach(() => {
    sharedPcmContextNeedsRebuild.mockReturnValue(false);
  });

  it("does not reload a live session that is still outputting", async () => {
    const engine = new PcmFilePlaybackEngine();
    attachLiveSession(engine);
    const load = vi.spyOn(engine, "load");

    const result = await engine.recover(playingFile);

    expect(result).toEqual({
      restarted: false,
      reloaded: false,
      alreadyHealthy: true,
    });
    expect(load).not.toHaveBeenCalled();
  });

  it("defers a sleep rebuild to play() instead of reloading from recover", async () => {
    sharedPcmContextNeedsRebuild.mockReturnValue(true);
    const engine = new PcmFilePlaybackEngine();
    attachLiveSession(engine);
    const load = vi.spyOn(engine, "load");

    const result = await engine.recover(playingFile);

    expect(result).toEqual({
      restarted: false,
      reloaded: false,
      alreadyHealthy: true,
    });
    expect(load).not.toHaveBeenCalled();
  });

  it("does not claim a dead session is healthy", async () => {
    const engine = new PcmFilePlaybackEngine();
    const load = vi.spyOn(engine, "load");

    const result = await engine.recover(playingFile);

    expect(result).toEqual({ restarted: false, reloaded: false });
    expect(load).not.toHaveBeenCalled();
  });
});
