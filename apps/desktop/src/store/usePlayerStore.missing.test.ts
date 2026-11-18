// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Track } from "@/types/track";

const { mockFileExists, mockUnavailable, playback } = vi.hoisted(() => ({
  mockFileExists: vi.fn(),
  mockUnavailable: vi.fn(),
  playback: {
    trackEnded: () => {},
    fileError: (_error: {
      message: string;
      driveId: string;
      trackNumber: number;
    }) => {},
  },
}));

vi.mock("@/lib/playback", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/playback")>()),
  onEnd: (callback: () => void) => {
    playback.trackEnded = callback;
  },
  onFileError: (callback: typeof playback.fileError) => {
    playback.fileError = callback;
  },
}));

vi.mock("@/lib/art/artPath", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/art/artPath")>()),
  fileExists: mockFileExists,
}));

// Answer the one command playback asks; any other fails as it does without a webview.
vi.mock("@tauri-apps/api/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tauri-apps/api/core")>()),
  invoke: async (command: string) => {
    if (command === "get_unavailable_source_ids") return mockUnavailable();
    throw new Error(`no webview for ${command}`);
  },
}));

import * as audio from "@/lib/playback";
import { useBackgroundTasksStore } from "./useBackgroundTasksStore";
import { usePlayerStore } from "./usePlayerStore";

function track(id: number, overrides: Partial<Track> = {}): Track {
  return {
    id,
    title: `Track ${id}`,
    artist: "Artist",
    album: "Album",
    albumArtist: "Artist",
    trackNumber: id,
    totalTracks: null,
    discNumber: 1,
    totalDiscs: null,
    year: null,
    genre: null,
    durationSeconds: 180,
    sampleRate: null,
    bitrate: null,
    codec: null,
    filePath: `/music/${id}.flac`,
    artPath: null,
    dateAdded: "2026-01-01T00:00:00.000Z",
    playCount: 0,
    lastPlayedAt: null,
    rating: 0,
    ...overrides,
  };
}

const missing = { missingSince: "2026-01-02T00:00:00.000Z" };

function toasts() {
  return useBackgroundTasksStore
    .getState()
    .tasks.map(({ label, detail }) => ({ label, detail }));
}

function setQueue(library: Track[], currentTrackId: number | null = null) {
  usePlayerStore.setState({
    library,
    playContextIds: library.map((item) => item.id),
    manualQueueIds: [],
    currentTrackId,
    currentPlayable:
      currentTrackId === null
        ? null
        : { type: "library", trackId: currentTrackId },
    cdDriveId: null,
    playbackTracks: [],
    playbackState: currentTrackId === null ? "stopped" : "playing",
    repeatMode: "off",
    shuffle: false,
  });
}

