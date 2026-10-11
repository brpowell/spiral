import { describe, expect, it } from "vitest";
import {
  boundedEditDistance,
  createFuzzyMatcher,
  normalizeSearchText,
} from "./fuzzySearch";

interface Item {
  name: string;
  extra?: string;
}
const m = createFuzzyMatcher<Item>((i) => [i.name, i.extra]);
const hit = (name: string, q: string) => m.matches({ name }, q);

describe("normalizeSearchText", () => {
  it("strips diacritics, case and punctuation", () => {
    expect(normalizeSearchText("  Beyoncé — Déjà Vu! ")).toBe(
      "beyonce deja vu",
    );
    expect(normalizeSearchText("AC/DC")).toBe("ac dc");
  });
});

describe("boundedEditDistance", () => {
  it("counts edits and transpositions", () => {
    expect(boundedEditDistance("beatles", "beatles", 2)).toBe(0);
    expect(boundedEditDistance("beatels", "beatles", 2)).toBe(1);
    expect(boundedEditDistance("beatls", "beatles", 2)).toBe(1);
    expect(boundedEditDistance("abcdef", "uvwxyz", 2)).toBe(3);
  });
});

describe("fuzzy matching", () => {
  it("keeps substring behaviour", () => {
    expect(hit("Dark Side of the Moon", "side of")).toBe(true);
    expect(hit("Dark Side of the Moon", "moo")).toBe(true);
  });
  it("is diacritic and punctuation insensitive", () => {
    expect(hit("Beyoncé", "beyonce")).toBe(true);
    expect(hit("AC/DC", "acdc")).toBe(true);
    expect(hit("Mötley Crüe", "motley crue")).toBe(true);
  });
  it("tolerates typos and transpositions", () => {
    expect(hit("The Beatles", "beatels")).toBe(true);
    expect(hit("Radiohead", "radiohed")).toBe(true);
    expect(hit("Radiohead", "radoihead")).toBe(true);
  });
  it("matches partially typed misspellings", () => {
    expect(hit("The Beatles", "beatlz")).toBe(true);
    expect(hit("Fleetwood Mac", "fleatwo")).toBe(true);
  });
  it("matches across word boundaries", () => {
    expect(hit("Bon Jovi", "bonjovi")).toBe(true);
  });
  it("only matches across word boundaries for longer tokens", () => {
    expect(hit("Save Point Video Game", "tv")).toBe(false);
    expect(hit("Save Point Video Game", "tvo")).toBe(false);
    expect(hit("Bon Jovi", "bonjovi")).toBe(true);
  });
  it("requires every token and ignores token order", () => {
    expect(hit("Abbey Road", "road abbey")).toBe(true);
    expect(hit("Abbey Road", "abbey zzzzzz")).toBe(false);
  });
  it("does not fuzz short tokens or unrelated text", () => {
    expect(hit("Cat", "cut")).toBe(false);
    expect(hit("Radiohead", "metallica")).toBe(false);
  });
  it("empty query matches all", () => {
    expect(hit("x", "   ")).toBe(true);
  });
  it("ranks exact > prefix > fuzzy, stably", () => {
    const items = [
      { name: "Beatlez Tribute" },
      { name: "Beatlesque Forever" },
      { name: "The Beatles" },
      { name: "Unrelated" },
    ];
    expect(m.rank(items, "beatles").map((i) => i.name)).toEqual([
      "The Beatles",
      "Beatlesque Forever",
      "Beatlez Tribute",
    ]);
  });
});
