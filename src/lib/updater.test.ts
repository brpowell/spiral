import { describe, expect, it } from "vitest";
import { isUpdaterEnabled, UPDATER_ENABLE_ENV } from "./updater";

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
