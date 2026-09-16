import { describe, expect, it } from "vitest";
import { localDateYmd } from "../store/useLicenseStore";

describe("localDateYmd", () => {
  it("formats local calendar day as YYYY-MM-DD", () => {
    expect(localDateYmd(new Date(2026, 8, 15))).toBe("2026-09-15");
    expect(localDateYmd(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});
