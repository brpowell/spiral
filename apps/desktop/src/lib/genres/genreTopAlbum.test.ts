import { describe, expect, it } from "vitest";
import type { Track } from "@/types/track";
import { topAlbumForGenre } from "./genreTopAlbum";

let nextId = 1;
function track(album: string, artPath: string | null, id = nextId++): Track {
  return {
    id,
    title: `t${id}`,
    artist: "A",
    album,
    albumArtist: "A",
    artPath,
    genre: "Rock",
  } as Track;
}

describe("topAlbumForGenre", () => {
  it("picks the album with the most listening among the genre's tracks", () => {
    const a1 = track("Alpha", "a.jpg");
    const a2 = track("Alpha", "a.jpg");
    const b1 = track("Beta", "b.jpg");
    const scores = new Map([
      [a1.id, 1],
      [a2.id, 1],
      [b1.id, 10],
    ]);
    const top = topAlbumForGenre({ tracks: [a1, a2, b1] }, scores);
    expect(top?.title).toBe("Beta");
  });

  it("ignores popular albums that have no artwork", () => {
    const loud = track("Loud", null);
    const quiet = track("Quiet", "q.jpg");
    const scores = new Map([
      [loud.id, 100],
      [quiet.id, 1],
    ]);
    expect(topAlbumForGenre({ tracks: [loud, quiet] }, scores)?.title).toBe(
      "Quiet",
    );
  });

  it("falls back to the largest album when nothing has been played", () => {
    const tracks = [
      track("Small", "s.jpg"),
      track("Big", "b.jpg"),
      track("Big", "b.jpg"),
    ];
    const top = topAlbumForGenre({ tracks }, new Map());
    expect(top?.title).toBe("Big");
  });

  it("is null when no album has artwork", () => {
    expect(
      topAlbumForGenre({ tracks: [track("X", null)] }, new Map()),
    ).toBeNull();
    expect(topAlbumForGenre({ tracks: [] }, new Map())).toBeNull();
  });
});
