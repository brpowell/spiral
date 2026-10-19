import { beforeEach, describe, expect, it, vi } from "vitest";
import { useItemUpdatesStore } from "./useItemUpdatesStore";
import type { ItemUpdate } from "../types/itemRegistry";

const {
  mockCheckItemUpdates,
  mockInstallItemFromRegistry,
  mockSaveLibrarySettings,
  mockIsTauri,
  mockEmit,
  mockShowErrorToast,
  mockRunInBackground,
  mockLogSuccess,
  mockLogFailure,
  mockSettleOptions,
} = vi.hoisted(() => ({
  mockCheckItemUpdates: vi.fn(),
  mockInstallItemFromRegistry: vi.fn(),
  mockSaveLibrarySettings: vi.fn(() => Promise.resolve({})),
  mockIsTauri: vi.fn(() => true),
  mockEmit: vi.fn((..._args: unknown[]) => Promise.resolve()),
  mockShowErrorToast: vi.fn(),
  mockRunInBackground: vi.fn(),
  mockLogSuccess: vi.fn(),
  mockLogFailure: vi.fn(),
  mockSettleOptions: vi.fn(() => ({ status: "success", label: "ok" })),
}));

vi.mock("../lib/itemRegistry", () => ({
  ITEM_UPDATES_BULK_KEY: "item-updates-bulk",
  isDownloadCancelled: (message: string) =>
    /item download cancelled/i.test(message),
}));

vi.mock("../lib/tauri", () => ({
  saveLibrarySettings: mockSaveLibrarySettings,
  checkItemUpdates: mockCheckItemUpdates,
  installItemFromRegistry: mockInstallItemFromRegistry,
  cancelItemDownload: vi.fn(),
  clearItemDownloadCancel: vi.fn(),
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
  logRegistryInstallSuccess: mockLogSuccess,
  logRegistryInstallFailure: mockLogFailure,
}));

vi.mock("../lib/packs/refreshPackStores", () => ({
  refreshPackContributionStores: vi.fn(() => Promise.resolve()),
}));

vi.mock("../lib/scheduling", () => ({
  afterUiTransition: () => Promise.resolve(),
}));

vi.mock("../lib/toastPayloads", () => ({
  packUpdatesSettleOptions: mockSettleOptions,
}));

function update(id: string, overrides?: Partial<ItemUpdate>): ItemUpdate {
  return {
    registryUrl: "https://spk.example",
    publisherId: "spiral",
    itemType: "theme",
    id,
    effectiveId: `spiral.theme.${id}`,
    installedVersion: "1.0.0",
    latest: {
      version: "2.0.0",
      name: id,
      sizeBytes: 10,
      sha256: "a".repeat(64),
      publishedAt: "2026-01-01T00:00:00Z",
    },
    ...overrides,
  };
}

/** Run the bulk task body the way the background-task runner would. */
function runBackgroundTask() {
  mockRunInBackground.mockImplementation(
    ({ run }: { run: (ctx: unknown) => Promise<void> }) => {
      const ctx = {
        isCancelRequested: () => false,
        setLabel: vi.fn(),
        setProgress: vi.fn(),
        settleAs: vi.fn(),
      };
      void run(ctx).catch(() => {});
      return ctx;
    },
  );
}

