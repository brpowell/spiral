import { describe, expect, it } from "vitest";
import { isViewStateMotionActive } from "./skinViewStateEvents";

describe("isViewStateMotionActive", () => {
  it("is false when every variable is settled", () => {
    expect(isViewStateMotionActive({ eq: "open", shutter: "closed" })).toBe(
      false,
    );
  });

  it("is true while a variable is mid-motion", () => {
    expect(isViewStateMotionActive({ eq: "opening" })).toBe(true);
    expect(isViewStateMotionActive({ eq: "closing" })).toBe(true);
  });
});
