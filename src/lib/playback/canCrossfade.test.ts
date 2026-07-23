import { describe, expect, it } from "vitest";
import { canHowlerCrossfade } from "./canCrossfade";

describe("canHowlerCrossfade", () => {
  const mp3 = { kind: "file" as const, path: "/a.mp3" };
  const flac = { kind: "file" as const, path: "/b.flac" };
  const ogg = { kind: "file" as const, path: "/c.ogg" };
  const alac = { kind: "file" as const, path: "/d.m4a", codec: "alac" };
  const aacM4a = { kind: "file" as const, path: "/e.m4a", codec: "aac" };
  const cd = { kind: "cd" as const, driveId: "drive-a", trackNumber: 1 };
  const remote = { kind: "remote" as const, url: "https://example.com/a.mp3" };

  it("returns true for Howler-backed file pairs", () => {
    expect(canHowlerCrossfade(mp3, flac)).toBe(true);
    expect(canHowlerCrossfade(mp3, aacM4a)).toBe(true);
  });

  it("returns false when either side requires PCM playback", () => {
    expect(canHowlerCrossfade(mp3, ogg)).toBe(false);
    expect(canHowlerCrossfade(ogg, flac)).toBe(false);
    expect(canHowlerCrossfade(mp3, alac)).toBe(false);
    expect(canHowlerCrossfade(alac, flac)).toBe(false);
  });

  it("returns false when either side is CD", () => {
    expect(canHowlerCrossfade(cd, mp3)).toBe(false);
    expect(canHowlerCrossfade(mp3, cd)).toBe(false);
    expect(canHowlerCrossfade(cd, cd)).toBe(false);
  });

  it("returns false for remote sources", () => {
    expect(canHowlerCrossfade(remote, mp3)).toBe(false);
    expect(canHowlerCrossfade(mp3, remote)).toBe(false);
  });
});
