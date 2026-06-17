import { describe, expect, it } from "vitest";
import { resolveLayout } from "./types";

describe("resolveLayout", () => {
  it("fills the viewport", () => {
    expect(resolveLayout("fill", 200, 100)).toEqual({
      x: 0,
      y: 0,
      w: 200,
      h: 100,
    });
  });

  it("maps normalized rects to pixels", () => {
    expect(resolveLayout({ x: 0.1, y: 0.2, w: 0.5, h: 0.3 }, 100, 200)).toEqual({
      x: 10,
      y: 40,
      w: 50,
      h: 60,
    });
  });

  it("anchors centered layers", () => {
    expect(
      resolveLayout({ anchor: "center", w: 0.5, h: 0.25 }, 200, 100),
    ).toEqual({ x: 50, y: 37.5, w: 100, h: 25 });
  });
});
