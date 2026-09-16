import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Track } from "../types/track";

const { mockGetLibrary, mockGetPlaybackSession } = vi.hoisted(() => ({
  mockGetLibrary: vi.fn(),
  mockGetPlaybackSession: vi.fn(),
}));

vi.mock("../lib/tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/tauri")>();
  return {
    ...actual,
    getLibrary: mockGetLibrary,
    getPlaybackSession: mockGetPlaybackSession,
  };
});

import * as audio from "../lib/playback";
import { usePlayerStore } from "./usePlayerStore";

function makeTrack(overrides: Partial<Track> = {}): Track {
  return {
    id: 1,
    title: "Now Playing",
    artist: "Artist",
    album: "Album",
    albumArtist: "Artist",
    trackNumber: 1,
    totalTracks: null,
    discNumber: 1,
    totalDiscs: null,
    year: 2020,
    genre: null,
    durationSeconds: 180,
    filePath: "/music/now-playing.flac",
    artPath: null,
    dateAdded: "2026-01-01T00:00:00.000Z",
    playCount: 0,
    lastPlayedAt: null,
    rating: 0,
    ...overrides,
  };
}

describe("loadLibrary playback preservation", () => {
  const playing = makeTrack();
  const importedCdTrack = makeTrack({
    id: 10,
    title: "CD Track 1",
    album: "Imported CD",
    filePath: "/music/cd-track-1.flac",
  });

  let loadSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    loadSpy = vi.spyOn(audio, "load").mockResolvedValue(undefined);
    vi.spyOn(audio, "getDurationSeconds").mockReturnValue(180);
    vi.spyOn(audio, "seek").mockReturnValue(undefined);
    vi.spyOn(audio, "unload").mockReturnValue(undefined);
    vi.spyOn(audio, "play").mockReturnValue(undefined);

    mockGetLibrary.mockReset();
    mockGetPlaybackSession.mockReset();

    usePlayerStore.setState({
      library: [playing],
      playContextIds: [playing.id],
      manualQueueIds: [],
      currentTrackId: playing.id,
      currentPlayable: { type: "library", trackId: playing.id },
      cdDriveId: null,
      playbackTracks: [],
      playbackState: "playing",
      positionSeconds: 42,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not restore the startup session over live playback", async () => {
    mockGetLibrary.mockResolvedValue([playing, importedCdTrack]);
    mockGetPlaybackSession.mockResolvedValue({
      playContextIds: [importedCdTrack.id],
      manualQueueIds: [],
      currentTrackId: importedCdTrack.id,
      positionSeconds: 0,
      shuffle: false,
      repeatMode: "off",
    });

    await usePlayerStore.getState().loadLibrary({ preservePlayback: true });

    const state = usePlayerStore.getState();
    expect(state.currentTrackId).toBe(playing.id);
    expect(state.currentPlayable).toEqual({
      type: "library",
      trackId: playing.id,
    });
    expect(state.playbackState).toBe("playing");
    expect(state.playContextIds).toEqual([playing.id]);
    expect(state.library.map((track) => track.id)).toEqual([
      playing.id,
      importedCdTrack.id,
    ]);
    expect(loadSpy).not.toHaveBeenCalled();
    expect(mockGetPlaybackSession).not.toHaveBeenCalled();
  });

  it("startup restore still applies the saved session when playback is not preserved", async () => {
    mockGetLibrary.mockResolvedValue([playing, importedCdTrack]);
    mockGetPlaybackSession.mockResolvedValue({
      playContextIds: [importedCdTrack.id],
      manualQueueIds: [],
      currentTrackId: importedCdTrack.id,
      positionSeconds: 0,
      shuffle: false,
      repeatMode: "off",
    });

    await usePlayerStore.getState().loadLibrary();

    const state = usePlayerStore.getState();
    expect(state.currentTrackId).toBe(importedCdTrack.id);
    expect(state.playbackState).toBe("paused");
    expect(loadSpy).toHaveBeenCalledWith(importedCdTrack.filePath);
  });
});
