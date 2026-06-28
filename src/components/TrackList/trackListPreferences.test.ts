import { describe, expect, it } from "vitest";
import {
  columnIdsForPreset,
  defaultTrackListPreferences,
  reorderColumnIds,
} from "./trackListPreferences";

describe("columnIdsForPreset", () => {
  it("returns preset defaults when no saved order exists", () => {
    const prefs = defaultTrackListPreferences();
    expect(columnIdsForPreset("library", prefs)).toEqual([
      "index",
      "title",
      "artist",
      "album",
      "albumArtist",
      "year",
      "genre",
      "discNumber",
      "trackNumber",
      "dateAdded",
      "playCount",
      "rating",
      "duration",
    ]);
  });

  it("applies saved order and appends new columns", () => {
    const prefs = {
      ...defaultTrackListPreferences(),
      columnOrderByPreset: {
        library: ["index", "duration", "title", "artist"],
      },
    };
    expect(columnIdsForPreset("library", prefs)).toEqual([
      "index",
      "duration",
      "title",
      "artist",
      "album",
      "albumArtist",
      "year",
      "genre",
      "discNumber",
      "trackNumber",
      "dateAdded",
      "playCount",
      "rating",
    ]);
  });
});

describe("reorderColumnIds", () => {
  const order = ["index", "title", "artist", "album", "duration"];

  it("moves a column without changing the locked index column position", () => {
    expect(reorderColumnIds(order, "artist", "duration", "index")).toEqual([
      "index",
      "title",
      "album",
      "duration",
      "artist",
    ]);
  });

  it("refuses to move the locked index column", () => {
    expect(reorderColumnIds(order, "index", "title", "index")).toEqual(order);
    expect(reorderColumnIds(order, "title", "index", "index")).toEqual(order);
  });
});
