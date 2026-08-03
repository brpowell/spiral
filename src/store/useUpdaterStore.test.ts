import { beforeEach, describe, expect, it, vi } from "vitest";
import { useUpdaterStore } from "./useUpdaterStore";

const {
  mockCheckForAvailableUpdate,
  mockDownloadAndInstallPendingUpdate,
  mockIsUpdaterEnabled,
  mockShowErrorToast,
  mockShowToast,
  mockRunInBackground,
  mockDismissTask,
  mockSaveLibrarySettings,
  mockIsTauri,
} = vi.hoisted(() => ({
  mockCheckForAvailableUpdate: vi.fn(),
  mockDownloadAndInstallPendingUpdate: vi.fn(),
  mockIsUpdaterEnabled: vi.fn(() => true),
  mockShowErrorToast: vi.fn(),
  mockShowToast: vi.fn(),
  mockRunInBackground: vi.fn(),
  mockDismissTask: vi.fn(),
  mockSaveLibrarySettings: vi.fn(() => Promise.resolve({})),
  mockIsTauri: vi.fn(() => true),
}));

vi.mock("../lib/updater", () => ({
  AUTOMATIC_UPDATE_INTERVAL_MS: 5 * 60 * 60 * 1000,
  checkForAvailableUpdate: mockCheckForAvailableUpdate,
  downloadAndInstallPendingUpdate: mockDownloadAndInstallPendingUpdate,
  isUpdaterEnabled: () => mockIsUpdaterEnabled(),
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
      showToast: mockShowToast,
      runInBackground: mockRunInBackground,
      dismissTask: mockDismissTask,
      tasks: [],
    }),
  },
}));

vi.mock("../lib/i18n", () => ({
  t: (key: string, opts?: { version?: string }) =>
    opts?.version ? `${key}:${opts.version}` : key,
}));

type RunCtx = {
  setProgress: ReturnType<typeof vi.fn>;
  setLabel: ReturnType<typeof vi.fn>;
  dismissSilently: ReturnType<typeof vi.fn>;
  settleAs: ReturnType<typeof vi.fn>;
};

