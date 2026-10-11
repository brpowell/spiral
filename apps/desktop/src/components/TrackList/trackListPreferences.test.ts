import { describe, expect, it } from "vitest";
import {
  columnIdsForPreset,
  defaultTrackListPreferences,
  hiddenColumnIdsForPreset,
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
      "lastPlayedAt",
      "rating",
      "codec",
      "sampleRate",
      "bitrate",
      "lyrics",
      "duration",
    ]);
  });

  it("returns the same default columns for playlist as library", () => {
    const prefs = defaultTrackListPreferences();
    expect(columnIdsForPreset("playlist", prefs)).toEqual(
      columnIdsForPreset("library", prefs),
    );
  });

  it("returns library columns for album except album and index", () => {
    const prefs = defaultTrackListPreferences();
    const albumColumnIds = columnIdsForPreset("album", prefs);
    const libraryColumnIds = columnIdsForPreset("library", prefs);
    expect(albumColumnIds).not.toContain("album");
    expect(albumColumnIds).not.toContain("index");
    expect(albumColumnIds[0]).toBe("trackNumber");
    expect(albumColumnIds).toEqual([
      "trackNumber",
      ...libraryColumnIds.filter(
        (id) => id !== "index" && id !== "album" && id !== "trackNumber",
      ),
    ]);
  });

  it("keeps hidden columns separate per preset", () => {
    const prefs = {
      ...defaultTrackListPreferences(),
      hiddenColumnsByPreset: {
        library: ["album", "year"],
        playlist: ["artist", "genre"],
      },
    };
    expect(hiddenColumnIdsForPreset("library", prefs)).toEqual(["album", "year"]);
    expect(hiddenColumnIdsForPreset("playlist", prefs)).toEqual([
      "artist",
      "genre",
    ]);
  });

  it("falls back to preset defaults when no saved hidden columns exist", () => {
    const prefs = defaultTrackListPreferences();
    expect(hiddenColumnIdsForPreset("library", prefs)).not.toContain("album");
    expect(hiddenColumnIdsForPreset("playlist", prefs)).toContain("album");
    expect(hiddenColumnIdsForPreset("album", prefs)).not.toContain("album");
    expect(hiddenColumnIdsForPreset("album", prefs)).not.toContain(
      "trackNumber",
    );
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
      "lastPlayedAt",
      "rating",
      "codec",
      "sampleRate",
      "bitrate",
      "lyrics",
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
