// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockShowErrorToast, mockLogActivity } = vi.hoisted(() => ({
  mockShowErrorToast: vi.fn(),
  mockLogActivity: vi.fn(),
}));

vi.mock("../store/useBackgroundTasksStore", () => ({
  useBackgroundTasksStore: {
    getState: () => ({
      showErrorToast: mockShowErrorToast,
    }),
  },
}));

vi.mock("./activityLog", () => ({
  logActivity: mockLogActivity,
  createOperationId: () => "op-unexpected-test",
}));

vi.mock("./i18n", () => ({
  t: (key: string) => key,
}));

import { reportUnexpectedError } from "./unexpectedErrorToast";
import { ACTIVITY_LOG_DOMAINS } from "../types/activityLog";

describe("reportUnexpectedError", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("toasts library playback failures with friendly copy and View logs", () => {
    reportUnexpectedError({
      kind: "libraryPlayback",
      err: new Error("Decoder error: unsupported codec"),
    });

    expect(mockShowErrorToast).toHaveBeenCalledWith({
      key: "library-playback-error",
      label: "toasts:playback.failed",
      detail: "toasts:playback.failedDetail",
      logLink: { operationId: "op-unexpected-test" },
    });
    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "error",
        domain: ACTIVITY_LOG_DOMAINS.libraryPlayback,
        operationId: "op-unexpected-test",
        message: "Library playback failed: Decoder error: unsupported codec",
        details: {
          rawMessage: "Decoder error: unsupported codec",
        },
      }),
    );
  });

  it("toasts library load failures with friendly copy and View logs", () => {
    reportUnexpectedError({
      kind: "libraryLoad",
      err: "database is locked",
    });

    expect(mockShowErrorToast).toHaveBeenCalledWith({
      key: "library-load-error",
      label: "toasts:library.loadFailed",
      detail: "toasts:library.loadFailedDetail",
      logLink: { operationId: "op-unexpected-test" },
    });
    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "error",
        domain: ACTIVITY_LOG_DOMAINS.libraryLoad,
        operationId: "op-unexpected-test",
        message: "Failed to load library: database is locked",
        details: { rawMessage: "database is locked" },
      }),
    );
  });

  it("toasts import picker failures with friendly copy and View logs", () => {
    reportUnexpectedError({
      kind: "importPicker",
      err: new Error("dialog failed"),
      details: { phase: "pick" },
    });

    expect(mockShowErrorToast).toHaveBeenCalledWith({
      key: "import-picker-error",
      label: "toasts:import.pickerFailed",
      detail: "toasts:import.pickerFailedDetail",
      logLink: { operationId: "op-unexpected-test" },
    });
    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "error",
        domain: ACTIVITY_LOG_DOMAINS.import,
        operationId: "op-unexpected-test",
        message: "Import failed: dialog failed",
        details: {
          rawMessage: "dialog failed",
          phase: "pick",
        },
      }),
    );
  });
});
