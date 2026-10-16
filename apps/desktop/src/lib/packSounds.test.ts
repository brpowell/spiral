import { describe, expect, it } from "vitest";
import { isPublicSoundContributionId } from "./packSounds";

describe("isPublicSoundContributionId", () => {
  it("accepts authorId.sound.id shapes", () => {
    expect(isPublicSoundContributionId("spiral.sound.play")).toBe(true);
    expect(isPublicSoundContributionId("spiral.sound.control")).toBe(true);
  });

  it("rejects local soundEffects keys", () => {
    expect(isPublicSoundContributionId("button")).toBe(false);
    expect(isPublicSoundContributionId("transportPlay")).toBe(false);
    expect(isPublicSoundContributionId("spiral.skin.vanilla")).toBe(false);
    expect(isPublicSoundContributionId("a.theme.c")).toBe(false);
    // Pre-item ids (author.pack.sound.id) no longer resolve.
    expect(isPublicSoundContributionId("spiral.core.sound.play")).toBe(false);
  });
});
