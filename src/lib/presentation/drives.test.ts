import { describe, expect, it } from "vitest";
import { resolveDrive } from "./drives";
import type { DriveContext } from "./drives";

const context: DriveContext = {
  audio: {
    bins: [],
    isPlaying: true,
    playbackState: "playing",
    volume: 0.8,
    overallEnergy: 0.5,
    bassEnergy: 0.2,
    midEnergy: 0.6,
    trebleEnergy: 0.9,
  },
  bind: (path) => (path === "player.isPlaying" ? true : null),
};

describe("resolveDrive", () => {
  it("resolves numeric literals", () => {
    expect(resolveDrive(0.75, context)).toBe(0.75);
  });

  it("resolves audio string sugar", () => {
    expect(resolveDrive("audio.bassEnergy", context)).toBe(0.2);
  });

  it("resolves bind paths to numbers", () => {
    expect(resolveDrive("player.isPlaying", context)).toBe(1);
  });

  it("applies map ranges", () => {
    expect(
      resolveDrive(
        { drive: "audio.trebleEnergy", map: [0, 1, 0, 100] },
        context,
      ),
    ).toBe(90);
  });

  it("returns static value from structured binding", () => {
    expect(resolveDrive({ drive: "audio.bassEnergy", value: 0.42 }, context)).toBe(
      0.42,
    );
  });
});
