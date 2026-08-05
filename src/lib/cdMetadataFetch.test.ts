import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CdDisc, DiscMetadata } from "../types/cd";

const {
  ensureCdHeroArtValidMock,
  resolveAlbumArtPathMock,
  fetchAlbumArtPreferringReleaseMock,
  runInBackgroundMock,
  isNetworkLikelyAvailableMock,
} = vi.hoisted(() => ({
  ensureCdHeroArtValidMock: vi.fn(),
  resolveAlbumArtPathMock: vi.fn(),
  fetchAlbumArtPreferringReleaseMock: vi.fn(),
  runInBackgroundMock: vi.fn(),
  isNetworkLikelyAvailableMock: vi.fn(() => true),
}));

vi.mock("./cdArt", () => ({
  ensureCdHeroArtValid: ensureCdHeroArtValidMock,
}));

vi.mock("./albumArtFetch", () => ({
  resolveAlbumArtPath: resolveAlbumArtPathMock,
  fetchAlbumArtPreferringRelease: fetchAlbumArtPreferringReleaseMock,
}));

vi.mock("./network", () => ({
  isNetworkLikelyAvailable: isNetworkLikelyAvailableMock,
}));

vi.mock("./activityLog", () => ({
  createOperationId: () => "op-test",
  logActivity: vi.fn(),
  withLogContext: (ctx: unknown, extra: unknown) => ({
    ...(ctx as object),
    ...(extra as object),
  }),
}));

vi.mock("../store/useBackgroundTasksStore", () => ({
  useBackgroundTasksStore: {
    getState: () => ({
      runInBackground: runInBackgroundMock,
    }),
  },
}));

import { startCdHeroArtFetch } from "./cdMetadataFetch";
import { useCdStore } from "../store/useCdStore";

const driveId = "drive-1";

const disc: CdDisc = {
  driveId,
  discId: "disc-1",
  album: "Unknown Pleasures",
  artist: "Joy Division",
  tracks: [{ number: 1, title: "Disorder", durationSeconds: 200 }],
};

const metadata: DiscMetadata = {
  discId: "disc-1",
  album: "Unknown Pleasures",
  albumArtist: "Joy Division",
  releaseMbid: "release-mbid",
  tracks: [{ number: 1, title: "Disorder", artist: "Joy Division" }],
};

function resetCdStore(partial: {
  discsByDriveId?: Record<string, CdDisc>;
  metadataByDriveId?: Record<string, DiscMetadata>;
}) {
  useCdStore.setState({
    drives: [],
    discsByDriveId: partial.discsByDriveId ?? {},
    metadataByDriveId: partial.metadataByDriveId ?? {},
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
}

describe("startCdHeroArtFetch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ensureCdHeroArtValidMock.mockResolvedValue(null);
    resolveAlbumArtPathMock.mockResolvedValue(null);
    fetchAlbumArtPreferringReleaseMock.mockResolvedValue(null);
    isNetworkLikelyAvailableMock.mockReturnValue(true);
    runInBackgroundMock.mockImplementation(
      ({ run }: { run: () => Promise<void> }) => {
        void run();
        return Promise.resolve();
      },
    );
  });

  it("does not network-fetch cover art when user has only CD-Text (declined metadata)", async () => {
    resetCdStore({ discsByDriveId: { [driveId]: disc } });

    startCdHeroArtFetch(driveId);

    await vi.waitFor(() => {
      expect(ensureCdHeroArtValidMock).toHaveBeenCalledWith(driveId);
      expect(resolveAlbumArtPathMock).toHaveBeenCalled();
    });

    expect(runInBackgroundMock).not.toHaveBeenCalled();
    expect(fetchAlbumArtPreferringReleaseMock).not.toHaveBeenCalled();
  });

  it("starts a background cover-art fetch when MusicBrainz metadata is present", async () => {
    resetCdStore({
      discsByDriveId: { [driveId]: disc },
      metadataByDriveId: { [driveId]: metadata },
    });

    startCdHeroArtFetch(driveId);

    await vi.waitFor(() => {
      expect(runInBackgroundMock).toHaveBeenCalledWith(
        expect.objectContaining({
          key: `cd-hero-art-${driveId}`,
          label: "Fetching album art…",
        }),
      );
    });
  });

  it("still applies a local art cache hit without MusicBrainz metadata", async () => {
    resetCdStore({ discsByDriveId: { [driveId]: disc } });
    resolveAlbumArtPathMock.mockResolvedValue("/tmp/cached-art.jpg");

    startCdHeroArtFetch(driveId);

    await vi.waitFor(() => {
      expect(useCdStore.getState().heroArtByDriveId[driveId]).toBe(
        "/tmp/cached-art.jpg",
      );
    });

    expect(runInBackgroundMock).not.toHaveBeenCalled();
    expect(fetchAlbumArtPreferringReleaseMock).not.toHaveBeenCalled();
  });
});
