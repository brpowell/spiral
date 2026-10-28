import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CdDisc, DiscMetadata } from "../types/cd";

const {
  ensureCdHeroArtValidMock,
  resolveAlbumArtPathMock,
  fetchAlbumArtPreferringReleaseMock,
  runInBackgroundMock,
  isNetworkLikelyAvailableMock,
  resolveCachedArtPathMock,
  backgroundTasks,
} = vi.hoisted(() => ({
  ensureCdHeroArtValidMock: vi.fn(),
  resolveAlbumArtPathMock: vi.fn(),
  fetchAlbumArtPreferringReleaseMock: vi.fn(),
  runInBackgroundMock: vi.fn(),
  isNetworkLikelyAvailableMock: vi.fn(() => true),
  resolveCachedArtPathMock: vi.fn(),
  backgroundTasks: [] as { key: string; status: string }[],
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
      tasks: backgroundTasks,
    }),
  },
}));

import { startCdHeroArtFetch, startCdMetadataFetch } from "./cdMetadataFetch";
import { logActivity } from "./activityLog";
import {
  cdHeroArtFetchedSettleOptions,
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
  const settleAs = vi.fn();
  const dismissSilently = vi.fn();

  function fakeCtx(): BackgroundTaskRunContext {
    return {
      settleAs,
      setDetail: vi.fn(),
      clearDetail: vi.fn(),
      dismissSilently,
      setLabel: vi.fn(),
      setProgress: vi.fn(),
      clearProgress: vi.fn(),
      isCancelRequested: () => false,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    ensureCdHeroArtValidMock.mockResolvedValue(null);
    resolveAlbumArtPathMock.mockResolvedValue(null);
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

  it("settles the cover-art toast as fetched instead of the in-progress label", async () => {
    fetchAlbumArtPreferringReleaseMock.mockResolvedValue("/tmp/art.jpg");
    resetCdStore({
      discsByDriveId: { [driveId]: disc },
      metadataByDriveId: { [driveId]: metadata },
    });

    startCdHeroArtFetch(driveId);

    await vi.waitFor(() => {
      expect(settleAs).toHaveBeenCalledWith(
        cdHeroArtFetchedSettleOptions({ album: "Unknown Pleasures" }),
      );
    });
    expect(runInBackgroundMock).toHaveBeenCalledWith(
      expect.objectContaining({
        key: `cd-hero-art-${driveId}`,
        label: "Fetching CD album art…",
      }),
    );
    expect(dismissSilently).not.toHaveBeenCalled();
    expect(useCdStore.getState().heroArtByDriveId[driveId]).toBe(
      "/tmp/art.jpg",
    );
  });

  it("dismisses the cover-art toast when no image is found", async () => {
    resetCdStore({
      discsByDriveId: { [driveId]: disc },
      metadataByDriveId: { [driveId]: metadata },
    });

    startCdHeroArtFetch(driveId);

    await vi.waitFor(() => {
      expect(dismissSilently).toHaveBeenCalled();
    });
    expect(runInBackgroundMock).toHaveBeenCalled();
    expect(settleAs).not.toHaveBeenCalled();
  });

  it("does not start a second art task while the metadata fetch is running", async () => {
    backgroundTasks.push({ key: `cd-metadata-${driveId}`, status: "running" });
    try {
      startCdHeroArtFetch(driveId);
      await vi.waitFor(() => {
        expect(runInBackgroundMock).not.toHaveBeenCalled();
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(runInBackgroundMock).not.toHaveBeenCalled();
    } finally {
      backgroundTasks.length = 0;
    }
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
      cdMetadataFailedSettleOptions({ logLink: true }),
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
      }),
    );
    expect(settleAs).toHaveBeenCalledWith(
      cdMetadataFailedSettleOptions({ logLink: true }),
    );
  });
});
