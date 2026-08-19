import { describe, expect, it } from "vitest";
import { resolveNodeBounds } from "./skinBoundsWhen";

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
      { "view.visMode.effects": { y: 146 } },
      { visMode: "gif" },
    );
    expect(collapsed?.y).toBe(166);

    const expanded = resolveNodeBounds(
      bounds,
      { "view.visMode.effects": { y: 146 } },
      { visMode: "effects" },
    );
    expect(expanded?.y).toBe(146);
  });
});
