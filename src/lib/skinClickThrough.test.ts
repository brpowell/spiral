import { describe, expect, it } from "vitest";
import { isSkinPanelInteractionActive } from "./skinClickThrough";

describe("isSkinPanelInteractionActive", () => {
  it("is false when every panel is closed and settled", () => {
    expect(
      isSkinPanelInteractionActive(
        { eq: false },
        { eq: false },
        { eq: true },
      ),
    ).toBe(false);
  });

  it("is true while a panel is open", () => {
    expect(
      isSkinPanelInteractionActive(
        { eq: true },
        { eq: true },
        { eq: true },
      ),
    ).toBe(true);
  });

  it("is true while a panel is mid-motion", () => {
    expect(
      isSkinPanelInteractionActive(
        { eq: true },
        { eq: true },
        { eq: false },
      ),
    ).toBe(true);
  });

  it("is true while panel content is revealed before open motion", () => {
    expect(
      isSkinPanelInteractionActive(
        { eq: false },
        { eq: true },
        { eq: false },
      ),
    ).toBe(true);
  });
});
