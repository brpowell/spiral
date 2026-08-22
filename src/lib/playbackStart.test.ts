import { beforeEach, describe, expect, it, vi } from "vitest";
import { playOrResume } from "./playbackStart";
import { SKIN_PLAYLIST_SOURCE_UP_NEXT } from "./skinPlaylist";
import { usePlayerStore } from "../store/usePlayerStore";
import { usePlaylistStore } from "../store/usePlaylistStore";
import { useSkinStore } from "../store/useSkinStore";
import type { Playlist } from "../types/playlist";
import type { Track } from "../types/track";

function track(
  id: number,
  title: string,
  overrides: Partial<Track> = {},
): Track {
  return {
    id,
    title,
    artist: null,
    album: null,
    albumArtist: null,
    trackNumber: null,
    totalTracks: null,
    discNumber: null,
    totalDiscs: null,
    year: null,
    genre: null,
    durationSeconds: 180,
    filePath: `/music/${id}.mp3`,
    artPath: null,
    dateAdded: "2024-01-01",
    playCount: 0,
    lastPlayedAt: null,
    rating: 0,
    ...overrides,
  };
}

function playlist(id: number, title: string, trackIds: number[]): Playlist {
  return {
    id,
    title,
    description: null,
    trackIds,
    imageMode: "generated",
    customImagePath: null,
    createdAt: "2024-01-01",
    updatedAt: "2024-01-01",
    lastUsedAt: "2024-01-01",
  };
}

describe("playbackStart", () => {
  const playTracks = vi.fn(async () => {});
  const resume = vi.fn();

  beforeEach(() => {
    playTracks.mockReset();
    resume.mockReset();
    usePlayerStore.setState({
      library: [track(1, "B"), track(2, "A"), track(3, "C")],
      playContextIds: [],
      manualQueueIds: [],
      currentTrackId: null,
      currentPlayable: null,
      playbackTracks: [],
      cdQueueContext: null,
      playbackState: "stopped",
      playTracks,
      resume,
    });
    usePlaylistStore.setState({ playlists: [] });
    useSkinStore.setState({ playlistSourceId: "all" });
  });

  it("starts all tracks from the first title when the set list is empty", () => {
    playOrResume();
    expect(playTracks).toHaveBeenCalledWith([2, 1, 3], 2);
  });

  it("starts the selected playlist when that source has tracks", () => {
    useSkinStore.setState({ playlistSourceId: "playlist:9" });
    usePlaylistStore.setState({
      playlists: [playlist(9, "Mix", [3, 1])],
    });

    playOrResume();
    expect(playTracks).toHaveBeenCalledWith([3, 1], 3);
  });

  it("falls back to all tracks when Up Next is empty after stop", () => {
    useSkinStore.setState({ playlistSourceId: SKIN_PLAYLIST_SOURCE_UP_NEXT });

    playOrResume();
    expect(playTracks).toHaveBeenCalledWith([2, 1, 3], 2);
  });

  it("skips tracks already flagged unplayable when choosing a start id", () => {
    usePlayerStore.setState({
      library: [
        track(1, "B"),
        track(2, "A", { missingFile: true }),
        track(3, "C"),
      ],
    });

    playOrResume();
    expect(playTracks).toHaveBeenCalledWith([2, 1, 3], 1);
  });

  it("resumes a paused current track", () => {
    usePlayerStore.setState({
      currentTrackId: 1,
      playbackState: "paused",
    });

    playOrResume();
    expect(resume).toHaveBeenCalledOnce();
    expect(playTracks).not.toHaveBeenCalled();
  });
});
