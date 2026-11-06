import { describe, expect, it } from "vitest";
import { expandShots, resolveScene } from "./stageScenes.mjs";

const scenes = {
  "theme-base": {
    name: "theme-base",
    base: true,
    window: { width: 1000, height: 700 },
    app: { theme: "noir", playback: { state: "playing", positionSeconds: 58 } },
  },
  themes: {
    name: "themes",
    extends: "theme-base",
    matrix: { "app.theme": ["spiral.theme.noir", "Sprig Dark"] },
    publish: { slot: "theme.{theme}" },
  },
};

describe("resolveScene", () => {
  it("merges the parent and drops inherit-only markers", () => {
    const scene = resolveScene("themes", scenes);
    expect(scene.window).toEqual({ width: 1000, height: 700 });
    expect(scene.app.playback.positionSeconds).toBe(58);
    expect(scene.base).toBeUndefined();
    expect(scene.extends).toBeUndefined();
  });

  it("overrides nested values without losing siblings", () => {
    const withOverride = {
      ...scenes,
      child: {
        name: "child",
        extends: "theme-base",
        app: { playback: { positionSeconds: 5 } },
      },
    };
    const scene = resolveScene("child", withOverride);
    expect(scene.app.playback).toEqual({
      state: "playing",
      positionSeconds: 5,
    });
  });

  it("rejects cycles and unknown parents", () => {
    expect(() =>
      resolveScene("a", {
        a: { name: "a", extends: "b" },
        b: { name: "b", extends: "a" },
      }),
    ).toThrow(/cycle/);
    expect(() => resolveScene("nope", {})).toThrow(/unknown scene/);
  });
});

describe("expandShots", () => {
  it("yields one shot per matrix value with slots filled in", () => {
    const shots = expandShots(resolveScene("themes", scenes));
    expect(shots.map((s) => s.app.theme)).toEqual([
      "spiral.theme.noir",
      "Sprig Dark",
    ]);
    expect(shots.map((s) => s.publish.slot)).toEqual([
      "theme.noir",
      "theme.Sprig Dark",
    ]);
    expect(shots.map((s) => s.variant)).toEqual([
      "themes--noir",
      "themes--sprig-dark",
    ]);
    expect(shots[0].matrix).toBeUndefined();
  });

  it("returns a single shot when there is no matrix", () => {
    const shots = expandShots({ name: "hero", app: {} });
    expect(shots).toHaveLength(1);
    expect(shots[0].variant).toBe("hero");
  });
});
