import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildLyricsFetchParamsForTrack,
  canFetchLyricsForTrack,
  prepareLyricsFetchForLightbox,
} from "./lyricsFetchToast";
import type { Track } from "../types/track";

const {
  getTrackLyricsMock,
  peekLyricsFetchCacheMock,
  enqueueLyricsFetchMock,
  markTrackInstrumentalMock,
  applyOutcomeMock,
} = vi.hoisted(() => ({
  getTrackLyricsMock: vi.fn(),
  peekLyricsFetchCacheMock: vi.fn(),
  enqueueLyricsFetchMock: vi.fn(),
  markTrackInstrumentalMock: vi.fn(),
  applyOutcomeMock: vi.fn(),
}));

vi.mock("./tauri", () => ({
  getTrackLyrics: getTrackLyricsMock,
  peekLyricsFetchCache: peekLyricsFetchCacheMock,
  fetchLyricsLrclib: vi.fn(),
  markTrackInstrumental: markTrackInstrumentalMock,
}));

vi.mock("./lyricsFetchQueue", () => ({
  enqueueLyricsFetch: enqueueLyricsFetchMock,
}));

vi.mock("../store/useLyricsFetchStore", () => ({
  useLyricsFetchStore: {
    getState: () => ({
      clearPending: vi.fn(),
      applyOutcome: applyOutcomeMock,
      setFetching: vi.fn(),
      fetchingTrackIds: new Set<number>(),
    }),
  },
}));

vi.mock("../store/usePlayerStore", () => ({
  usePlayerStore: {
    getState: () => ({
      updateTrackInLibrary: vi.fn(),
      notifyTrackLyricsUpdated: vi.fn(),
    }),
  },
}));

function track(overrides: Partial<Track> = {}): Track {
  return {
    id: 1,
    title: "Jumpin' Jumpin'",
    artist: "Destiny's Child",
    album: "The Writing's on the Wall",
    albumArtist: "Destiny's Child",
    trackNumber: 1,
    totalTracks: null,
    discNumber: 1,
    totalDiscs: null,
    year: 1999,
    genre: "Pop",
    durationSeconds: 218,
    sampleRate: 44_100,
    bitrate: 320,
    codec: "mp3",
    filePath: "/music/track.mp3",
    artPath: null,
    dateAdded: "2026-01-01T00:00:00.000Z",
    playCount: 0,
    lastPlayedAt: null,
    rating: 0,
    ...overrides,
  };
}

describe("buildLyricsFetchParamsForTrack", () => {
  it("returns fetch params when required metadata is present", () => {
    expect(buildLyricsFetchParamsForTrack(track())).toEqual({
      artist: "Destiny's Child",
      albumArtist: "Destiny's Child",
      title: "Jumpin' Jumpin'",
      album: "The Writing's on the Wall",
      durationSeconds: 218,
    });
  });

  it("returns null when artist, title, or duration is missing", () => {
    expect(buildLyricsFetchParamsForTrack(track({ artist: null }))).toBeNull();
    expect(buildLyricsFetchParamsForTrack(track({ title: "  " }))).toBeNull();
    expect(
      buildLyricsFetchParamsForTrack(track({ durationSeconds: null })),
    ).toBeNull();
  });
});

describe("canFetchLyricsForTrack", () => {
  it("returns true when required metadata is present", () => {
    expect(canFetchLyricsForTrack(track())).toBe(true);
    expect(canFetchLyricsForTrack(track({ artist: null }))).toBe(false);
  });
});

describe("prepareLyricsFetchForLightbox", () => {
  beforeEach(() => {
    getTrackLyricsMock.mockReset();
    peekLyricsFetchCacheMock.mockReset();
    enqueueLyricsFetchMock.mockReset();
    markTrackInstrumentalMock.mockReset();
    applyOutcomeMock.mockReset();
    markTrackInstrumentalMock.mockResolvedValue(
      track({ lyricsFormat: "instrumental" }),
    );
  });

  it("skips auto-fetch when the track already has lyrics", async () => {
    getTrackLyricsMock.mockResolvedValue({
      trackId: 1,
      format: "plain",
      source: "manual",
      lines: [],
      plainText: "Existing lyrics",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    await prepareLyricsFetchForLightbox(track(), { autoFetch: true });

    expect(getTrackLyricsMock).toHaveBeenCalledWith(1);
    expect(peekLyricsFetchCacheMock).not.toHaveBeenCalled();
    expect(enqueueLyricsFetchMock).not.toHaveBeenCalled();
  });

  it("skips auto-fetch when the track is marked instrumental", async () => {
    await prepareLyricsFetchForLightbox(
      track({ lyricsFormat: "instrumental" }),
      { autoFetch: true },
    );

    expect(getTrackLyricsMock).not.toHaveBeenCalled();
    expect(peekLyricsFetchCacheMock).not.toHaveBeenCalled();
    expect(enqueueLyricsFetchMock).not.toHaveBeenCalled();
    expect(markTrackInstrumentalMock).not.toHaveBeenCalled();
  });

  it("marks instrumental from cache peek without fetching", async () => {
    getTrackLyricsMock.mockResolvedValue(null);
    peekLyricsFetchCacheMock.mockResolvedValue("instrumental");

    await prepareLyricsFetchForLightbox(track(), { autoFetch: true });

    expect(markTrackInstrumentalMock).toHaveBeenCalledWith(1);
    expect(enqueueLyricsFetchMock).not.toHaveBeenCalled();
    expect(applyOutcomeMock).toHaveBeenCalled();
  });

  it("enqueues auto-fetch when cache peek is not a miss", async () => {
    getTrackLyricsMock.mockResolvedValue(null);
    peekLyricsFetchCacheMock.mockResolvedValue("not_cached");

    await prepareLyricsFetchForLightbox(track(), { autoFetch: true });

    expect(enqueueLyricsFetchMock).toHaveBeenCalledWith(
      1,
      "Jumpin' Jumpin'",
      expect.objectContaining({
        artist: "Destiny's Child",
        title: "Jumpin' Jumpin'",
      }),
      { priority: "auto", respectMissCache: true },
    );
  });
});
