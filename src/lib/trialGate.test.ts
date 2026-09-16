import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../store/useLicenseStore", () => ({
  useLicenseStore: {
    getState: () => ({
      snapshot: mocks.licenseSnapshot,
      loaded: mocks.licenseLoaded,
      openSpiralCard: mocks.openSpiralCard,
    }),
  },
}));

vi.mock("../store/usePlayerStore", () => ({
  usePlayerStore: {
    getState: () => ({
      library: mocks.library,
    }),
    setState: mocks.setPlayerState,
  },
}));

const mocks = vi.hoisted(() => ({
  openSpiralCard: vi.fn(),
  setPlayerState: vi.fn(),
  licenseLoaded: true,
  licenseSnapshot: {
    status: "trial" as import("../types/license").LicenseStatus,
    installed: false,
    productKey: null as string | null,
    sku: null as import("../types/license").LicenseSku | null,
    originalPurchaseId: null as string | null,
    channel: null as string | null,
    issuedAt: null as string | null,
    expiresAt: null as string | null,
    cosmetic: null,
    error: null as string | null,
    demoted: null as import("../types/license").LicenseDemoted | null,
  },
  library: [] as { id: number; importStatus?: string }[],
}));

import {
  blockIfTrialCannotFit,
  blockIfTrialLibraryAtCap,
  isTrialLibraryAtCap,
  isTrialLibraryCapError,
  licenseUnlocksLibrary,
  persistedLibraryTrackCount,
  TRIAL_LIBRARY_TRACK_CAP,
  trialSlotsRemaining,
} from "./trialGate";
import type { LicenseStatus } from "../types/license";
import type { Track } from "../types/track";

function track(id: number, importing = false): Track {
  return {
    id,
    title: `T${id}`,
    artist: null,
    album: null,
    albumArtist: null,
    trackNumber: null,
    totalTracks: null,
    discNumber: null,
    totalDiscs: null,
    year: null,
    genre: null,
    durationSeconds: null,
    sampleRate: null,
    bitrate: null,
    codec: null,
    filePath: `/t${id}.mp3`,
    artPath: null,
    dateAdded: "2026-01-01T00:00:00Z",
    playCount: 0,
    lastPlayedAt: null,
    rating: 0,
    lyricsFormat: null,
    ...(importing ? { importStatus: "importing" as const } : {}),
  };
}

describe("trialGate", () => {
  beforeEach(() => {
    mocks.openSpiralCard.mockReset();
    mocks.setPlayerState.mockReset();
    mocks.licenseLoaded = true;
    mocks.licenseSnapshot.status = "trial";
    mocks.library = [];
  });

  it("counts only persisted library rows toward the cap", () => {
    const library = [track(1), track(2), track(-1, true), track(3)];
    expect(persistedLibraryTrackCount(library)).toBe(3);
  });

  it("unlocks for provisional, readyToUpdate, and licensed", () => {
    const unlocked: LicenseStatus[] = [
      "provisional",
      "readyToUpdate",
      "licensed",
    ];
    for (const status of unlocked) {
      expect(licenseUnlocksLibrary(status)).toBe(true);
      expect(trialSlotsRemaining([track(1)], status)).toBeNull();
    }
    expect(licenseUnlocksLibrary("trial")).toBe(false);
  });

  it("reports remaining slots under the PoC cap", () => {
    mocks.library = Array.from(
      { length: TRIAL_LIBRARY_TRACK_CAP - 3 },
      (_, i) => track(i + 1),
    );
    expect(trialSlotsRemaining(mocks.library as Track[], "trial")).toBe(3);
    expect(isTrialLibraryAtCap()).toBe(false);
  });

  it("blocks when trial library is at cap", () => {
    mocks.library = Array.from({ length: TRIAL_LIBRARY_TRACK_CAP }, (_, i) =>
      track(i + 1),
    );
    expect(isTrialLibraryAtCap()).toBe(true);
    expect(blockIfTrialLibraryAtCap()).toBe(true);
    expect(mocks.openSpiralCard).toHaveBeenCalled();
    expect(mocks.setPlayerState).not.toHaveBeenCalled();
  });

  it("does not treat an unloaded license store as a trial cap", () => {
    mocks.library = Array.from({ length: TRIAL_LIBRARY_TRACK_CAP }, (_, i) =>
      track(i + 1),
    );
    mocks.licenseLoaded = false;
    expect(isTrialLibraryAtCap()).toBe(false);
    expect(blockIfTrialLibraryAtCap()).toBe(false);
    expect(mocks.openSpiralCard).not.toHaveBeenCalled();
  });

  it("lifts the frontend gate immediately when status is no longer trial", () => {
    mocks.library = Array.from({ length: TRIAL_LIBRARY_TRACK_CAP }, (_, i) =>
      track(i + 1),
    );
    mocks.licenseSnapshot.status = "licensed";
    expect(isTrialLibraryAtCap()).toBe(false);
    expect(blockIfTrialLibraryAtCap()).toBe(false);
    expect(mocks.openSpiralCard).not.toHaveBeenCalled();
  });

  it("blocks convert add_new batches that cannot fit", () => {
    mocks.library = Array.from(
      { length: TRIAL_LIBRARY_TRACK_CAP - 2 },
      (_, i) => track(i + 1),
    );
    expect(blockIfTrialCannotFit(3)).toBe(true);
    expect(blockIfTrialCannotFit(2)).toBe(false);
  });

  it("detects Rust trial-cap error strings", () => {
    expect(
      isTrialLibraryCapError(
        `trial_library_cap: Free trial is limited to a library of ${TRIAL_LIBRARY_TRACK_CAP} tracks.`,
      ),
    ).toBe(true);
    expect(isTrialLibraryCapError("disk full")).toBe(false);
  });
});
