import { describe, expect, it } from "vitest";
import { findPlaybackTrack, indexPlaybackTracks } from "./playbackTrack";
import type { Track } from "../types/track";

function track(overrides: Partial<Track> & Pick<Track, "id">): Track {
  return {
    title: "Song",
    artist: "Artist",
    album: "Album",
    albumArtist: "Artist",
    trackNumber: 1,
    totalTracks: null,
    discNumber: 1,
    totalDiscs: null,
    year: null,
    genre: null,
    durationSeconds: 180,
    sampleRate: null,
    bitrate: null,
    codec: null,
    filePath: `/library/${overrides.id}.mp3`,
    artPath: null,
    dateAdded: "2024-01-01",
    playCount: 0,
    lastPlayedAt: null,
    rating: 0,
    ...overrides,
  };
}

describe("indexPlaybackTracks", () => {
  it("lets playback rows win over library rows with the same id", () => {
    const map = indexPlaybackTracks({
      library: [track({ id: 1, title: "Library" })],
      playbackTracks: [track({ id: 1, title: "Playback" })],
    });

    expect(map.get(1)?.title).toBe("Playback");
  });

  it("lets CD queue rows win over library, but not playback rows", () => {
    const map = indexPlaybackTracks({
      library: [track({ id: 1, title: "Library" })],
      playbackTracks: [track({ id: 2, title: "Playback" })],
      cdQueueTracks: [track({ id: 1, title: "CD" })],
    });

    expect(map.get(1)?.title).toBe("CD");
    expect(map.get(2)?.title).toBe("Playback");
  });
});

describe("findPlaybackTrack", () => {
  it("uses the same precedence as the index", () => {
    const found = findPlaybackTrack({
      library: [track({ id: 1, title: "Library" })],
      playbackTracks: [track({ id: 1, title: "Playback" })],
      currentTrackId: 1,
    });

    expect(found?.title).toBe("Playback");
  });

  it("returns undefined when nothing is playing", () => {
    expect(
      findPlaybackTrack({
        library: [track({ id: 1 })],
        playbackTracks: [],
        currentTrackId: null,
      }),
    ).toBeUndefined();
  });
});
