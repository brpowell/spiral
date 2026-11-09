import { describe, expect, it } from "vitest";
import { parseMappingColor } from "./skinButtonGroupMap";

describe("parseMappingColor", () => {
  it("parses WMP-style hex colors", () => {
    expect(parseMappingColor("#0000ff")).toEqual({ r: 0, g: 0, b: 255 });
    expect(parseMappingColor("#0033ff")).toEqual({ r: 0, g: 51, b: 255 });
    expect(parseMappingColor("#0066ff")).toEqual({ r: 0, g: 102, b: 255 });
  });

  it("returns null for invalid colors", () => {
    expect(parseMappingColor("blue")).toBeNull();
    expect(parseMappingColor("#00f")).toBeNull();
  });
});
