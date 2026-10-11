import { describe, expect, it } from "vitest";
import { shouldApplyRemoteSkinPreferences } from "./skinBridge";

describe("shouldApplyRemoteSkinPreferences", () => {
  it("applies when the event matches the loaded skin", () => {
    expect(
      shouldApplyRemoteSkinPreferences(
        "spiral.wmp-lost-planet.skin.lost-planet",
        "spiral.wmp-lost-planet.skin.lost-planet",
        "spiral.wmp-lost-planet.skin.lost-planet",
      ),
    ).toBe(true);
  });

  it("applies when the event matches the active pack even if prefs id differs", () => {
    expect(
      shouldApplyRemoteSkinPreferences(
        "spiral.wmp-lost-planet.skin.lost-planet",
        "lost-planet",
        "spiral.wmp-lost-planet.skin.lost-planet",
      ),
    ).toBe(true);
  });

  it("applies when this window has not loaded prefs yet", () => {
    expect(
      shouldApplyRemoteSkinPreferences(
        "spiral.wmp-lost-planet.skin.lost-planet",
        null,
        "spiral.core.skin.spiral-default",
      ),
    ).toBe(true);
  });

  it("ignores a snapshot for a different skin", () => {
    expect(
      shouldApplyRemoteSkinPreferences(
        "spiral.wmp-t3.skin.t3",
        "spiral.wmp-lost-planet.skin.lost-planet",
        "spiral.wmp-lost-planet.skin.lost-planet",
      ),
    ).toBe(false);
  });
});
