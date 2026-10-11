import { describe, expect, it } from "vitest";
import { resolveButtonGroupPrimaryNodeId } from "./SkinButtonGroupHitRegistry";

describe("resolveButtonGroupPrimaryNodeId", () => {
  it("prefers pressed node over hover", () => {
    expect(resolveButtonGroupPrimaryNodeId("play-stop", "pause")).toBe(
      "play-stop",
    );
  });

  it("falls back to hover when not pressed", () => {
    expect(resolveButtonGroupPrimaryNodeId(null, "pause")).toBe("pause");
  });

  it("returns null when neither pressed nor hovered", () => {
    expect(resolveButtonGroupPrimaryNodeId(null, null)).toBeNull();
  });
});
