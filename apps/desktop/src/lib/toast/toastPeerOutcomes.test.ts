import { describe, expect, it } from "vitest";
import {
  formatPeerOutcomeTitle,
  joinPeerOutcomeClauses,
} from "./toastPeerOutcomes";

describe("joinPeerOutcomeClauses", () => {
  it("joins with middot and drops empties", () => {
    expect(joinPeerOutcomeClauses(["2 imported", "", "1 failed"])).toBe(
      "2 imported · 1 failed",
    );
  });
});

describe("formatPeerOutcomeTitle", () => {
  it("omits prefix when an anchored verb survives", () => {
    expect(
      formatPeerOutcomeTitle(
        [{ text: "3 imported", anchored: true }, { text: "1 failed" }],
        { operation: "Import", fallback: "Import finished" },
      ),
    ).toBe("3 imported · 1 failed");
  });

  it("prefixes when every surviving clause is generic", () => {
    expect(
      formatPeerOutcomeTitle([{ text: "10 failed" }], {
        operation: "Convert",
        fallback: "Convert failed",
      }),
    ).toBe("Convert: 10 failed");

    expect(
      formatPeerOutcomeTitle(
        [{ text: "1 fetched" }, { text: "1 not found" }, { text: "1 failed" }],
        { operation: "Lyrics", fallback: "Fetching lyrics…" },
      ),
    ).toBe("Lyrics: 1 fetched · 1 not found · 1 failed");
  });

  it("uses fallback when nothing remains", () => {
    expect(
      formatPeerOutcomeTitle([], {
        operation: "Import",
        fallback: "Import finished",
      }),
    ).toBe("Import finished");
  });
});