describe("skipping missing tracks", () => {
  let now = 1_000_000;
  let startPlayback: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Each test's skips start a run of their own.
    now += 60_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    mockFileExists.mockReset();
    mockFileExists.mockResolvedValue(true);
    mockUnavailable.mockReset();
    mockUnavailable.mockResolvedValue([]);
    startPlayback = vi
      .spyOn(audio, "crossfadeLoadAndPlay")
      .mockResolvedValue(undefined);
    vi.spyOn(audio, "isPlaying").mockReturnValue(false);
    vi.spyOn(audio, "isCrossfadeControllerActive").mockReturnValue(false);
    useBackgroundTasksStore.setState({ tasks: [] });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("starting on a missing track plays the next one and says so", async () => {
    setQueue([track(1, missing), track(2)]);
    await usePlayerStore.getState().playTrack(1);

    expect(usePlayerStore.getState().currentTrackId).toBe(2);
    expect(usePlayerStore.getState().playbackState).toBe("playing");
    expect(toasts()).toEqual([{ label: "File not found", detail: "Track 1" }]);
  });

  it("starting on a missing track with no set list builds one first", async () => {
    setQueue([track(1, missing), track(2)]);
    usePlayerStore.setState({ playContextIds: [] });
    await usePlayerStore.getState().playTrack(1);
    expect(usePlayerStore.getState().currentTrackId).toBe(2);
  });

  it("starting on a track whose file just went does the same", async () => {
    mockFileExists.mockImplementation(
      async (path: string) => path !== "/music/1.flac",
    );
    setQueue([track(1), track(2)]);
    await usePlayerStore.getState().playTrack(1);

    expect(usePlayerStore.getState().currentTrackId).toBe(2);
    expect(toasts()).toEqual([{ label: "File not found", detail: "Track 1" }]);
    expect(usePlayerStore.getState().library[0].missingFile).toBe(true);
  });

  it("an offline source's tracks are all flagged without trying their files", async () => {
    mockUnavailable.mockResolvedValue([7]);
    const library = [
      track(1, { sourceId: 7 }),
      track(2, { sourceId: 7 }),
      track(3, { sourceId: 1 }),
      track(4, { sourceId: 7 }),
    ];
    setQueue(library);
    await usePlayerStore.getState().playTrack(1);

    const state = usePlayerStore.getState();
    expect(state.currentTrackId).toBe(3);
    expect(state.library.map((t) => !!t.missingFile)).toEqual([
      true,
      true,
      false,
      true,
    ]);
    expect(mockFileExists).not.toHaveBeenCalledWith("/music/1.flac");
    expect(mockFileExists).not.toHaveBeenCalledWith("/music/2.flac");
    expect(state.library.map((t) => !!t.sourceOffline)).toEqual([
      true,
      true,
      false,
      true,
    ]);
    // Said to be the folder, not each file: one toast for the run.
    expect(toasts()).toEqual([
      { label: "2 tracks skipped", detail: "Their music folder is offline" },
    ]);
  });

  it("a single offline track's toast names the folder", async () => {
    mockUnavailable.mockResolvedValue([7]);
    setQueue([track(1, { sourceId: 7 }), track(2, { sourceId: 1 })]);
    await usePlayerStore.getState().playTrack(1);
    expect(toasts()).toEqual([
      { label: "Music folder offline", detail: "Track 1" },
    ]);
  });

  it("a file that is just gone still says so", async () => {
    mockFileExists.mockImplementation(
      async (path: string) => path !== "/music/1.flac",
    );
    setQueue([track(1, { sourceId: 7 }), track(2, { sourceId: 7 })]);
    await usePlayerStore.getState().playTrack(1);
    expect(toasts()).toEqual([{ label: "File not found", detail: "Track 1" }]);
    expect(usePlayerStore.getState().library[0].sourceOffline).toBeUndefined();
  });

  it("a reachable source is tried file by file as usual", async () => {
    mockFileExists.mockImplementation(
      async (path: string) => path !== "/music/1.flac",
    );
    setQueue([track(1, { sourceId: 7 }), track(2, { sourceId: 7 })]);
    await usePlayerStore.getState().playTrack(1);

    const state = usePlayerStore.getState();
    expect(state.currentTrackId).toBe(2);
    expect(state.library.map((t) => !!t.missingFile)).toEqual([true, false]);
  });

  describe("a file that stops answering mid-track", () => {
    const stalled = {
      message: "source_unavailable: /music/1.flac is not responding",
      driveId: "",
      trackNumber: 0,
    };

    beforeEach(() => {
      vi.spyOn(audio, "unload").mockImplementation(() => {});
    });

    it("stops, and flags its whole folder offline when that's the cause", async () => {
      mockUnavailable.mockResolvedValue([7]);
      setQueue(
        [
          track(1, { sourceId: 7 }),
          track(2, { sourceId: 7 }),
          track(3, { sourceId: 1 }),
        ],
        1,
      );
      playback.fileError(stalled);

      expect(usePlayerStore.getState().playbackState).toBe("stopped");
      expect(audio.unload).toHaveBeenCalled();
      await vi.waitFor(() =>
        expect(toasts()).toEqual([
          { label: "Music folder offline", detail: "Track 1" },
        ]),
      );
      expect(
        usePlayerStore.getState().library.map((t) => !!t.sourceOffline),
      ).toEqual([true, true, false]);
      expect(mockFileExists).not.toHaveBeenCalled();
    });

    it("trusts a not-responding error over a folder test that passes", async () => {
      mockUnavailable.mockResolvedValue([]);
      setQueue([track(1, { sourceId: 7 }), track(2, { sourceId: 7 })], 1);
      playback.fileError(stalled);
      await vi.waitFor(() =>
        expect(
          usePlayerStore.getState().library.map((t) => !!t.sourceOffline),
        ).toEqual([true, true]),
      );
    });

    it("flags just the file when its folder is there", async () => {
      const readError = {
        ...stalled,
        message: "Failed to read /music/1.flac: read failed: bad data",
      };
      mockFileExists.mockResolvedValue(false);
      setQueue([track(1, { sourceId: 7 }), track(2, { sourceId: 7 })], 1);
      playback.fileError(readError);

      await vi.waitFor(() =>
        expect(toasts()).toEqual([
          { label: "File not found", detail: "Track 1" },
        ]),
      );
      const [first, second] = usePlayerStore.getState().library;
      expect(first.missingFile).toBe(true);
      expect(first.sourceOffline).toBeUndefined();
      expect(second.missingFile).toBeUndefined();
    });
  });

  it("a start that times out flags its folder offline even when the folder test passes", async () => {
    // A dropped share can keep answering lookups from a cache.
    mockUnavailable.mockResolvedValue([]);
    startPlayback.mockRejectedValueOnce(
      new Error(
        "source_unavailable: /music/1.flac is not responding; check the connection to its folder",
      ),
    );
    setQueue([
      track(1, { sourceId: 7 }),
      track(2, { sourceId: 7 }),
      track(3, { sourceId: 1 }),
    ]);
    await usePlayerStore.getState().playTrack(1);

    const state = usePlayerStore.getState();
    expect(state.library.map((t) => !!t.sourceOffline)).toEqual([
      true,
      true,
      false,
    ]);
    // Its folder's other track is passed over; the next folder's plays.
    expect(state.currentTrackId).toBe(3);
  });

  describe("a folder flagged offline", () => {
    const offline = {
      missingFile: true as const,
      sourceOffline: true as const,
    };

    it("is tested again on play, and cleared when it's back", async () => {
      setQueue([
        track(1, { sourceId: 7, ...offline }),
        track(2, { sourceId: 7, ...offline }),
        track(3, { sourceId: 1 }),
      ]);
      await usePlayerStore.getState().playTrack(1);

      const state = usePlayerStore.getState();
      expect(state.currentTrackId).toBe(1);
      expect(state.playbackState).toBe("playing");
      expect(
        state.library.map((t) => !!t.missingFile || !!t.sourceOffline),
      ).toEqual([false, false, false]);
      expect(toasts()).toEqual([]);
    });

    it("still offline: passed over again with its toast", async () => {
      mockUnavailable.mockResolvedValue([7]);
      setQueue([
        track(1, { sourceId: 7, ...offline }),
        track(2, { sourceId: 7, ...offline }),
        track(3, { sourceId: 1 }),
      ]);
      await usePlayerStore.getState().playTrack(1);

      const state = usePlayerStore.getState();
      expect(state.currentTrackId).toBe(3);
      expect(state.library.map((t) => !!t.sourceOffline)).toEqual([
        true,
        true,
        false,
      ]);
      expect(mockFileExists).not.toHaveBeenCalledWith("/music/1.flac");
    });

    it("comes back with a file that's gone: only that file is missing", async () => {
      mockFileExists.mockImplementation(
        async (path: string) => path !== "/music/1.flac",
      );
      setQueue([
        track(1, { sourceId: 7, ...offline }),
        track(2, { sourceId: 7, ...offline }),
      ]);
      await usePlayerStore.getState().playTrack(1);

      const [first, second] = usePlayerStore.getState().library;
      expect(first.missingFile).toBe(true);
      expect(first.sourceOffline).toBeUndefined();
      expect(second.missingFile).toBeUndefined();
      expect(usePlayerStore.getState().currentTrackId).toBe(2);
    });
  });

  it("Next says which track it passed over", async () => {
    setQueue([track(1), track(2, missing), track(3)], 1);
    usePlayerStore.getState().nextTrack();

    await vi.waitFor(() =>
      expect(usePlayerStore.getState().currentTrackId).toBe(3),
    );
    expect(toasts()).toEqual([{ label: "File not found", detail: "Track 2" }]);
  });

  it("several skipped in a row share one toast", async () => {
    mockFileExists.mockImplementation(
      async (path: string) => path !== "/music/4.flac",
    );
    setQueue(
      [
        track(1),
        track(2, missing),
        track(3, missing),
        track(4),
        track(5, missing),
        track(6),
      ],
      1,
    );
    usePlayerStore.getState().nextTrack();

    await vi.waitFor(() =>
      expect(usePlayerStore.getState().currentTrackId).toBe(6),
    );
    expect(toasts()).toEqual([
      { label: "4 tracks skipped", detail: "Their files weren't found" },
    ]);
  });

  it("the track ending moves past missing tracks and says so", async () => {
    setQueue([track(1), track(2, missing), track(3, missing), track(4)], 1);
    playback.trackEnded();

    await vi.waitFor(() =>
      expect(usePlayerStore.getState().currentTrackId).toBe(4),
    );
    expect(toasts()).toEqual([
      { label: "2 tracks skipped", detail: "Their files weren't found" },
    ]);
  });

  it("stops when every remaining track is missing", async () => {
    setQueue([track(1, missing), track(2, missing)]);
    await usePlayerStore.getState().playTrack(1);

    expect(startPlayback).not.toHaveBeenCalled();
    expect(usePlayerStore.getState().playbackState).toBe("stopped");
    expect(toasts()).toEqual([
      { label: "2 tracks skipped", detail: "Their files weren't found" },
    ]);
  });

  it("doesn't loop when repeat wraps around an all-missing list", async () => {
    setQueue([track(1, missing), track(2, missing)]);
    usePlayerStore.setState({ repeatMode: "all" });
    await usePlayerStore.getState().playTrack(2);

    expect(startPlayback).not.toHaveBeenCalled();
    expect(usePlayerStore.getState().playbackState).toBe("stopped");
  });

  it("repeat-one still moves off a missing track the user started", async () => {
    setQueue([track(1, missing), track(2)]);
    usePlayerStore.setState({ repeatMode: "one" });
    await usePlayerStore.getState().playTrack(1);
    expect(usePlayerStore.getState().currentTrackId).toBe(2);
  });

  it("leaves what's playing alone when nothing after a missing track can play", async () => {
    vi.mocked(audio.isPlaying).mockReturnValue(true);
    setQueue([track(1), track(2, missing)], 1);
    await usePlayerStore.getState().playTrack(2);

    expect(usePlayerStore.getState().currentTrackId).toBe(1);
    expect(usePlayerStore.getState().playbackState).toBe("playing");
    expect(toasts()).toEqual([{ label: "File not found", detail: "Track 2" }]);
  });
});
