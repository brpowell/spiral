import { describe, expect, it } from "vitest";
import {
  BROWSE_GRID_MIN_COL_PX,
  BROWSE_GRID_TEXT_BLOCK_FALLBACK_PX,
  browseGridColumnCount,
  browseGridColumnWidth,
  browseGridRowCount,
  browseGridRowHeight,
  parseGridTemplateTracks,
} from "./browseGridLayout";

describe("browseGridColumnCount", () => {
  it("matches CSS auto-fill for a typical content box", () => {
    // 800px, 160px min, 20px gap → 4 columns (5th would need 880px)
    expect(browseGridColumnCount(800, BROWSE_GRID_MIN_COL_PX, 20)).toBe(4);
  });

  it("fits another column when leftover equals min + gap", () => {
    // 4*160 + 3*20 = 700; +160+20 = 880
    expect(browseGridColumnCount(880, BROWSE_GRID_MIN_COL_PX, 20)).toBe(5);
  });

  it("returns at least one column when the box is narrower than min", () => {
    expect(browseGridColumnCount(100, BROWSE_GRID_MIN_COL_PX, 20)).toBe(1);
  });

  it("returns one column for empty or invalid widths", () => {
    expect(browseGridColumnCount(0, BROWSE_GRID_MIN_COL_PX, 20)).toBe(1);
    expect(browseGridColumnCount(800, 0, 20)).toBe(1);
  });
});

describe("browseGridColumnWidth", () => {
  it("distributes leftover space across columns", () => {
    expect(browseGridColumnWidth(800, 4, 20)).toBe(185);
  });

  it("uses the full width for a single column", () => {
    expect(browseGridColumnWidth(400, 1, 20)).toBe(400);
  });
});

describe("browseGridRowCount", () => {
  it("rounds up a partial last row", () => {
    expect(browseGridRowCount(10, 4)).toBe(3);
  });

  it("is zero when there are no items", () => {
    expect(browseGridRowCount(0, 4)).toBe(0);
  });
});

describe("browseGridRowHeight", () => {
  it("adds the square art to the text block", () => {
    expect(browseGridRowHeight(185, BROWSE_GRID_TEXT_BLOCK_FALLBACK_PX)).toBe(
      185 + BROWSE_GRID_TEXT_BLOCK_FALLBACK_PX,
    );
  });
});

describe("parseGridTemplateTracks", () => {
  it("reads space-separated used values", () => {
    expect(parseGridTemplateTracks("185px 185px 185px 185px")).toEqual({
      count: 4,
      firstTrackPx: 185,
    });
  });

  it("reads a computed repeat() serialization", () => {
    expect(parseGridTemplateTracks("repeat(3, 160px)")).toEqual({
      count: 3,
      firstTrackPx: 160,
    });
  });

  it("returns null for none/empty", () => {
    expect(parseGridTemplateTracks("none")).toBeNull();
    expect(parseGridTemplateTracks("")).toBeNull();
  });

  it("returns null for unresolved auto-fill templates", () => {
    expect(
      parseGridTemplateTracks("repeat(auto-fill, minmax(160px, 1fr))"),
    ).toBeNull();
  });
});
