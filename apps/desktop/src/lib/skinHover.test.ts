import { describe, expect, it } from "vitest";
import { hoverNodeDataAttributes } from "./skinHover";

describe("hoverNodeDataAttributes", () => {
  it("exposes hovered node ids as data-hover-* attrs", () => {
    expect(hoverNodeDataAttributes(new Set(["visFrame"]))).toEqual({
      "data-hover-visFrame": "true",
    });
  });
});
