import { describe, expect, it } from "vitest";
import {
  LYRICS_FETCH_INSTRUMENTAL,
  LYRICS_FETCH_NOT_FOUND,
  lyricsFetchFailureFeedback,
  createLyricsFetchFeedback,
  formatLyricsDuration,
  lyricsCandidateDurationMeta,
  lyricsCandidateLabel,
} from "./lyricsFetch";

describe("lyricsFetchFailureFeedback", () => {
  it("maps network failures to a friendly message", () => {
    expect(
      lyricsFetchFailureFeedback(new Error("LRCLIB request failed: connection refused")),
    ).toEqual({
      text: "Couldn't reach LRCLIB. Check your connection and try again.",
      variant: "error",
    });
  });

  it("maps parse failures to a friendly message", () => {
    expect(
      lyricsFetchFailureFeedback(
        new Error("failed to parse LRCLIB response: expected value at line 1 column 1"),
      ),
    ).toEqual({
      text: "Received an unexpected response from LRCLIB. Try again later.",
      variant: "error",
    });
  });

  it("keeps validation errors as-is", () => {
    expect(
      lyricsFetchFailureFeedback(
        new Error("Artist and title are required to fetch lyrics"),
      ),
    ).toEqual({
      text: "Artist and title are required to fetch lyrics",
      variant: "error",
    });
  });

  it("falls back for unknown errors", () => {
    expect(lyricsFetchFailureFeedback("something weird")).toEqual({
      text: "Couldn't fetch lyrics. Try again later.",
      variant: "error",
    });
  });
});

describe("createLyricsFetchFeedback", () => {
  it("defaults to error variant", () => {
    expect(createLyricsFetchFeedback("Oops")).toEqual({
      text: "Oops",
      variant: "error",
    });
  });
});

describe("LYRICS_FETCH_NOT_FOUND", () => {
  it("uses info variant", () => {
    expect(LYRICS_FETCH_NOT_FOUND.variant).toBe("info");
  });
});

describe("LYRICS_FETCH_INSTRUMENTAL", () => {
  it("uses info variant", () => {
    expect(LYRICS_FETCH_INSTRUMENTAL.variant).toBe("info");
    expect(LYRICS_FETCH_INSTRUMENTAL.text.length).toBeGreaterThan(0);
  });
});

describe("lyrics candidate labels", () => {
  it("formats candidate label and duration delta", () => {
    expect(
      lyricsCandidateLabel({
        id: 1,
        trackName: "Yesterday",
        artistName: "The Beatles",
        albumName: "Help!",
        duration: 125,
        lyrics: {
          format: "plain",
          source: "lrclib",
          lines: [],
          plainText: "Lyrics",
        },
      }),
    ).toBe("Yesterday · The Beatles");

    expect(formatLyricsDuration(125)).toBe("2:05");
    expect(
      lyricsCandidateDurationMeta(
        {
          id: 1,
          trackName: "Yesterday",
          artistName: "The Beatles",
          albumName: "Help!",
          duration: 128,
          lyrics: {
            format: "plain",
            source: "lrclib",
            lines: [],
            plainText: "Lyrics",
          },
        },
        125,
      ),
    ).toBe("2:08 (+3s)");
  });
});
