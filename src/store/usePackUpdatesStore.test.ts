import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePackUpdatesStore } from "./usePackUpdatesStore";
import type { CatalogPackEntry } from "../types/packRegistry";

const {
  mockFetchPackCatalogSafe,
  mockEnrichPackCatalog,
  mockSaveLibrarySettings,
  mockIsTauri,
  mockEmit,
  mockShowErrorToast,
  mockRunInBackground,
} = vi.hoisted(() => ({
  mockFetchPackCatalogSafe: vi.fn(),
  mockEnrichPackCatalog: vi.fn(),
  mockSaveLibrarySettings: vi.fn(() => Promise.resolve({})),
  mockIsTauri: vi.fn(() => true),
  mockEmit: vi.fn(() => Promise.resolve()),
  mockShowErrorToast: vi.fn(),
  mockRunInBackground: vi.fn(),
}));

vi.mock("../lib/packRegistry", () => ({
  catalogDisplayName: (e: { packId: string }) => e.packId,
  fetchPackCatalogSafe: mockFetchPackCatalogSafe,
  enrichPackCatalog: mockEnrichPackCatalog,
}));

vi.mock("../lib/tauri", () => ({
  saveLibrarySettings: mockSaveLibrarySettings,
  installPackFromRegistry: vi.fn(),
  cancelPackDownload: vi.fn(),
  clearPackDownloadCancel: vi.fn(),
}));

