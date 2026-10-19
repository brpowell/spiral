import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockResolveSoundCue } = vi.hoisted(() => ({
  mockResolveSoundCue: vi.fn(),
}));

vi.mock("./tauri", () => ({
  resolveSoundCue: mockResolveSoundCue,
  resolveSoundPackAsset: vi.fn(),
}));
vi.mock("./windowRole", () => ({ isTauri: () => false }));
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://${path}`,
}));
vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn(),
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

import { invalidateSoundCueCache, resolveCueUrl } from "./packSounds";

describe("resolveCueUrl", () => {
  beforeEach(() => {
    mockResolveSoundCue.mockReset();
    invalidateSoundCueCache();
  });

  it("resolves a cue to an asset URL and caches it", async () => {
    mockResolveSoundCue.mockResolvedValue("/packs/chime.wav");
    expect(await resolveCueUrl("transportPlay")).toBe(
      "asset:///packs/chime.wav",
    );
    expect(await resolveCueUrl("transportPlay")).toBe(
      "asset:///packs/chime.wav",
    );
    expect(mockResolveSoundCue).toHaveBeenCalledTimes(1);
  });

  it("returns null when no pack defines the cue", async () => {
    mockResolveSoundCue.mockResolvedValue(null);
    expect(await resolveCueUrl("noSuchCue")).toBeNull();
  });

  it("ignores blank cues without asking the backend", async () => {
    expect(await resolveCueUrl("  ")).toBeNull();
    expect(mockResolveSoundCue).not.toHaveBeenCalled();
  });

  it("re-resolves after the cache is invalidated (active pack changed)", async () => {
    mockResolveSoundCue.mockResolvedValueOnce("/a.wav");
    expect(await resolveCueUrl("transportPlay")).toBe("asset:///a.wav");
    invalidateSoundCueCache();
    mockResolveSoundCue.mockResolvedValueOnce("/b.wav");
    expect(await resolveCueUrl("transportPlay")).toBe("asset:///b.wav");
  });

  it("does not cache an answer that raced with an invalidation", async () => {
    let release!: (path: string) => void;
    mockResolveSoundCue.mockReturnValueOnce(
      new Promise<string>((resolve) => {
        release = resolve;
      }),
    );
    const stale = resolveCueUrl("transportPlay");
    invalidateSoundCueCache();
    release("/old.wav");
    await stale;

    mockResolveSoundCue.mockResolvedValueOnce("/new.wav");
    expect(await resolveCueUrl("transportPlay")).toBe("asset:///new.wav");
  });
});
