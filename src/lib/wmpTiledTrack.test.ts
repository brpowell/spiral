import { describe, expect, it } from "vitest";
import { wmpTiledTrackStyle, wmpTiledTrackUsesSlicing } from "./wmpTiledTrack";

const headspaceEq = {
  trackTileWidth: 11,
  trackTileHeight: 15,
  trackWidth: 14,
  trackHeight: 76,
  borderSize: 7,
};

describe("wmpTiledTrackUsesSlicing", () => {
  it("enables slicing for Headspace EQ tile dimensions", () => {
    expect(wmpTiledTrackUsesSlicing(headspaceEq)).toBe(true);
  });

  it("disables slicing when tile already matches control height", () => {
    expect(
      wmpTiledTrackUsesSlicing({
        ...headspaceEq,
        trackTileHeight: 76,
      }),
    ).toBe(false);
  });

  it("disables slicing when borderSize consumes the tile", () => {
    expect(
      wmpTiledTrackUsesSlicing({
        ...headspaceEq,
        borderSize: 8,
      }),
    ).toBe(false);
  });
});

describe("wmpTiledTrackStyle", () => {
  it("uses border-image 3-slice for tiled vertical tracks", () => {
    const style = wmpTiledTrackStyle({
      trackUrl: "/assets/sliders/eq-track-tile.png",
      ...headspaceEq,
    });

    expect(style.borderImageSlice).toBe("7 0 7 0 fill");
    expect(style.borderImageRepeat).toBe("stretch repeat");
    expect(style.backgroundSize).toBeUndefined();
  });

  it("stretches a full-size track asset when no slicing applies", () => {
    const style = wmpTiledTrackStyle({
      trackUrl: "/assets/sliders/eq-track-tile.png",
      ...headspaceEq,
      trackTileHeight: 76,
      borderSize: 0,
    });

    expect(style.backgroundSize).toBe("14px 76px");
    expect(style.borderImageSource).toBeUndefined();
  });
});
