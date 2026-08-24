import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CdDisc, DiscMetadata } from "../types/cd";

const {
  ensureCdHeroArtValidMock,
  resolveAlbumArtPathMock,
  fetchAlbumArtPreferringReleaseMock,
  runInBackgroundMock,
  isNetworkLikelyAvailableMock,
  resolveCachedArtPathMock,
} = vi.hoisted(() => ({
  ensureCdHeroArtValidMock: vi.fn(),
  resolveAlbumArtPathMock: vi.fn(),
  fetchAlbumArtPreferringReleaseMock: vi.fn(),
  runInBackgroundMock: vi.fn(),
  isNetworkLikelyAvailableMock: vi.fn(() => true),
  resolveCachedArtPathMock: vi.fn(),
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

vi.mock("./tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./tauri")>();
  return {
    ...actual,
    resolveCachedArtPath: resolveCachedArtPathMock,
  };
});

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

import {
  startCdHeroArtFetch,
  startCdMetadataFetch,
  startCdReleaseSearch,
} from "./cdMetadataFetch";
import { logActivity } from "./activityLog";
import {
  cdMetadataFailedSettleOptions,
  cdMetadataFoundSettleOptions,
  cdMetadataNotFoundSettleOptions,
} from "./toastPayloads";
import { useCdStore } from "../store/useCdStore";
import type { BackgroundTaskRunContext } from "../store/useBackgroundTasksStore";

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

const otherMetadata: DiscMetadata = {
  ...metadata,
  album: "Closer",
  releaseMbid: "release-mbid-2",
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

describe("startCdMetadataFetch", () => {
  const settleAs = vi.fn();
  const loadDiscMetadata = vi.fn();
  const setDetail = vi.fn();
  const clearDetail = vi.fn();
  const dismissSilently = vi.fn();

  function fakeCtx(): BackgroundTaskRunContext {
    return {
      settleAs,
      setDetail,
      clearDetail,
      dismissSilently,
      setLabel: vi.fn(),
      setProgress: vi.fn(),
      clearProgress: vi.fn(),
      isCancelRequested: () => false,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    resolveCachedArtPathMock.mockResolvedValue(null);
    resolveAlbumArtPathMock.mockResolvedValue("/tmp/cached-art.jpg");
    fetchAlbumArtPreferringReleaseMock.mockResolvedValue(null);
    isNetworkLikelyAvailableMock.mockReturnValue(true);
    runInBackgroundMock.mockImplementation(
      async ({
        run,
      }: {
        run: (ctx: BackgroundTaskRunContext) => Promise<void>;
      }) => {
        await run(fakeCtx());
      },
    );
    resetCdStore({
      discsByDriveId: { [driveId]: disc },
      metadataByDriveId: { [driveId]: metadata },
    });
    useCdStore.setState({ loadDiscMetadata });
  });

  it("settles success with the found album instead of the looking-up label", async () => {
    loadDiscMetadata.mockResolvedValue({
      discId: "disc-1",
      candidates: [metadata],
      preferred: metadata,
      kind: "hit",
    });

    startCdMetadataFetch(driveId);
    await vi.waitFor(() => expect(settleAs).toHaveBeenCalled());

    expect(settleAs).toHaveBeenCalledWith(
      cdMetadataFoundSettleOptions({ album: "Unknown Pleasures" }),
    );
    expect(logActivity).not.toHaveBeenCalled();
  });

  it("settles a dedicated failure toast with a log link and does not add a second error line", async () => {
    loadDiscMetadata.mockResolvedValue({
      discId: "disc-1",
      candidates: [],
      preferred: null,
      kind: "error",
    });

    startCdMetadataFetch(driveId);
    await vi.waitFor(() => expect(settleAs).toHaveBeenCalled());

    expect(settleAs).toHaveBeenCalledWith(
      cdMetadataFailedSettleOptions({ logLink: { operationId: "op-test" } }),
    );
    expect(logActivity).not.toHaveBeenCalled();
    expect(fetchAlbumArtPreferringReleaseMock).not.toHaveBeenCalled();
  });

  it("settles not-found without fetching art", async () => {
    loadDiscMetadata.mockResolvedValue({
      discId: "disc-1",
      candidates: [],
      preferred: null,
      kind: "miss",
    });

    startCdMetadataFetch(driveId);
    await vi.waitFor(() => expect(settleAs).toHaveBeenCalled());

    expect(settleAs).toHaveBeenCalledWith(cdMetadataNotFoundSettleOptions());
    expect(logActivity).not.toHaveBeenCalled();
  });

  it("logs once when the lookup invoke throws and does not rethrow", async () => {
    loadDiscMetadata.mockRejectedValue(new Error("invoke exploded"));

    startCdMetadataFetch(driveId);
    await vi.waitFor(() => expect(settleAs).toHaveBeenCalled());

    expect(logActivity).toHaveBeenCalledTimes(1);
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "CD metadata fetch failed",
        operationId: "op-test",
      }),
    );
    expect(settleAs).toHaveBeenCalledWith(
      cdMetadataFailedSettleOptions({ logLink: { operationId: "op-test" } }),
    );
  });

  it("opens the release picker when lookup returns multiple candidates", async () => {
    loadDiscMetadata.mockImplementation(async () => {
      const lookup = {
        discId: "disc-1",
        candidates: [metadata, otherMetadata],
        preferred: metadata,
        kind: "hit" as const,
      };
      useCdStore.setState((state) => ({
        metadataCandidatesByDriveId: {
          ...state.metadataCandidatesByDriveId,
          [driveId]: lookup.candidates,
        },
      }));
      return lookup;
    });

    startCdReleaseSearch(driveId);
    await vi.waitFor(() => expect(dismissSilently).toHaveBeenCalled());

    expect(useCdStore.getState().metadataPickDriveId).toBe(driveId);
    expect(settleAs).not.toHaveBeenCalled();
  });

  it("settles found without opening the picker when only one candidate matches", async () => {
    loadDiscMetadata.mockResolvedValue({
      discId: "disc-1",
      candidates: [metadata],
      preferred: metadata,
      kind: "hit",
    });

    startCdReleaseSearch(driveId);
    await vi.waitFor(() => expect(settleAs).toHaveBeenCalled());

    expect(useCdStore.getState().metadataPickDriveId).toBeNull();
    expect(settleAs).toHaveBeenCalledWith(
      cdMetadataFoundSettleOptions({ album: "Unknown Pleasures" }),
    );
    expect(dismissSilently).not.toHaveBeenCalled();
  });
});
