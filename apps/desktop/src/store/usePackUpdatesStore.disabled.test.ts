import { describe, expect, it, vi } from "vitest";

const { mockFetchPackCatalogSafe } = vi.hoisted(() => ({
  mockFetchPackCatalogSafe: vi.fn(),
}));

vi.mock("../lib/featureFlags", () => ({ REGISTRY_ENABLED: false }));
vi.mock("../lib/packRegistry", () => ({
  catalogDisplayName: (e: { packId: string }) => e.packId,
  fetchPackCatalogSafe: mockFetchPackCatalogSafe,
  enrichPackCatalog: vi.fn(),
  PACK_UPDATES_BULK_KEY: "pack-updates-bulk",
}));
vi.mock("../lib/tauri", () => ({
  saveLibrarySettings: vi.fn(),
  installPackFromRegistry: vi.fn(),
  cancelPackDownload: vi.fn(),
  clearPackDownloadCancel: vi.fn(),
}));
vi.mock("../lib/windowRole", () => ({ isTauri: () => true }));
vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn(() => Promise.resolve()),
}));

import { usePackUpdatesStore } from "./usePackUpdatesStore";

describe("usePackUpdatesStore with the registry flagged off", () => {
  it("never contacts the registry for manual or automatic checks", async () => {
    const { checkForPackUpdates, startAutomaticPackUpdateChecks } =
      usePackUpdatesStore.getState();

    expect(await checkForPackUpdates({ reason: "manual" })).toEqual([]);
    expect(await checkForPackUpdates({ reason: "automatic" })).toEqual([]);

    const stop = startAutomaticPackUpdateChecks();
    stop();

    expect(mockFetchPackCatalogSafe).not.toHaveBeenCalled();
    expect(usePackUpdatesStore.getState().pendingUpdates).toEqual([]);
  });
});
