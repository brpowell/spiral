import { describe, expect, it } from "vitest";
import { canCrossfade, canGapless } from "./canCrossfade";

describe("canCrossfade", () => {
  const mp3 = { kind: "file" as const, path: "/a.mp3" };
  const flac = { kind: "file" as const, path: "/b.flac" };
  const ogg = { kind: "file" as const, path: "/c.ogg" };
  const cd = { kind: "cd" as const, driveId: "drive-a", trackNumber: 1 };

  it("allows library file pairs of any format", () => {
    expect(canCrossfade(mp3, flac)).toBe(true);
    expect(canCrossfade(ogg, mp3)).toBe(true);
  });

  it("rejects CD↔CD and mixed media (CD stays gapless-only)", () => {
    expect(canCrossfade(cd, mp3)).toBe(false);
    expect(canCrossfade(mp3, cd)).toBe(false);
    expect(canCrossfade(cd, cd)).toBe(false);
  });
});

describe("canGapless", () => {
  const mp3 = { kind: "file" as const, path: "/a.mp3" };
  const flac = { kind: "file" as const, path: "/b.flac" };
  const cd1 = { kind: "cd" as const, driveId: "drive-a", trackNumber: 1 };
  const cd2 = { kind: "cd" as const, driveId: "drive-a", trackNumber: 2 };
  const cdOther = { kind: "cd" as const, driveId: "drive-b", trackNumber: 1 };

  it("allows library file pairs", () => {
    expect(canGapless(mp3, flac)).toBe(true);
  });

  it("allows CD↔CD on the same drive", () => {
    expect(canGapless(cd1, cd2)).toBe(true);
  });

  it("rejects CD↔CD across drives and file↔CD", () => {
    expect(canGapless(cd1, cdOther)).toBe(false);
    expect(canGapless(cd1, mp3)).toBe(false);
    expect(canGapless(mp3, cd1)).toBe(false);
  });
});