describe("useItemUpdatesStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsTauri.mockReturnValue(true);
    useItemUpdatesStore.setState({
      pendingUpdates: [],
      status: "idle",
      lastError: null,
      automaticItemChecksEnabled: true,
    });
  });

  it("skips automatic checks when the item setting is off", async () => {
    useItemUpdatesStore.setState({ automaticItemChecksEnabled: false });
    const pending = await useItemUpdatesStore
      .getState()
      .checkForItemUpdates({ reason: "automatic" });
    expect(pending).toEqual([]);
    expect(mockCheckItemUpdates).not.toHaveBeenCalled();
  });

  it("still runs a manual check when automatic checks are off", async () => {
    useItemUpdatesStore.setState({ automaticItemChecksEnabled: false });
    mockCheckItemUpdates.mockResolvedValue({ updates: [], errors: [] });
    await useItemUpdatesStore
      .getState()
      .checkForItemUpdates({ reason: "manual" });
    expect(mockCheckItemUpdates).toHaveBeenCalledTimes(1);
  });

  it("stores and broadcasts the updates a check returns", async () => {
    const updates = [update("noir"), update("grove")];
    mockCheckItemUpdates.mockResolvedValue({ updates, errors: [] });

    const pending = await useItemUpdatesStore
      .getState()
      .checkForItemUpdates({ reason: "manual" });

    expect(pending).toEqual(updates);
    expect(useItemUpdatesStore.getState().pendingUpdates).toEqual(updates);
    expect(useItemUpdatesStore.getState().status).toBe("idle");
    expect(mockEmit).toHaveBeenCalledWith("items://updates-changed", updates);
  });

  it("clears pending when a check finds nothing and no registry failed", async () => {
    useItemUpdatesStore.setState({ pendingUpdates: [update("noir")] });
    mockCheckItemUpdates.mockResolvedValue({ updates: [], errors: [] });
    await useItemUpdatesStore.getState().checkForItemUpdates();
    expect(useItemUpdatesStore.getState().pendingUpdates).toEqual([]);
  });

  it("keeps the previous pending list when a registry failed and nothing came back", async () => {
    const previous = [update("noir")];
    useItemUpdatesStore.setState({ pendingUpdates: previous });
    mockCheckItemUpdates.mockResolvedValue({
      updates: [],
      errors: [{ registryUrl: "https://spk.example", error: "offline" }],
    });

    const pending = await useItemUpdatesStore
      .getState()
      .checkForItemUpdates({ reason: "automatic" });

    expect(pending).toEqual(previous);
    expect(useItemUpdatesStore.getState().pendingUpdates).toEqual(previous);
    expect(useItemUpdatesStore.getState().lastError).toBe("offline");
    expect(useItemUpdatesStore.getState().status).toBe("idle");
  });

  it("reports an error status when the very first check fails", async () => {
    mockCheckItemUpdates.mockRejectedValue("boom");
    await useItemUpdatesStore.getState().checkForItemUpdates();
    expect(useItemUpdatesStore.getState().status).toBe("error");
    expect(useItemUpdatesStore.getState().lastError).toBe("boom");
  });

  it("does nothing outside Tauri", async () => {
    mockIsTauri.mockReturnValue(false);
    await expect(
      useItemUpdatesStore.getState().checkForItemUpdates(),
    ).resolves.toEqual([]);
    expect(mockCheckItemUpdates).not.toHaveBeenCalled();
  });

  it("applyPendingUpdates replaces the list from another window", () => {
    const next = [update("t3")];
    useItemUpdatesStore.getState().applyPendingUpdates(next);
    expect(useItemUpdatesStore.getState().pendingUpdates).toEqual(next);
  });

  it("looks up and removes a pending update by effective id", () => {
    useItemUpdatesStore.setState({
      pendingUpdates: [update("noir"), update("grove")],
    });
    expect(
      useItemUpdatesStore.getState().pendingUpdateFor("spiral.theme.noir")?.id,
    ).toBe("noir");
    expect(
      useItemUpdatesStore.getState().pendingUpdateFor("spiral.theme.none"),
    ).toBeNull();

    useItemUpdatesStore.getState().removePendingUpdate("spiral.theme.noir");
    expect(
      useItemUpdatesStore.getState().pendingUpdates.map((u) => u.id),
    ).toEqual(["grove"]);
    expect(mockEmit).toHaveBeenCalledWith(
      "items://updates-changed",
      expect.arrayContaining([expect.objectContaining({ id: "grove" })]),
    );
  });

  it("persists the automatic-check preference", async () => {
    await useItemUpdatesStore.getState().setAutomaticItemChecksEnabled(false);
    expect(mockSaveLibrarySettings).toHaveBeenCalledWith({
      automaticItemUpdateChecksEnabled: false,
    });
    expect(useItemUpdatesStore.getState().automaticItemChecksEnabled).toBe(
      false,
    );
  });

  describe("updateAllPendingItems", () => {
    it("installs each queued update by identity and drops it from pending", async () => {
      runBackgroundTask();
      mockCheckItemUpdates.mockResolvedValue({ updates: [], errors: [] });
      mockInstallItemFromRegistry.mockImplementation(
        async (args: { id: string; version: string }) => ({
          effectiveId: `spiral.theme.${args.id}`,
          version: args.version,
        }),
      );
      useItemUpdatesStore.setState({
        pendingUpdates: [update("noir"), update("grove")],
      });

      await useItemUpdatesStore.getState().updateAllPendingItems();

      expect(mockInstallItemFromRegistry).toHaveBeenCalledTimes(2);
      expect(mockInstallItemFromRegistry).toHaveBeenCalledWith(
        expect.objectContaining({
          registryUrl: "https://spk.example",
          publisherId: "spiral",
          itemType: "theme",
          id: "noir",
          version: "2.0.0",
          sha256: "a".repeat(64),
          sizeBytes: 10,
        }),
      );
      expect(mockLogSuccess).toHaveBeenCalledTimes(2);
      expect(mockSettleOptions).toHaveBeenCalledWith(
        expect.objectContaining({ updated: 2, failed: 0 }),
      );
      expect(useItemUpdatesStore.getState().status).toBe("idle");
    });

    it("keeps going after one item fails and counts it", async () => {
      runBackgroundTask();
      mockCheckItemUpdates.mockResolvedValue({ updates: [], errors: [] });
      mockInstallItemFromRegistry
        .mockRejectedValueOnce("registry returned 500")
        .mockResolvedValueOnce({ effectiveId: "spiral.theme.grove" });
      useItemUpdatesStore.setState({
        pendingUpdates: [update("noir"), update("grove")],
      });

      await useItemUpdatesStore.getState().updateAllPendingItems();

      expect(mockLogFailure).toHaveBeenCalledTimes(1);
      expect(mockLogFailure).toHaveBeenCalledWith(
        expect.objectContaining({ id: "noir", itemType: "theme" }),
      );
      expect(mockSettleOptions).toHaveBeenCalledWith(
        expect.objectContaining({ updated: 1, failed: 1 }),
      );
    });

    it("does nothing when there is nothing pending", async () => {
      await useItemUpdatesStore.getState().updateAllPendingItems();
      expect(mockRunInBackground).not.toHaveBeenCalled();
    });
  });
});
