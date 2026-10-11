import { describe, expect, it, vi } from "vitest";
import {
  createMockAvailableUpdate,
  isUpdaterEnabled,
  MOCK_UPDATE_VERSION,
  UPDATER_ENABLE_ENV,
} from "./updater";

describe("isUpdaterEnabled", () => {
  it("is always on outside DEV", () => {
    expect(isUpdaterEnabled({ isDev: false })).toBe(true);
    expect(isUpdaterEnabled({ isDev: false, enableFlag: undefined })).toBe(
      true,
    );
  });

  it("is off in DEV without an override", () => {
    expect(isUpdaterEnabled({ isDev: true, enableFlag: undefined })).toBe(
      false,
    );
    expect(isUpdaterEnabled({ isDev: true, enableFlag: "" })).toBe(false);
    expect(isUpdaterEnabled({ isDev: true, enableFlag: "0" })).toBe(false);
  });

  it(`turns on in DEV when ${UPDATER_ENABLE_ENV} is 1 or true`, () => {
    expect(isUpdaterEnabled({ isDev: true, enableFlag: "1" })).toBe(true);
    expect(isUpdaterEnabled({ isDev: true, enableFlag: "true" })).toBe(true);
    expect(isUpdaterEnabled({ isDev: true, enableFlag: "TRUE" })).toBe(true);
    expect(isUpdaterEnabled({ isDev: true, enableFlag: " 1 " })).toBe(true);
  });
});

describe("createMockAvailableUpdate", () => {
  it("builds a fake pending update with the mock version", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-26T15:00:00.000Z"));

    const update = createMockAvailableUpdate("1.2.3");

    expect(update).toEqual({
      version: MOCK_UPDATE_VERSION,
      currentVersion: "1.2.3",
      date: "2026-08-26T15:00:00.000Z",
      body: expect.stringContaining("### Features"),
    });
    expect(update.body).toContain("Simulated release");

    vi.useRealTimers();
  });
});
