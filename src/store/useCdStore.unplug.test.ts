// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CdDisc, CdDiscChangedPayload, CdDrive } from "../types/cd";

const {
  mockListen,
  mockProbeCdDrive,
  mockListCdDrives,
  mockStopCdPlaybackForDrive,
  mockCloseCdDrive,
} = vi.hoisted(() => ({
  mockListen: vi.fn(),
  mockProbeCdDrive: vi.fn(),
  mockListCdDrives: vi.fn(async () => []),
  mockStopCdPlaybackForDrive: vi.fn(),
  mockCloseCdDrive: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: mockListen,
}));

vi.mock("../lib/tauri", () => ({
  ejectCdDisc: vi.fn(),
  getDiscCdText: vi.fn(),
  getDiscInfo: vi.fn(),
  listCdDrives: mockListCdDrives,
  lookupDiscMetadata: vi.fn(),
  peekDiscMetadataCache: vi.fn(),
  probeCdDrive: mockProbeCdDrive,
  saveDiscMetadataPreference: vi.fn(),
}));

vi.mock("../lib/cdMetadataFetch", () => ({
  startCdHeroArtFetch: vi.fn(),
  startCdMetadataFetch: vi.fn(),
}));

vi.mock("../lib/cdPlaybackArt", () => ({
  syncCdHeroArtToPlayback: vi.fn(),
}));

vi.mock("../lib/activityLog", () => ({
  logActivity: vi.fn(),
}));

vi.mock("../lib/network", () => ({
  isNetworkLikelyAvailable: () => false,
}));

vi.mock("../lib/cdImportGuard", () => ({
  isCdImportBlockingPlayback: () => false,
}));

vi.mock("../lib/cdActivePlaybackDisc", () => ({
  discFromActivePlayback: () => null,
}));

vi.mock("./useLibrarySettingsStore", () => ({
  useLibrarySettingsStore: {
    getState: () => ({
      settings: { cdMetadataFetchMode: "ask" },
      saveLibrarySettings: vi.fn(),
    }),
  },
}));

vi.mock("./useNavigationStore", () => ({
  useNavigationStore: {
    getState: () => ({
      cdDriveId: null,
      closeCdDrive: mockCloseCdDrive,
    }),
  },
}));

vi.mock("./usePlayerStore", () => ({
  usePlayerStore: {
    getState: () => ({
      cdDriveId: null,
      currentPlayable: null,
      playbackState: "stopped",
      stopCdPlaybackForDrive: mockStopCdPlaybackForDrive,
    }),
  },
}));

import { useCdStore } from "./useCdStore";

const drive: CdDrive = {
  id: "disk4",
  name: "USB SuperDrive",
  hasDisc: true,
};

const disc: CdDisc = {
  driveId: "disk4",
  discId: "test-disc",
  album: "Test Album",
  artist: "Test Artist",
  tracks: [{ number: 1, title: "Track 1", durationSeconds: 180 }],
};

describe("useCdStore unplug / absent drive", () => {
  let onDiscChanged:
    ((event: { payload: CdDiscChangedPayload }) => void) | null = null;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    onDiscChanged = null;

    mockListen.mockImplementation(async (_event, handler) => {
      onDiscChanged = handler as typeof onDiscChanged;
      return () => {
        onDiscChanged = null;
      };
    });

    useCdStore.setState({
      drives: [drive],
      discsByDriveId: { [drive.id]: disc },
      metadataByDriveId: {},
      metadataCandidatesByDriveId: {},
      metadataFetchedDiscIdByDriveId: {},
      metadataPickDriveId: null,
      metadataFetchPromptDriveId: null,
      metadataFetchPromptQueue: [],
      heroArtByDriveId: {},
      loadingDriveIds: new Set(),
      cdtextLoadingDriveIds: new Set(),
      cdtextAttemptedDriveIds: new Set(),
      ejectingDriveIds: new Set(),
      initialized: true,
    });

    await useCdStore.getState().init();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it("removes a pinned drive when probe reports no disc after unplug", async () => {
    mockProbeCdDrive.mockResolvedValue(false);

    onDiscChanged?.({ payload: { drives: [] } });

    // Absent-verify delay (2s) + two retries (1s each) for cached discs.
    await vi.advanceTimersByTimeAsync(2_000);
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.advanceTimersByTimeAsync(1_000);
    await Promise.resolve();

    expect(mockProbeCdDrive).toHaveBeenCalled();
    expect(useCdStore.getState().drives).toEqual([]);
    expect(useCdStore.getState().discsByDriveId[drive.id]).toBeUndefined();
    expect(mockStopCdPlaybackForDrive).toHaveBeenCalledWith(drive.id);
  });

  it("removes a pinned drive when probe fails because the drive is gone", async () => {
    mockProbeCdDrive.mockRejectedValue(new Error("Drive disk4 not found"));

    onDiscChanged?.({ payload: { drives: [] } });

    await vi.advanceTimersByTimeAsync(2_000);
    await Promise.resolve();

    expect(mockProbeCdDrive).toHaveBeenCalledWith(drive.id);
    expect(useCdStore.getState().drives).toEqual([]);
    expect(useCdStore.getState().discsByDriveId[drive.id]).toBeUndefined();
  });

  it("removes a pinned drive when probe is stale-true but listCdDrives omits it", async () => {
    mockProbeCdDrive.mockResolvedValue(true);
    mockListCdDrives.mockResolvedValue([]);

    onDiscChanged?.({ payload: { drives: [] } });

    await vi.advanceTimersByTimeAsync(2_000);
    await Promise.resolve();

    expect(mockProbeCdDrive).toHaveBeenCalledWith(drive.id);
    expect(mockListCdDrives).toHaveBeenCalled();
    expect(useCdStore.getState().drives).toEqual([]);
    expect(useCdStore.getState().discsByDriveId[drive.id]).toBeUndefined();
  });

  it("removes during post-load quiet when the drive no longer enumerates", async () => {
    const { getDiscInfo } = await import("../lib/tauri");
    vi.mocked(getDiscInfo).mockResolvedValue(disc);

    useCdStore.setState({
      drives: [drive],
      discsByDriveId: {},
      loadingDriveIds: new Set(),
      initialized: true,
    });
    await useCdStore.getState().loadDisc(drive.id, { force: true });
    expect(useCdStore.getState().discsByDriveId[drive.id]).toEqual(disc);

    mockListCdDrives.mockResolvedValue([]);
    onDiscChanged?.({ payload: { drives: [] } });

    await vi.advanceTimersByTimeAsync(2_000);
    await Promise.resolve();
    await Promise.resolve();

    expect(useCdStore.getState().drives).toEqual([]);
  });
});
