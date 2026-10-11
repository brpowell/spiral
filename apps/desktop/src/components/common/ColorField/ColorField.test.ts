import { describe, expect, it } from "vitest";
import { cssColorToHex } from "./ColorField";

describe("cssColorToHex", () => {
  it("parses hex colors", () => {
    expect(cssColorToHex("#abc")).toBe("#aabbcc");
    expect(cssColorToHex("#AABBCC")).toBe("#aabbcc");
    expect(cssColorToHex("#aabbccff")).toBe("#aabbcc");
  });

  it("returns null for empty input", () => {
    expect(cssColorToHex("")).toBeNull();
    expect(cssColorToHex("   ")).toBeNull();
  });
});
