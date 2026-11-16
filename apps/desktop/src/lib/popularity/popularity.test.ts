import { describe, expect, it } from "vitest";
import {
  aggregateScores,
  popularityFraction,
  rankByScore,
  toTrackScores,
} from "./popularity";

describe("popularityFraction", () => {
  it("is 0 without a score or without a reference", () => {
    expect(popularityFraction(0, 10)).toBe(0);
    expect(popularityFraction(-2, 10)).toBe(0);
    expect(popularityFraction(5, 0)).toBe(0);
  });

  it("reaches 1 at the top score and never exceeds it", () => {
    expect(popularityFraction(10, 10)).toBe(1);
    expect(popularityFraction(40, 10)).toBe(1);
  });

  it("eases with a square root so mid-range tracks stay visible", () => {
    expect(popularityFraction(2.5, 10)).toBeCloseTo(0.5);
    expect(popularityFraction(1, 100)).toBeCloseTo(0.1);
  });
});

const tracks = (...ids: number[]) => ids.map((id) => ({ id }));

describe("toTrackScores", () => {
  it("indexes rows by track id", () => {
    const scores = toTrackScores([
      { trackId: 1, score: 3 },
      { trackId: 2, score: 0.5 },
    ]);
    expect(scores.get(1)).toBe(3);
    expect(scores.get(2)).toBe(0.5);
    expect(scores.get(3)).toBeUndefined();
  });
});

describe("aggregateScores", () => {
  const scores = toTrackScores([
    { trackId: 1, score: 4 },
    { trackId: 2, score: 9 },
    { trackId: 3, score: 1 },
  ]);

  it("returns 0 for an empty group", () => {
    expect(aggregateScores([], scores)).toBe(0);
  });

  it("sums, easing each track with sqrt by default", () => {
    // sqrt(4) + sqrt(9) + sqrt(1) = 6; track 4 is unscored.
    expect(aggregateScores(tracks(1, 2, 3, 4), scores)).toBe(6);
  });

  it("supports no compression and log compression", () => {
    expect(
      aggregateScores(tracks(1, 2, 3), scores, { compression: "none" }),
    ).toBe(14);
    expect(
      aggregateScores(tracks(3), scores, { compression: "log" }),
    ).toBeCloseTo(Math.log(2));
  });

  it("means over every track in the group, unplayed included", () => {
    // (2 + 3 + 1 + 0) / 4
    expect(
      aggregateScores(tracks(1, 2, 3, 4), scores, { strategy: "mean" }),
    ).toBe(1.5);
  });

  it("sums only the top n tracks", () => {
    // sqrt(9) + sqrt(4)
    expect(
      aggregateScores(tracks(1, 2, 3), scores, { strategy: "top", n: 2 }),
    ).toBe(5);
  });

  it("does not let a big, lightly played catalog beat a small hot one with top-n", () => {
    const catalog = tracks(...Array.from({ length: 50 }, (_, i) => 100 + i));
    const catalogScores = toTrackScores(
      catalog.map((t) => ({ trackId: t.id, score: 1 })),
    );
    const hot = tracks(1);
    const combined = new Map([...catalogScores, ...scores]);

    const sumCatalog = aggregateScores(catalog, combined, { strategy: "sum" });
    const topCatalog = aggregateScores(catalog, combined, {
      strategy: "top",
      n: 3,
    });
    const hotScore = aggregateScores(hot, combined, { strategy: "sum" });

    expect(sumCatalog).toBeGreaterThan(hotScore);
    expect(topCatalog).toBeGreaterThan(hotScore);
    expect(topCatalog).toBe(3);
  });

  it("treats non-positive scores as no signal", () => {
    const odd = toTrackScores([{ trackId: 1, score: -5 }]);
    expect(aggregateScores(tracks(1), odd)).toBe(0);
  });
});

describe("rankByScore", () => {
  it("orders by score, drops zero scores, and keeps input order on ties", () => {
    const items = ["a", "b", "c", "d", "e"];
    const value: Record<string, number> = { a: 1, b: 0, c: 3, d: 1, e: 2 };
    const ranked = rankByScore(items, (item) => value[item]);
    expect(ranked.map((r) => r.item)).toEqual(["c", "e", "a", "d"]);
    expect(ranked[0].score).toBe(3);
  });

  it("returns an empty list when nothing has a signal", () => {
    expect(rankByScore(["a"], () => 0)).toEqual([]);
  });
});
