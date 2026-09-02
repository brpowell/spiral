import { describe, expect, it } from "vitest";
import { resolveNodeBounds } from "./skinBoundsWhen";
import { evaluateSkinCondition } from "./skinBinds";
import { minimalBindState } from "../test/skinBindFixtures";

describe("resolveNodeBounds", () => {
  it("applies view-state boundsWhen conditions", () => {
    const bounds = {
      x: 156,
      y: 166,
      w: 17,
      h: 13,
      zIndex: 9,
    };

    const collapsed = resolveNodeBounds(
      bounds,
      { "state.visMode.effects": { y: 146 } },
      (path) =>
        Boolean(
          evaluateSkinCondition(
            path,
            minimalBindState({ viewState: { visMode: "gif" } }),
          ),
        ),
    );
    expect(collapsed?.y).toBe(166);

    const expanded = resolveNodeBounds(
      bounds,
      { "state.visMode.effects": { y: 146 } },
      (path) =>
        Boolean(
          evaluateSkinCondition(
            path,
            minimalBindState({ viewState: { visMode: "effects" } }),
          ),
        ),
    );
    expect(expanded?.y).toBe(146);
  });

  it("applies hover bind boundsWhen conditions", () => {
    const bounds = { x: 0, y: -40, w: 100, h: 40 };
    const hidden = resolveNodeBounds(
      bounds,
      { "hover.menu": { y: 0 } },
      (path) => Boolean(evaluateSkinCondition(path, minimalBindState())),
    );
    expect(hidden?.y).toBe(-40);

    const shown = resolveNodeBounds(
      bounds,
      { "hover.menu": { y: 0 } },
      (path) =>
        Boolean(
          evaluateSkinCondition(
            path,
            minimalBindState({ hoveredNodeIds: new Set(["menu"]) }),
          ),
        ),
    );
    expect(shown?.y).toBe(0);
  });
});
