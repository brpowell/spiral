import { describe, expect, it } from "vitest";
import { filterSubstringSuggestions } from "./suggestionFilter";

describe("filterSubstringSuggestions", () => {
  const suggestions = ["Rock", "Jazz", "Pop"];

  it("returns all suggestions when the term is empty", () => {
    expect(filterSubstringSuggestions(suggestions, "")).toEqual(suggestions);
    expect(filterSubstringSuggestions(suggestions, "   ")).toEqual(suggestions);
  });

  it("filters by substring when the term is non-empty", () => {
    expect(filterSubstringSuggestions(suggestions, "ja")).toEqual(["Jazz"]);
  });

  it("omits an exact match so a redundant single-item list is not shown", () => {
    expect(
      filterSubstringSuggestions(
        ["Alternative", "Alternative Rock"],
        "Alternative",
      ),
    ).toEqual(["Alternative Rock"]);
    expect(filterSubstringSuggestions(["Alternative"], "Alternative")).toEqual([]);
    expect(filterSubstringSuggestions(["Alternative"], "alternative")).toEqual([]);
  });

  it("applies exclude and limit options", () => {
    expect(
      filterSubstringSuggestions(suggestions, "", {
        exclude: (s) => s === "Pop",
        limit: 1,
      }),
    ).toEqual(["Rock"]);
  });
});