vi.mock("../lib/windowRole", () => ({
  isTauri: () => mockIsTauri(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  emit: (...args: unknown[]) => mockEmit(...args),
}));

vi.mock("@tauri-apps/api/core", () => ({
  Channel: class {
    onmessage: ((payload: unknown) => void) | null = null;
  },
}));

vi.mock("./useBackgroundTasksStore", () => ({
  useBackgroundTasksStore: {
    getState: () => ({
      showErrorToast: mockShowErrorToast,
      runInBackground: mockRunInBackground,
      tasks: [],
    }),
  },
}));

vi.mock("../lib/i18n", () => ({
  t: (key: string) => key,
}));

vi.mock("../lib/updater", () => ({
  AUTOMATIC_UPDATE_INTERVAL_MS: 5 * 60 * 60 * 1000,
}));

vi.mock("../lib/packs/packInstallActivity", () => ({
  logPackInstallSuccess: vi.fn(),
  logPackInstallFailure: vi.fn(),
}));

vi.mock("../lib/packs/refreshPackStores", () => ({
  refreshPackContributionStores: vi.fn(() => Promise.resolve()),
}));

vi.mock("../lib/toastPayloads", () => ({
  packUpdatesSettleOptions: vi.fn(() => ({
    status: "success",
    label: "ok",
  })),
}));

function catalogEntry(
  overrides: Partial<CatalogPackEntry> &
    Pick<CatalogPackEntry, "packId" | "updateAvailable" | "meetsMinAppVersion">,
): CatalogPackEntry {
  return {
    registryUrl: "https://spk.example",
    authorId: "spiral",
    packId: overrides.packId,
    latestVersion: {
      version: "2.0.0",
      contributionTypes: ["skin"],
      sizeBytes: 10,
      sha256: "a".repeat(64),
      publishedAt: "2026-01-01T00:00:00Z",
    },
    installed: false,
    installedVersion: "1.0.0",
    updateAvailable: overrides.updateAvailable,
    meetsMinAppVersion: overrides.meetsMinAppVersion,
    ...overrides,
  };
}

describe("usePackUpdatesStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsTauri.mockReturnValue(true);
    usePackUpdatesStore.setState({
      pendingUpdates: [],
      status: "idle",
      lastError: null,
      automaticPackChecksEnabled: true,
    });
  });

  it("skips automatic checks when pack setting is off", async () => {
    usePackUpdatesStore.setState({ automaticPackChecksEnabled: false });
    const pending = await usePackUpdatesStore
      .getState()
      .checkForPackUpdates({ reason: "automatic" });
    expect(pending).toEqual([]);
    expect(mockFetchPackCatalogSafe).not.toHaveBeenCalled();
  });

  it("does not skip automatic checks based on app updater setting", async () => {
    mockFetchPackCatalogSafe.mockResolvedValue({
      ok: true,
      catalog: { packs: [] },
    });
    mockEnrichPackCatalog.mockResolvedValue([]);
    await usePackUpdatesStore
      .getState()
      .checkForPackUpdates({ reason: "automatic" });
    expect(mockFetchPackCatalogSafe).toHaveBeenCalled();
  });

  it("keeps previous pending list when catalog fetch fails", async () => {
    const previous = [
      catalogEntry({
        packId: "xbox",
        updateAvailable: true,
        meetsMinAppVersion: true,
      }),
    ];
    usePackUpdatesStore.setState({ pendingUpdates: previous });
    mockFetchPackCatalogSafe.mockResolvedValue({
      ok: false,
      error: "offline",
    });

    const pending = await usePackUpdatesStore
      .getState()
      .checkForPackUpdates({ reason: "automatic" });

    expect(pending).toEqual(previous);
    expect(usePackUpdatesStore.getState().pendingUpdates).toEqual(previous);
  });

  it("filters to updateAvailable && meetsMinAppVersion", async () => {
    mockFetchPackCatalogSafe.mockResolvedValue({
      ok: true,
      catalog: { packs: [{ packId: "a" }, { packId: "b" }, { packId: "c" }] },
    });
    mockEnrichPackCatalog.mockResolvedValue([
      catalogEntry({
        packId: "a",
        updateAvailable: true,
        meetsMinAppVersion: true,
      }),
      catalogEntry({
        packId: "b",
        updateAvailable: true,
        meetsMinAppVersion: false,
      }),
      catalogEntry({
        packId: "c",
        updateAvailable: false,
        meetsMinAppVersion: true,
      }),
    ]);

    const pending = await usePackUpdatesStore
      .getState()
      .checkForPackUpdates({ reason: "manual" });

    expect(pending.map((p) => p.packId)).toEqual(["a"]);
    expect(mockEnrichPackCatalog).toHaveBeenCalledWith(expect.any(Array), {
      resolvePreviews: false,
    });
    expect(mockEmit).toHaveBeenCalled();
  });

  it("applyPendingUpdates replaces the list from another window", () => {
    const next = [
      catalogEntry({
        packId: "t3",
        updateAvailable: true,
        meetsMinAppVersion: true,
      }),
    ];
    usePackUpdatesStore.getState().applyPendingUpdates(next);
    expect(usePackUpdatesStore.getState().pendingUpdates).toEqual(next);
  });

  it("syncPendingFromCatalog filters and broadcasts pending updates", () => {
    usePackUpdatesStore.getState().syncPendingFromCatalog([
      catalogEntry({
        packId: "ready",
        updateAvailable: true,
        meetsMinAppVersion: true,
      }),
      catalogEntry({
        packId: "blocked",
        updateAvailable: true,
        meetsMinAppVersion: false,
      }),
      catalogEntry({
        packId: "current",
        updateAvailable: false,
        meetsMinAppVersion: true,
      }),
    ]);

    expect(
      usePackUpdatesStore.getState().pendingUpdates.map((p) => p.packId),
    ).toEqual(["ready"]);
    expect(usePackUpdatesStore.getState().status).toBe("idle");
    expect(mockEmit).toHaveBeenCalledWith(
      "packs://updates-changed",
      expect.arrayContaining([expect.objectContaining({ packId: "ready" })]),
    );
  });

  it("persists pack automatic-check preference independently", async () => {
    await usePackUpdatesStore.getState().setAutomaticPackChecksEnabled(false);
    expect(mockSaveLibrarySettings).toHaveBeenCalledWith({
      automaticPackUpdateChecksEnabled: false,
    });
    expect(usePackUpdatesStore.getState().automaticPackChecksEnabled).toBe(
      false,
    );
  });
});
