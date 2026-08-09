import { describe, expect, it, vi } from "vitest";

vi.mock("../store/usePlayerStore", () => ({
  usePlayerStore: {
    getState: () => ({
      openTrackEditor: vi.fn(),
    }),
  },
}));

import {
  formatLyricsFetchPeerTitle,
  lyricsAmbiguousSettleOptions,
  lyricsFetchBulkSettleOptions,
} from "./lyricsFetchToastSettle";

describe("formatLyricsFetchPeerTitle", () => {
  it("uses number-first middot peers with Lyrics prefix", () => {
    expect(
      formatLyricsFetchPeerTitle({
        found: 1,
        notFound: 1,
        ambiguous: 1,
        failed: 1,
      }),
    ).toBe("Lyrics: 1 fetched · 1 not found · 1 need review · 1 failed");
  });

  it("keeps Lyrics prefix for a single outcome type", () => {
    expect(
      formatLyricsFetchPeerTitle({
        found: 8,
        notFound: 0,
        ambiguous: 0,
        failed: 0,
      }),
    ).toBe("Lyrics: 8 fetched");
    expect(
      formatLyricsFetchPeerTitle({
        found: 0,
        notFound: 0,
        ambiguous: 0,
        failed: 3,
      }),
    ).toBe("Lyrics: 3 failed");
  });
});

describe("lyricsFetchBulkSettleOptions", () => {
  it("colors by failed only", () => {
    expect(
      lyricsFetchBulkSettleOptions({
        tally: { found: 5, notFound: 3, ambiguous: 0, failed: 0 },
      }).status,
    ).toBe("success");

    expect(
      lyricsFetchBulkSettleOptions({
        tally: { found: 2, notFound: 0, ambiguous: 0, failed: 1 },
        errorLines: ["Song: boom"],
      }).status,
    ).toBe("warning");

    expect(
      lyricsFetchBulkSettleOptions({
        tally: { found: 0, notFound: 1, ambiguous: 0, failed: 2 },
        operationId: "op-1",
      }).status,
    ).toBe("error");
  });

  it("gives Review + View logs when need-review and failures coexist", () => {
    const settle = lyricsFetchBulkSettleOptions({
      tally: { found: 1, notFound: 0, ambiguous: 1, failed: 1 },
      errorLines: ["Song D: network timeout"],
      operationId: "op-1",
      reviewTrackId: 42,
    });
    expect(settle).toMatchObject({
      status: "warning",
      label: "Lyrics: 1 fetched · 1 need review · 1 failed",
      actions: [{ id: "lyrics-review", label: "Review" }],
      logLink: { operationId: "op-1" },
    });
    expect(settle.detail).toBeUndefined();
  });

  it("keeps Review alone when need-review with no failures", () => {
    expect(
      lyricsFetchBulkSettleOptions({
        tally: { found: 0, notFound: 0, ambiguous: 2, failed: 0 },
        operationId: "op-1",
        reviewTrackId: 7,
      }),
    ).toMatchObject({
      status: "success",
      label: "Lyrics: 2 need review",
      actions: [{ id: "lyrics-review", label: "Review" }],
    });
    expect(
      lyricsFetchBulkSettleOptions({
        tally: { found: 0, notFound: 0, ambiguous: 2, failed: 0 },
        operationId: "op-1",
        reviewTrackId: 7,
      }).logLink,
    ).toBeUndefined();
  });

  it("uses inline detail for one failure and View logs for two+", () => {
    expect(
      lyricsFetchBulkSettleOptions({
        tally: { found: 0, notFound: 0, ambiguous: 0, failed: 1 },
        errorLines: ["Song A: timeout"],
        operationId: "op-1",
      }),
    ).toMatchObject({
      status: "error",
      label: "Lyrics: 1 failed",
      detail: "Song A: timeout",
    });

    expect(
      lyricsFetchBulkSettleOptions({
        tally: { found: 0, notFound: 0, ambiguous: 0, failed: 2 },
        errorLines: ["A: x", "B: y"],
        operationId: "op-2",
      }),
    ).toMatchObject({
      status: "error",
      label: "Lyrics: 2 failed",
      logLink: { operationId: "op-2" },
    });
  });
});

describe("lyricsAmbiguousSettleOptions", () => {
  it("settles as warning with Choose", () => {
    expect(lyricsAmbiguousSettleOptions("Song", 7)).toMatchObject({
      status: "warning",
      label: "Multiple lyrics found for Song",
      actions: [{ id: "lyrics-choose", label: "Choose" }],
    });
  });
});
