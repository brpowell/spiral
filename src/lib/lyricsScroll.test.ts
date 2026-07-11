import { describe, expect, it } from "vitest";
import type { LyricsLine } from "../types/lyrics";
import {
  findScrollLineIndex,
  findSingingLineIndex,
  getLyricsPrerollState,
} from "./lyricsScroll";

const syncedLines: LyricsLine[] = [
  { text: "First", startMs: 0 },
  { text: "Second", startMs: 10_000 },
  { text: "Third", startMs: 20_000 },
];

const delayedStartLines: LyricsLine[] = [
  { text: "First", startMs: 10_000 },
  { text: "Second", startMs: 20_000 },
];

const gappedLines: LyricsLine[] = [
  { text: "First", startMs: 10_000, endMs: 15_000 },
  { text: "Second", startMs: 20_000, endMs: 25_000 },
];

describe("findSingingLineIndex", () => {
  it("returns -1 before the first timestamped line", () => {
    expect(findSingingLineIndex(2_500, delayedStartLines)).toBe(-1);
  });

  it("returns the line whose time window contains playback", () => {
    expect(findSingingLineIndex(0, syncedLines)).toBe(0);
    expect(findSingingLineIndex(9_999, syncedLines)).toBe(0);
    expect(findSingingLineIndex(10_000, syncedLines)).toBe(1);
    expect(findSingingLineIndex(15_000, syncedLines)).toBe(1);
    expect(findSingingLineIndex(99_000, syncedLines)).toBe(2);
  });

  it("returns -1 during explicit gaps between lines", () => {
    expect(findSingingLineIndex(17_500, gappedLines)).toBe(-1);
    expect(findSingingLineIndex(12_500, gappedLines)).toBe(0);
  });

  it("returns -1 for empty lines", () => {
    expect(findSingingLineIndex(1_000, [])).toBe(-1);
  });
});

describe("findScrollLineIndex", () => {
  it("prefers the singing line when one exists", () => {
    expect(findScrollLineIndex(15_000, syncedLines)).toBe(1);
    expect(findScrollLineIndex(10_000, delayedStartLines)).toBe(0);
  });

  it("scrolls to the upcoming line during gaps and preroll", () => {
    expect(findScrollLineIndex(2_500, delayedStartLines)).toBe(0);
    expect(findScrollLineIndex(9_999, delayedStartLines)).toBe(0);
    expect(findScrollLineIndex(17_500, gappedLines)).toBe(1);
  });

  it("falls back to the closest line after the final lyric ends", () => {
    expect(findScrollLineIndex(30_000, gappedLines)).toBe(1);
  });
});

describe("getLyricsPrerollState", () => {
  it("returns null when lyrics start immediately or playback has reached them", () => {
    expect(getLyricsPrerollState(0, syncedLines)).toBeNull();
    expect(getLyricsPrerollState(5_000, syncedLines)).toBeNull();
    expect(getLyricsPrerollState(10_000, delayedStartLines)).toBeNull();
  });

  it("returns countdown progress before the first timestamped line", () => {
    expect(getLyricsPrerollState(2_500, delayedStartLines)).toEqual({
      firstLineIndex: 0,
      progress: 0.25,
    });
    expect(getLyricsPrerollState(9_999, delayedStartLines)?.progress).toBeCloseTo(
      0.9999,
    );
  });

  it("returns null when the first line starts within two seconds", () => {
    const shortLeadLines: LyricsLine[] = [
      { text: "First", startMs: 2_000 },
      { text: "Second", startMs: 10_000 },
    ];

    expect(getLyricsPrerollState(500, shortLeadLines)).toBeNull();
    expect(getLyricsPrerollState(1_500, shortLeadLines)).toBeNull();
  });
});
