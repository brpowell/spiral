import { describe, expect, it } from "vitest";
import { resolveNodeTransition } from "./skinTransition";

describe("resolveNodeTransition", () => {
  it("keeps resting transition when no transitionWhen matches", () => {
    expect(
      resolveNodeTransition(
        { durationMs: 400, easing: "linear" },
        { "view.intro.showing": { durationMs: 0 } },
        () => false,
      ),
    ).toEqual({ durationMs: 400, easing: "linear" });
  });

  it("applies the last matching transitionWhen overlay", () => {
    expect(
      resolveNodeTransition(
        { durationMs: 400, easing: "linear" },
        {
          "view.intro.showing": { durationMs: 0 },
          "view.intro.revealed": { durationMs: 250, easing: "ease-out" },
        },
        (path) =>
          path === "view.intro.showing" || path === "view.intro.revealed",
      ),
    ).toEqual({ durationMs: 250, easing: "ease-out" });
  });

  it("snaps when a matching overlay sets durationMs 0", () => {
    expect(
      resolveNodeTransition(
        { durationMs: 1000, easing: "linear" },
        { "view.intro.showing": { durationMs: 0 } },
        (path) => path === "view.intro.showing",
      ),
    ).toEqual({ durationMs: 0, easing: "linear" });
  });

  it("applies list-form transitionWhen rows in order", () => {
    expect(
      resolveNodeTransition(
        { durationMs: 600, easing: "linear" },
        [
          { when: "view.galleryPhase.grid", durationMs: 600 },
          {
            when: { all: ["view.galleryPhase.grid", "hover.thumb1"] },
            durationMs: 100,
          },
        ],
        (condition) => {
          if (condition === "view.galleryPhase.grid") return true;
          return (
            typeof condition === "object" &&
            condition !== null &&
            "all" in condition
          );
        },
      ),
    ).toEqual({ durationMs: 100, easing: "linear" });
  });
});
