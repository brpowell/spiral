import { describe, expect, it } from "vitest";
import { canCrossfade } from "./canCrossfade";

describe("canCrossfade", () => {
  const mp3 = { kind: "file" as const, path: "/a.mp3" };
  const flac = { kind: "file" as const, path: "/b.flac" };
  const ogg = { kind: "file" as const, path: "/c.ogg" };
  const cd = { kind: "cd" as const, driveId: "drive-a", trackNumber: 1 };

  it("allows library file pairs of any format", () => {
    expect(canCrossfade(mp3, flac)).toBe(true);
    expect(canCrossfade(ogg, mp3)).toBe(true);
  });

  it("rejects transitions involving CD", () => {
    expect(canCrossfade(cd, mp3)).toBe(false);
    expect(canCrossfade(mp3, cd)).toBe(false);
  });
});
