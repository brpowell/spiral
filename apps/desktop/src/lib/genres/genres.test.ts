import { describe, expect, it } from "vitest";
import type { Track } from "@/types/track";
import {
  findMergeTarget,
  genreRenameNeeded,
  getGenreByKey,
  groupTracksIntoGenres,
  normalizeGenreName,
} from "./genres";

const track = (id: number, genre: string | null) => ({ id, genre }) as Track;

describe("groupTracksIntoGenres", () => {
  it("groups case-insensitively and sorts by name", () => {
    const genres = groupTracksIntoGenres([
      track(1, "Rock"),
      track(2, "jazz"),
      track(3, "rock "),
      track(4, "Rock"),
    ]);
    expect(genres.map((g) => [g.name, g.tracks.length])).toEqual([
      ["jazz", 1],
      ["Rock", 3],
    ]);
  });

  it("skips tracks without a genre", () => {
    expect(
      groupTracksIntoGenres([track(1, null), track(2, "  "), track(3, "")]),
    ).toEqual([]);
  });
});

describe("getGenreByKey", () => {
  it("finds a genre by its key", () => {
    const genres = groupTracksIntoGenres([track(1, "Rock"), track(2, "Jazz")]);
    expect(getGenreByKey(genres, "jazz")?.name).toBe("Jazz");
    expect(getGenreByKey(genres, "folk")).toBeUndefined();
  });
});

describe("normalizeGenreName", () => {
  it("trims and maps blank to null", () => {
    expect(normalizeGenreName("  Folk ")).toBe("Folk");
    expect(normalizeGenreName("   ")).toBeNull();
  });
});

describe("genreRenameNeeded", () => {
  const [rock] = groupTracksIntoGenres([track(1, "rock"), track(2, "Rock")]);

  it("is true when any track spelling differs from the new name", () => {
    expect(genreRenameNeeded(rock, "Rock")).toBe(true);
    expect(genreRenameNeeded(rock, "Blues")).toBe(true);
  });

  it("is false when every track already has exactly that name", () => {
    const [same] = groupTracksIntoGenres([track(1, "Rock"), track(2, "Rock")]);
    expect(genreRenameNeeded(same, " Rock ")).toBe(false);
  });
});

describe("findMergeTarget", () => {
  const genres = groupTracksIntoGenres([
    track(1, "Rock"),
    track(2, "Electronic"),
    track(3, "Acid Techno"),
  ]);

  it("finds another genre by case-insensitive name", () => {
    expect(findMergeTarget(genres, "acid techno", " electronic ")?.name).toBe(
      "Electronic",
    );
  });

  it("ignores the genre's own name, blanks and unknown names", () => {
    expect(findMergeTarget(genres, "rock", "ROCK")).toBeUndefined();
    expect(findMergeTarget(genres, "rock", "  ")).toBeUndefined();
    expect(findMergeTarget(genres, "rock", "Folk")).toBeUndefined();
  });
});
