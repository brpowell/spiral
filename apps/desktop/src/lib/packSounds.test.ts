import { describe, expect, it } from "vitest";
import { isPublicSoundContributionId } from "./packSounds";

describe("isPublicSoundContributionId", () => {
  it("accepts author.pack.sound.id shapes", () => {
    expect(isPublicSoundContributionId("spiral.core.sound.play")).toBe(true);
    expect(isPublicSoundContributionId("spiral.core.sound.control")).toBe(true);
  });

  it("rejects local soundEffects keys", () => {
    expect(isPublicSoundContributionId("button")).toBe(false);
    expect(isPublicSoundContributionId("transportPlay")).toBe(false);
    expect(isPublicSoundContributionId("spiral.core.skin.vanilla")).toBe(false);
    expect(isPublicSoundContributionId("a.b.theme.c")).toBe(false);
  });
});
