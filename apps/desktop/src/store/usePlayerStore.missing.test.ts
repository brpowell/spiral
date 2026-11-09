// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Track } from "@/types/track";

const { mockFileExists, playback } = vi.hoisted(() => ({
  mockFileExists: vi.fn(),
  playback: { trackEnded: () => {} },
}));

vi.mock("@/lib/playback", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/playback")>()),
  onEnd: (callback: () => void) => {
    playback.trackEnded = callback;
  },
}));

vi.mock("@/lib/art/artPath", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/art/artPath")>()),
  fileExists: mockFileExists,
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
