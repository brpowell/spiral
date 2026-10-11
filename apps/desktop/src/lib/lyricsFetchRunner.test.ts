import { beforeEach, describe, expect, it, vi } from "vitest";
import { runSingleLyricsFetch } from "./lyricsFetchRunner";

const {
  getTrackLyricsMock,
  fetchLyricsLrclibMock,
  commitFetchedLyricsForTrackMock,
  applyOutcomeMock,
} = vi.hoisted(() => ({
  getTrackLyricsMock: vi.fn(),
  fetchLyricsLrclibMock: vi.fn(),
  commitFetchedLyricsForTrackMock: vi.fn(),
  applyOutcomeMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

vi.mock("./tauri", () => ({
  getTrackLyrics: getTrackLyricsMock,
  fetchLyricsLrclib: fetchLyricsLrclibMock,
}));

vi.mock("./lyricsFetchCommit", () => ({
  commitFetchedLyricsForTrack: commitFetchedLyricsForTrackMock,
}));

vi.mock("../store/useLyricsFetchStore", () => ({
  useLyricsFetchStore: {
    getState: () => ({
      applyOutcome: applyOutcomeMock,
    }),
  },
}));

vi.mock("../store/usePlayerStore", () => ({
  usePlayerStore: {
    getState: () => ({
      library: [
        {
          id: 1,
          title: "Song",
          artist: "Artist",
          filePath: "/music/song.mp3",
        },
      ],
    }),
  },
}));

const params = {
  artist: "Artist",
  albumArtist: "Artist",
  title: "Song",
  album: "Album",
  durationSeconds: 200,
};

describe("runSingleLyricsFetch", () => {
  beforeEach(() => {
    getTrackLyricsMock.mockReset();
    fetchLyricsLrclibMock.mockReset();
    commitFetchedLyricsForTrackMock.mockReset();
    applyOutcomeMock.mockReset();
  });

  it("skips when skipIfHasLyrics is set and lyrics already exist", async () => {
    getTrackLyricsMock.mockResolvedValue({
      trackId: 1,
      plainText: "Existing lyrics",
    });

    const result = await runSingleLyricsFetch(1, params, {
      skipIfHasLyrics: true,
    });

    expect(result).toEqual({
      status: "skipped",
      reason: "already_has_lyrics",
    });
    expect(fetchLyricsLrclibMock).not.toHaveBeenCalled();
  });

  it("replaces existing lyrics on manual refetch (skipIfHasLyrics unset)", async () => {
    getTrackLyricsMock.mockResolvedValue({
      trackId: 1,
      plainText: "Manually edited lyrics",
    });
    fetchLyricsLrclibMock.mockResolvedValue({
      status: "found",
      lyrics: {
        plainText: "Cached LRCLIB lyrics",
        lines: [],
        format: "plain",
      },
    });
    commitFetchedLyricsForTrackMock.mockResolvedValue({ status: "ok" });

    const result = await runSingleLyricsFetch(1, params);

    expect(result).toEqual({ status: "found" });
    expect(fetchLyricsLrclibMock).toHaveBeenCalled();
    expect(commitFetchedLyricsForTrackMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 }),
      expect.objectContaining({ plainText: "Cached LRCLIB lyrics" }),
    );
  });

  it("returns cancelled when LRCLIB invoke reports cancellation", async () => {
    fetchLyricsLrclibMock.mockRejectedValue(new Error("Lyrics fetch cancelled"));

    const result = await runSingleLyricsFetch(1, params);

    expect(result).toEqual({ status: "cancelled" });
    expect(applyOutcomeMock).not.toHaveBeenCalled();
  });
});
