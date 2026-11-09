import { describe, expect, it } from "vitest";
import {
  alphaMapFromRgba,
  clientPointToImagePixel,
  cssColorIsVisible,
  isOpaqueArtworkAlpha,
  isPointOverSkinWindowHit,
  resolveSkinWindowHitKind,
} from "./skinWindowHit";

describe("resolveSkinWindowHitKind", () => {
  it("treats decorations as artwork, subviews as groups, and everything else as controls", () => {
    expect(
      resolveSkinWindowHitKind({
        type: "decoration",
        presentation: { kind: "bitmap", assets: { default: "head.png" } },
      }),
    ).toBe("artwork");
    expect(
      resolveSkinWindowHitKind({
        type: "subview",
        bounds: { x: 0, y: 0, w: 10, h: 10 },
        children: [],
      }),
    ).toBe("group");
    expect(
      resolveSkinWindowHitKind({
        type: "button",
        onClick: [{ action: "player.play" }],
        presentation: { kind: "bitmap", assets: { default: "play.png" } },
      }),
    ).toBe("control");
    expect(
      resolveSkinWindowHitKind({
        type: "buttonGroup",
        presentation: {
          kind: "buttonGroup",
          positionMap: "map.png",
          elements: [],
          assets: { default: "transport.png" },
        },
      }),
    ).toBe("control");
  });
});

describe("clientPointToImagePixel", () => {
  const rect = { left: 10, top: 20, right: 30, bottom: 40 };

  it("maps the box onto image pixels", () => {
    expect(clientPointToImagePixel(rect, 10, 10, 10, 20)).toEqual({
      x: 0,
      y: 0,
    });
    expect(clientPointToImagePixel(rect, 10, 10, 29.9, 39.9)).toEqual({
      x: 9,
      y: 9,
    });
  });

  it("returns null outside the box", () => {
    expect(clientPointToImagePixel(rect, 10, 10, 9, 20)).toBeNull();
    expect(clientPointToImagePixel(rect, 10, 10, 30, 20)).toBeNull();
  });
});

describe("isOpaqueArtworkAlpha", () => {
  it("treats low-alpha pixels as holes", () => {
    const rgba = new Uint8ClampedArray([
      0, 255, 0, 0, 0, 255, 0, 15, 0, 255, 0, 16, 0, 255, 0, 255,
    ]);
    const map = alphaMapFromRgba(rgba, 4, 1);
    expect(isOpaqueArtworkAlpha(map, 0, 0)).toBe(false);
    expect(isOpaqueArtworkAlpha(map, 1, 0)).toBe(false);
    expect(isOpaqueArtworkAlpha(map, 2, 0)).toBe(true);
    expect(isOpaqueArtworkAlpha(map, 3, 0)).toBe(true);
  });
});

describe("isPointOverSkinWindowHit", () => {
  const head = { left: 100, top: 0, right: 300, bottom: 400 };
  const eq = { left: 0, top: 80, right: 180, bottom: 250 };
  const ears = { left: 0, top: 80, right: 80, bottom: 250 };

  it("click-throughs transparent artwork holes", () => {
    expect(
      isPointOverSkinWindowHit(110, 10, [
        { kind: "artwork", rect: head, opaque: false },
      ]),
    ).toBe(false);
  });

  it("keeps the window interactive on opaque artwork", () => {
    expect(
      isPointOverSkinWindowHit(180, 200, [
        { kind: "artwork", rect: head, opaque: true },
      ]),
    ).toBe(true);
  });

  it("ignores empty grouping subviews covering the same box", () => {
    expect(
      isPointOverSkinWindowHit(20, 90, [
        { kind: "group", rect: ears, paints: false },
        { kind: "artwork", rect: ears, opaque: false },
      ]),
    ).toBe(false);
  });

  it("treats a painted grouping subview as solid", () => {
    expect(
      isPointOverSkinWindowHit(40, 120, [
        { kind: "group", rect: eq, paints: true },
      ]),
    ).toBe(true);
  });

  it("treats control boxes as solid even over transparent art", () => {
    expect(
      isPointOverSkinWindowHit(320, 40, [
        { kind: "artwork", rect: head, opaque: false },
        {
          kind: "control",
          rect: { left: 310, top: 30, right: 450, bottom: 55 },
        },
      ]),
    ).toBe(true);
  });
});

describe("cssColorIsVisible", () => {
  it("rejects transparent fills", () => {
    expect(cssColorIsVisible("transparent")).toBe(false);
    expect(cssColorIsVisible("rgba(0, 0, 0, 0)")).toBe(false);
    expect(cssColorIsVisible("#285f03")).toBe(true);
    expect(cssColorIsVisible("rgb(40, 95, 3)")).toBe(true);
  });
});
