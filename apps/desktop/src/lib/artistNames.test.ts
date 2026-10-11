import { describe, expect, it } from "vitest";
import {
  artistNamesEqual,
  DEFAULT_ARTIST_JOIN_DELIMITER,
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
    ["A; B", ["A", "B"]],
    ["A;B", ["A", "B"]],
  ])("parses %s", (raw, expected) => {
    expect(parseArtistField(raw)).toEqual(expected);
  });

  it("does not split on slash", () => {
    expect(parseArtistField("AC/DC")).toEqual(["AC/DC"]);
    expect(parseArtistField("A / B")).toEqual(["A / B"]);
  });

  it("keeps commas inside artist names", () => {
    expect(parseArtistField("Tyler, the Creator")).toEqual([
      "Tyler, the Creator",
    ]);
    expect(parseArtistField("Earth, Wind & Fire")).toEqual([
      "Earth, Wind & Fire",
    ]);
  });

  it("keeps ampersand names whole", () => {
    expect(parseArtistField("Simon & Garfunkel")).toEqual(["Simon & Garfunkel"]);
    expect(parseArtistField("King Gizzard & The Lizard Wizard")).toEqual([
      "King Gizzard & The Lizard Wizard",
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
    expect(serializeArtistField(["A", "B"])).toBe("A; B");
  });

  it("returns null when empty", () => {
    expect(serializeArtistField([])).toBeNull();
    expect(serializeArtistField(["", "  "])).toBeNull();
  });

  it("uses custom delimiter", () => {
    expect(serializeArtistField(["A", "B"], " | ")).toBe("A | B");
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

describe("DEFAULT_ARTIST_JOIN_DELIMITER", () => {
  it("is semicolon with space", () => {
    expect(DEFAULT_ARTIST_JOIN_DELIMITER).toBe("; ");
  });
});
