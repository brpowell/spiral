import { describe, expect, it } from "vitest";
import type { LyricsLine } from "../types/lyrics";
import {
  createTrackLyricsInputFromText,
  isLrcContent,
  looksLikeLrcTimestamp,
  parseLrc,
  serializeLrc,
} from "./lyricsLrc";

describe("lyricsLrc", () => {
  it("detects timestamp prefixes", () => {
    expect(looksLikeLrcTimestamp("[00:12.50] Hello")).toBe(true);
    expect(looksLikeLrcTimestamp("[1:02] Hello")).toBe(true);
    expect(looksLikeLrcTimestamp("[offset:+500]")).toBe(true);
    expect(looksLikeLrcTimestamp("Plain lyrics")).toBe(false);
  });

  it("parses fractional and integer timestamps", () => {
    const parsed = parseLrc(
      "[00:12.50] Half past twelve\n[01:02] One minute two\n[00:12.500] Milliseconds",
    );

    expect(parsed.lines[0]).toMatchObject({
      text: "Half past twelve",
      startMs: 12_500,
    });
    expect(parsed.lines[1]).toMatchObject({
      text: "One minute two",
      startMs: 62_000,
    });
    expect(parsed.lines[2]).toMatchObject({
      text: "Milliseconds",
      startMs: 12_500,
    });
  });

  it("applies offset tags", () => {
    const parsed = parseLrc("[offset:+500]\n[00:01.00] Delayed");

    expect(parsed.offsetMs).toBe(500);
    expect(parsed.lines[0]).toMatchObject({
      text: "Delayed",
      startMs: 1_500,
    });
  });

  it("skips metadata tags and preserves blank lines", () => {
    const parsed = parseLrc(
      "[ar:Artist Name]\n[ti:Title]\n\n[00:10.00] First line\n\n[00:20.00] Second line",
    );

    expect(parsed.lines).toEqual([
      { text: "" },
      { text: "First line", startMs: 10_000 },
      { text: "" },
      { text: "Second line", startMs: 20_000 },
    ]);
    expect(parsed.plainText).toBe("\nFirst line\n\nSecond line");
  });

  it("handles multiple timestamps on one line", () => {
    const parsed = parseLrc("[00:10.00][00:50.00] Chorus");

    expect(parsed.lines).toEqual([
      { text: "Chorus", startMs: 10_000 },
      { text: "Chorus", startMs: 50_000 },
    ]);
    expect(parsed.plainText).toBe("Chorus\nChorus");
  });

  it("serializes timed lines back to LRC", () => {
    const lines: LyricsLine[] = [
      { text: "Hello", startMs: 12_750 },
      { text: "World", startMs: 20_250 },
    ];

    expect(serializeLrc(lines, 250)).toBe(
      "[offset:250]\n[00:12.50] Hello\n[00:20.00] World",
    );
  });

  it("serializes consecutive duplicate lines on separate rows", () => {
    const lines: LyricsLine[] = [
      { text: "Chorus", startMs: 10_000 },
      { text: "Chorus", startMs: 50_000 },
    ];

    expect(serializeLrc(lines)).toBe("[00:10.00] Chorus\n[00:50.00] Chorus");
  });

  it("round-trips parsed LRC", () => {
    const source = "[offset:250]\n[00:12.50] Hello\n[00:20.00] World";
    const parsed = parseLrc(source);
    const reparsed = parseLrc(serializeLrc(parsed.lines, parsed.offsetMs));

    expect(reparsed.offsetMs).toBe(parsed.offsetMs);
    expect(reparsed.plainText).toBe(parsed.plainText);
    expect(reparsed.lines).toEqual(parsed.lines);
  });

  it("creates line-synced input from pasted LRC", () => {
    const input = createTrackLyricsInputFromText("[00:03.00] Synced", "manual");

    expect(input).toMatchObject({
      format: "line_synced",
      source: "manual",
      plainText: "Synced",
      lines: [{ text: "Synced", startMs: 3_000 }],
    });
    expect(isLrcContent("[00:03.00] Synced")).toBe(true);
  });
});
