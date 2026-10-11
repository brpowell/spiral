import { describe, expect, it } from "vitest";
import {
  anchorOffsetTop,
  capHeight,
  pinnedOffsetTop,
  readCssPx,
} from "./fitModalHeight";

describe("readCssPx", () => {
  it("reads pixel lengths", () => {
    expect(readCssPx("820px")).toBe(820);
    expect(readCssPx("0px")).toBe(0);
  });

  it("ignores values that are not a resolved length", () => {
    expect(readCssPx("none")).toBeNull();
    expect(readCssPx("auto")).toBeNull();
    expect(readCssPx("min(92vh, 820px)")).toBeNull();
  });
});

describe("capHeight", () => {
  it("keeps a shorter content height", () => {
    expect(capHeight(420, 820)).toBe(420);
  });

  it("clamps to the panel max-height", () => {
    expect(capHeight(960, 820)).toBe(820);
  });

  it("leaves the content height when max-height does not resolve", () => {
    expect(capHeight(420, null)).toBe(420);
    expect(capHeight(420, 0)).toBe(420);
  });
});

describe("anchorOffsetTop", () => {
  it("places every tab at the top where the tallest tab would be centered", () => {
    // Content box is 900 - 48 = 852. Tallest 700 centers at 76.
    // A 280px tab centered on its own would sit at 286.
    expect(anchorOffsetTop(700, 280, 900, 24, 24)).toBe(76);
    expect(anchorOffsetTop(700, 700, 900, 24, 24)).toBe(76);
  });

  it("pins to the top when the tallest tab is taller than the backdrop", () => {
    expect(anchorOffsetTop(1000, 280, 900, 24, 24)).toBe(0);
  });
});

describe("pinnedOffsetTop", () => {
  it("keeps the preferred top when the new height still fits", () => {
    expect(pinnedOffsetTop(120, 400, 900, 24, 24)).toBe(120);
  });

  it("shifts up only enough to stay inside the backdrop padding", () => {
    // Content box is 900 - 48 = 852. 852 - 700 = 152.
    expect(pinnedOffsetTop(400, 700, 900, 24, 24)).toBe(152);
  });

  it("pins to the top when the panel is taller than the content box", () => {
    expect(pinnedOffsetTop(400, 1000, 900, 24, 24)).toBe(0);
  });
});
