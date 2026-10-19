import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LoadedSkinPack } from "../types/skin";

const { mockPlayOneShot, mockResolveCueUrl, mockPreferences } = vi.hoisted(
  () => ({
    mockPlayOneShot: vi.fn(),
    mockResolveCueUrl: vi.fn(),
    mockPreferences: {
      current: { builtin: {}, custom: {} } as Record<string, unknown>,
    },
  }),
);

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://${path}`,
}));
vi.mock("./sfxPlayer", () => ({ playOneShot: mockPlayOneShot }));
vi.mock("./packSounds", () => ({ resolveCueUrl: mockResolveCueUrl }));
vi.mock("../store/useSkinPreferencesStore", () => ({
  useSkinPreferencesStore: {
    getState: () => ({ preferences: mockPreferences.current }),
  },
}));
vi.mock("../store/useSkinStore", () => ({
  useSkinStore: { getState: () => ({ activePack: null }) },
}));

import { playSkinSound } from "./skinSoundEffects";

function skinWith(soundEffects?: Record<string, string>): LoadedSkinPack {
  return {
    packDir: "/skins/neon",
    manifest: { soundEffects },
  } as unknown as LoadedSkinPack;
}

describe("playSkinSound", () => {
  beforeEach(() => {
    mockPlayOneShot.mockReset();
    mockResolveCueUrl.mockReset();
    mockPreferences.current = { builtin: {}, custom: {} };
  });

  it("plays the skin's own sound when it defines the key, even for a standard cue", async () => {
    mockResolveCueUrl.mockResolvedValue("asset:///pack/chime.wav");
    playSkinSound(
      skinWith({ transportPlay: "sounds/my-play" }),
      "transportPlay",
    );
    await Promise.resolve();

    expect(mockPlayOneShot).toHaveBeenCalledWith(
      "asset:///skins/neon/assets/sounds/my-play.wav",
    );
    expect(mockResolveCueUrl).not.toHaveBeenCalled();
  });

  it("asks the active sound pack for a key the skin does not define", async () => {
    mockResolveCueUrl.mockResolvedValue("asset:///pack/chime.wav");
    playSkinSound(skinWith({ button: "sounds/click" }), "transportPlay");
    await vi.waitFor(() => expect(mockPlayOneShot).toHaveBeenCalled());

    expect(mockResolveCueUrl).toHaveBeenCalledWith("transportPlay");
    expect(mockPlayOneShot).toHaveBeenCalledWith("asset:///pack/chime.wav");
  });

  it("stays silent when neither the skin nor a pack has the sound", async () => {
    mockResolveCueUrl.mockResolvedValue(null);
    playSkinSound(skinWith(), "unknownCue");
    await Promise.resolve();
    await Promise.resolve();
    expect(mockPlayOneShot).not.toHaveBeenCalled();
  });

  it("does nothing when skin sound effects are turned off", () => {
    mockPreferences.current = {
      builtin: { soundEffectsEnabled: false },
      custom: {},
    };
    playSkinSound(skinWith({ button: "sounds/click" }), "button");
    expect(mockPlayOneShot).not.toHaveBeenCalled();
    expect(mockResolveCueUrl).not.toHaveBeenCalled();
  });
});
