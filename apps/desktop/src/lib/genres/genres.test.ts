import { describe, expect, it } from "vitest";
import type { Track } from "@/types/track";
import { groupTracksIntoGenres } from "./genres";

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
