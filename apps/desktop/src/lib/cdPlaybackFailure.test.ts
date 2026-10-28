// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
}));

vi.mock("./i18n", () => ({
  t: (key: string) => key,
}));

import {
  classifyCdPlaybackFailure,
  reportCdPlaybackFailure,
  resetCdPlaybackFailureDedupeForTests,
} from "./cdPlaybackFailure";
import { ACTIVITY_LOG_DOMAINS } from "../types/activityLog";

describe("classifyCdPlaybackFailure", () => {
  it("treats disconnect and mid-stream read failures as disconnected", () => {
    expect(classifyCdPlaybackFailure("Disc drive disconnected")).toBe(
      "disconnected",
    );
    expect(classifyCdPlaybackFailure("Failed to read CD audio data")).toBe(
      "disconnected",
    );
  });

  it("treats empty-tray messages as no_disc", () => {
    expect(classifyCdPlaybackFailure("No audio CD in drive")).toBe("no_disc");
  });

  it("treats other messages as generic", () => {
    expect(classifyCdPlaybackFailure("Track 3 not found on disc")).toBe(
      "generic",
    );
  });
});

describe("reportCdPlaybackFailure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetCdPlaybackFailureDedupeForTests();
  });

  afterEach(() => {
    resetCdPlaybackFailureDedupeForTests();
  });

  it("toasts and logs a disconnect with specific copy keys", () => {
    const kind = reportCdPlaybackFailure({
      message: "Disc drive disconnected",
      driveId: "disk4",
      trackNumber: 2,
    });

    expect(kind).toBe("disconnected");
    expect(mockShowErrorToast).toHaveBeenCalledWith({
      key: "cd-playback-error",
      label: "playback:cd.disconnected.label",
      detail: "playback:cd.disconnected.detail",
    });
    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "warn",
        domain: ACTIVITY_LOG_DOMAINS.cdPlayback,
        context: { driveId: "disk4" },
        details: expect.objectContaining({
          kind: "disconnected",
          rawMessage: "Disc drive disconnected",
          trackNumber: 2,
        }),
      }),
    );
  });

  it("toasts generic failures with the raw message and View logs", () => {
    reportCdPlaybackFailure({
      message: "Track 3 not found on disc",
      driveId: "disk4",
    });

    expect(mockShowErrorToast).toHaveBeenCalledWith({
      key: "cd-playback-error",
      label: "playback:cd.playbackFailed.label",
      detail: "Track 3 not found on disc",
      logLink: true,
    });
    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "error",
        domain: ACTIVITY_LOG_DOMAINS.cdPlayback,
      }),
    );
  });

  it("does not attach View logs for known disconnect/no-disc failures", () => {
    reportCdPlaybackFailure({
      message: "No audio CD in drive",
      driveId: "disk4",
    });

    expect(mockShowErrorToast).toHaveBeenCalledWith({
      key: "cd-playback-error",
      label: "playback:cd.playbackFailed.label",
      detail: "playback:cd.noDisc.detail",
    });
    expect(mockShowErrorToast.mock.calls[0][0].logLink).toBeUndefined();
  });

  it("dedupes rapid reports for the same drive", () => {
    reportCdPlaybackFailure({
      message: "Disc drive disconnected",
      driveId: "disk4",
    });
    reportCdPlaybackFailure({
      message: "No audio CD in drive",
      driveId: "disk4",
    });

    expect(mockShowErrorToast).toHaveBeenCalledTimes(1);
    expect(mockLogActivity).toHaveBeenCalledTimes(1);
  });
});
