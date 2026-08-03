import { beforeEach, describe, expect, it, vi } from "vitest";
import { useUpdaterStore } from "./useUpdaterStore";

const {
  mockCheckForAvailableUpdate,
  mockDownloadAndInstallPendingUpdate,
  mockShowErrorToast,
  mockSaveLibrarySettings,
  mockIsTauri,
} = vi.hoisted(() => ({
  mockCheckForAvailableUpdate: vi.fn(),
  mockDownloadAndInstallPendingUpdate: vi.fn(),
  mockShowErrorToast: vi.fn(),
  mockSaveLibrarySettings: vi.fn(() => Promise.resolve({})),
  mockIsTauri: vi.fn(() => true),
}));

vi.mock("../lib/updater", () => ({
  AUTOMATIC_UPDATE_INTERVAL_MS: 5 * 60 * 60 * 1000,
  checkForAvailableUpdate: mockCheckForAvailableUpdate,
  downloadAndInstallPendingUpdate: mockDownloadAndInstallPendingUpdate,
}));

vi.mock("../lib/tauri", () => ({
  saveLibrarySettings: mockSaveLibrarySettings,
}));

vi.mock("../lib/windowRole", () => ({
  isTauri: () => mockIsTauri(),
}));

vi.mock("./useBackgroundTasksStore", () => ({
  useBackgroundTasksStore: {
    getState: () => ({
      showErrorToast: mockShowErrorToast,
    }),
  },
}));

vi.mock("../lib/i18n", () => ({
  t: (key: string) => key,
}));

describe("useUpdaterStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsTauri.mockReturnValue(true);
    useUpdaterStore.setState({
      status: "idle",
      availableUpdate: null,
      lastError: null,
      downloadedBytes: 0,
      contentLength: null,
      automaticChecksEnabled: true,
    });
  });

  it("defaults automatic checks to enabled", () => {
    expect(useUpdaterStore.getState().automaticChecksEnabled).toBe(true);
  });

  it("skips automatic checks when the toggle is off", async () => {
    useUpdaterStore.setState({ automaticChecksEnabled: false });

    const result = await useUpdaterStore
      .getState()
      .checkForUpdates({ reason: "automatic" });

    expect(result).toBeNull();
    expect(mockCheckForAvailableUpdate).not.toHaveBeenCalled();
    expect(useUpdaterStore.getState().status).toBe("idle");
  });

  it("still runs manual checks when automatic checks are off", async () => {
    useUpdaterStore.setState({ automaticChecksEnabled: false });
    mockCheckForAvailableUpdate.mockResolvedValue(null);

    await useUpdaterStore.getState().checkForUpdates({ reason: "manual" });

    expect(mockCheckForAvailableUpdate).toHaveBeenCalledOnce();
    expect(useUpdaterStore.getState().status).toBe("upToDate");
  });

  it("sets available status when a newer release is found", async () => {
    const available = {
      version: "0.2.0",
      currentVersion: "0.1.0",
      body: "notes",
    };
    mockCheckForAvailableUpdate.mockResolvedValue(available);

    const result = await useUpdaterStore.getState().checkForUpdates();

    expect(result).toEqual(available);
    expect(useUpdaterStore.getState()).toMatchObject({
      status: "available",
      availableUpdate: available,
      lastError: null,
    });
  });

  it("surfaces check failures via error toast", async () => {
    mockCheckForAvailableUpdate.mockRejectedValue(new Error("network down"));

    await useUpdaterStore.getState().checkForUpdates();

    expect(useUpdaterStore.getState()).toMatchObject({
      status: "error",
      lastError: "network down",
    });
    expect(mockShowErrorToast).toHaveBeenCalledWith({
      key: "updater",
      label: "common:updates.error.check",
      detail: "network down",
    });
  });

  it("downloads, installs, and reports progress", async () => {
    useUpdaterStore.setState({
      status: "available",
      availableUpdate: {
        version: "0.2.0",
        currentVersion: "0.1.0",
      },
    });
    mockDownloadAndInstallPendingUpdate.mockImplementation(
      async (
        onProgress?: (progress: {
          downloadedBytes: number;
          contentLength: number | null;
        }) => void,
      ) => {
        onProgress?.({ downloadedBytes: 10, contentLength: 100 });
        onProgress?.({ downloadedBytes: 100, contentLength: 100 });
      },
    );

    await useUpdaterStore.getState().installAvailableUpdate();

    expect(mockDownloadAndInstallPendingUpdate).toHaveBeenCalledOnce();
    expect(useUpdaterStore.getState()).toMatchObject({
      status: "ready",
      downloadedBytes: 100,
      contentLength: 100,
    });
  });

  it("surfaces install failures via error toast", async () => {
    useUpdaterStore.setState({
      status: "available",
      availableUpdate: {
        version: "0.2.0",
        currentVersion: "0.1.0",
      },
    });
    mockDownloadAndInstallPendingUpdate.mockRejectedValue(
      new Error("signature failed"),
    );

    await useUpdaterStore.getState().installAvailableUpdate();

    expect(useUpdaterStore.getState()).toMatchObject({
      status: "error",
      lastError: "signature failed",
    });
    expect(mockShowErrorToast).toHaveBeenCalledWith({
      key: "updater",
      label: "common:updates.error.install",
      detail: "signature failed",
    });
  });

  it("persists the automatic-checks toggle", async () => {
    await useUpdaterStore.getState().setAutomaticChecksEnabled(false);

    expect(useUpdaterStore.getState().automaticChecksEnabled).toBe(false);
    expect(mockSaveLibrarySettings).toHaveBeenCalledWith({
      automaticUpdateChecksEnabled: false,
    });
  });

  it("starts an automatic check on launch and respects the interval toggle", async () => {
    vi.useFakeTimers();
    mockCheckForAvailableUpdate.mockResolvedValue(null);

    const stop = useUpdaterStore.getState().startAutomaticUpdateChecks();
    await Promise.resolve();
    expect(mockCheckForAvailableUpdate).toHaveBeenCalledTimes(1);

    useUpdaterStore.setState({ automaticChecksEnabled: false });
    await vi.advanceTimersByTimeAsync(5 * 60 * 60 * 1000);
    expect(mockCheckForAvailableUpdate).toHaveBeenCalledTimes(1);

    useUpdaterStore.setState({ automaticChecksEnabled: true });
    await vi.advanceTimersByTimeAsync(5 * 60 * 60 * 1000);
    expect(mockCheckForAvailableUpdate).toHaveBeenCalledTimes(2);

    stop();
    vi.useRealTimers();
  });
});
