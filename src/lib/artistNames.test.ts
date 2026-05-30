import { describe, expect, it } from "vitest";
import {
  artistNamesEqual,
  DEFAULT_ARTIST_JOIN_DELIMITER,
  normalizeArtistFieldFromTagValue,
  normalizeArtistName,
  parseArtistField,
  serializeArtistField,
} from "./artistNames";

describe("normalizeArtistName", () => {
  it("trims and collapses whitespace", () => {
    expect(normalizeArtistName("  hello   world  ")).toBe("hello world");
  });
});

describe("parseArtistField", () => {
  it.each([
    ["A / B", ["A", "B"]],
    ["A/B", ["A", "B"]],
    ["A; B", ["A", "B"]],
    ["A, B", ["A", "B"]],
  ])("parses %s", (raw, expected) => {
    expect(parseArtistField(raw)).toEqual(expected);
  });

  it("keeps Simon & Garfunkel as one name", () => {
    expect(parseArtistField("Simon & Garfunkel")).toEqual(["Simon & Garfunkel"]);
  });

  it("splits Anderson .Paak & Bruno Mars", () => {
    expect(parseArtistField("Anderson .Paak & Bruno Mars")).toEqual([
      "Anderson .Paak",
      "Bruno Mars",
    ]);
  });

  it("returns empty for blank input", () => {
    expect(parseArtistField("")).toEqual([]);
    expect(parseArtistField(null)).toEqual([]);
    expect(parseArtistField(undefined)).toEqual([]);
  });
});

describe("serializeArtistField", () => {
  it("joins with default delimiter", () => {
    expect(serializeArtistField(["A", "B"])).toBe("A / B");
  });

  it("returns null when empty", () => {
    expect(serializeArtistField([])).toBeNull();
    expect(serializeArtistField(["", "  "])).toBeNull();
  });

  it("uses custom delimiter", () => {
    expect(serializeArtistField(["A", "B"], "; ")).toBe("A; B");
  });
});

describe("artistNamesEqual", () => {
  it("is true for same names", () => {
    expect(artistNamesEqual(["A", "B"], ["A", "B"])).toBe(true);
  });

  it("is false when order differs", () => {
    expect(artistNamesEqual(["A", "B"], ["B", "A"])).toBe(false);
  });

  it("ignores surrounding whitespace", () => {
    expect(artistNamesEqual([" A "], ["A"])).toBe(true);
  });
});

describe("normalizeArtistFieldFromTagValue", () => {
  it("joins multi-value arrays with default delimiter", () => {
    expect(normalizeArtistFieldFromTagValue(["A", " B "])).toBe("A / B");
  });

  it("trims single strings without re-parsing", () => {
    expect(normalizeArtistFieldFromTagValue("  A; B  ")).toBe("A; B");
  });

  it("returns null for empty input", () => {
    expect(normalizeArtistFieldFromTagValue(undefined)).toBeNull();
    expect(normalizeArtistFieldFromTagValue([])).toBeNull();
    expect(normalizeArtistFieldFromTagValue("   ")).toBeNull();
  });

  it("exports expected default delimiter", () => {
    expect(DEFAULT_ARTIST_JOIN_DELIMITER).toBe(" / ");
  });
});