describe("useUpdaterStore", () => {
  let lastCtx: RunCtx;

  beforeEach(() => {
    vi.clearAllMocks();
    mockIsTauri.mockReturnValue(true);
    mockIsUpdaterEnabled.mockReturnValue(true);
    mockRunInBackground.mockImplementation(
      ({ run }: { run: (ctx: RunCtx) => Promise<void> }) => {
        lastCtx = {
          setProgress: vi.fn(),
          setLabel: vi.fn(),
          dismissSilently: vi.fn(),
          settleAs: vi.fn(),
        };
        // Match real runInBackground: fire-and-forget with internal error handling.
        const done = run(lastCtx).catch(() => {});
        return done.then(() => "task-id");
      },
    );
    useUpdaterStore.setState({
      status: "idle",
      availableUpdate: null,
      lastError: null,
      downloadedBytes: 0,
      contentLength: null,
      automaticChecksEnabled: true,
      notifiedUpdateVersion: null,
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

  it("skips automatic checks when the debug updater gate is closed", async () => {
    mockIsUpdaterEnabled.mockReturnValue(false);

    const result = await useUpdaterStore
      .getState()
      .checkForUpdates({ reason: "automatic" });

    expect(result).toBeNull();
    expect(mockCheckForAvailableUpdate).not.toHaveBeenCalled();
    expect(mockShowErrorToast).not.toHaveBeenCalled();
    expect(useUpdaterStore.getState().status).toBe("idle");
  });

  it("surfaces a clear error on manual check when the debug gate is closed", async () => {
    mockIsUpdaterEnabled.mockReturnValue(false);

    const result = await useUpdaterStore
      .getState()
      .checkForUpdates({ reason: "manual" });

    expect(result).toBeNull();
    expect(mockCheckForAvailableUpdate).not.toHaveBeenCalled();
    expect(useUpdaterStore.getState()).toMatchObject({
      status: "error",
      lastError: "common:updates.error.disabledInDev",
    });
    expect(mockShowErrorToast).toHaveBeenCalledWith({
      key: "updater",
      label: "common:updates.error.disabledInDev",
      detail: "common:updates.error.disabledInDevDetail",
    });
  });

  it("does not start the automatic-check interval when the debug gate is closed", async () => {
    mockIsUpdaterEnabled.mockReturnValue(false);
    vi.useFakeTimers();

    const stop = useUpdaterStore.getState().startAutomaticUpdateChecks();
    await Promise.resolve();
    expect(mockCheckForAvailableUpdate).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(5 * 60 * 60 * 1000);
    expect(mockCheckForAvailableUpdate).not.toHaveBeenCalled();

    stop();
    vi.useRealTimers();
  });

  it("still runs manual checks when automatic checks are off", async () => {
    useUpdaterStore.setState({ automaticChecksEnabled: false });
    mockCheckForAvailableUpdate.mockResolvedValue(null);

    await useUpdaterStore.getState().checkForUpdates({ reason: "manual" });

    expect(mockCheckForAvailableUpdate).toHaveBeenCalledOnce();
    expect(useUpdaterStore.getState().status).toBe("upToDate");
    expect(mockRunInBackground).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "updater",
        label: "common:updates.checking",
      }),
    );
    expect(lastCtx.settleAs).toHaveBeenCalledWith({
      status: "success",
      label: "common:updates.upToDate",
    });
    expect(mockShowToast).not.toHaveBeenCalled();
  });

  it("sets available status and settles the same toast as a confirmation", async () => {
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
      notifiedUpdateVersion: "0.2.0",
    });
    expect(lastCtx.settleAs).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "info",
        label: "common:updates.available.label",
        detail: "common:updates.available.detail:0.2.0",
        actions: expect.arrayContaining([
          expect.objectContaining({ id: "update" }),
          expect.objectContaining({ id: "later" }),
        ]),
      }),
    );
    expect(mockShowToast).not.toHaveBeenCalled();
  });

  it("does not re-toast the same version on automatic re-checks", async () => {
    const available = {
      version: "0.2.0",
      currentVersion: "0.1.0",
    };
    mockCheckForAvailableUpdate.mockResolvedValue(available);

    await useUpdaterStore.getState().checkForUpdates({ reason: "automatic" });
    expect(mockShowToast).toHaveBeenCalledTimes(1);

    await useUpdaterStore.getState().checkForUpdates({ reason: "automatic" });
    expect(mockShowToast).toHaveBeenCalledTimes(1);
    expect(useUpdaterStore.getState().status).toBe("available");
  });

  it("re-toasts the same version on an explicit manual check", async () => {
    const available = {
      version: "0.2.0",
      currentVersion: "0.1.0",
    };
    mockCheckForAvailableUpdate.mockResolvedValue(available);
    useUpdaterStore.setState({ notifiedUpdateVersion: "0.2.0" });

    await useUpdaterStore.getState().checkForUpdates({ reason: "manual" });

    expect(lastCtx.settleAs).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "info",
        label: "common:updates.available.label",
      }),
    );
  });

  it("surfaces check failures via settleAs error on the checking toast", async () => {
    mockCheckForAvailableUpdate.mockRejectedValue(new Error("network down"));

    await useUpdaterStore.getState().checkForUpdates();

    expect(useUpdaterStore.getState()).toMatchObject({
      status: "error",
      lastError: "network down",
    });
    expect(lastCtx.settleAs).toHaveBeenCalledWith({
      status: "error",
      label: "common:updates.error.check",
      detail: "network down",
    });
    expect(mockShowErrorToast).not.toHaveBeenCalled();
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
    expect(mockRunInBackground).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "updater-install",
        label: "common:updates.downloading",
      }),
    );
    expect(useUpdaterStore.getState()).toMatchObject({
      status: "ready",
      downloadedBytes: 100,
      contentLength: 100,
    });
  });

  it("surfaces install failures via background task error", async () => {
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
    expect(mockRunInBackground).toHaveBeenCalledOnce();
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
