import { describe, expect, it } from "vitest";
import {
  buildTrackLyricsInputFromEditor,
  createPlainTrackLyrics,
  formatTrackLyricsColumnLabel,
  importLyricsConflict,
  linesToPlainText,
  lyricsEditorStatesEquivalent,
  normalizeTrackLyrics,
  normalizeTrackLyricsInput,
  plainTextToLines,
} from "./lyrics";
import { parseLrc, serializeLrc } from "./lyricsLrc";
import type { TrackLyricsInput } from "../types/lyrics";

function plainLyrics(plainText: string): TrackLyricsInput {
  return {
    format: "plain",
    source: "embedded",
    plainText,
    lines: plainText.split("\n").map((text) => ({ text })),
  };
}

describe("lyrics", () => {
  it("round-trips plain text through line helpers", () => {
    const plainText = "Hello\nWorld";
    expect(linesToPlainText(plainTextToLines(plainText))).toBe(plainText);
  });

  it("creates plain track lyrics with one line per row", () => {
    const lyrics = createPlainTrackLyrics(7, "First\nSecond", "embedded");
    expect(lyrics).toMatchObject({
      trackId: 7,
      format: "plain",
      source: "embedded",
      plainText: "First\nSecond",
    });
    expect(lyrics.lines).toEqual([{ text: "First" }, { text: "Second" }]);
  });

  it("normalizes snake_case lyrics payloads from IPC", () => {
    const normalized = normalizeTrackLyrics({
      track_id: 3,
      format: "line_synced",
      source: "lrclib",
      lines: [{ text: "Synced line", start_ms: 12_500 }],
      plain_text: "Synced line",
      updated_at: "2026-07-07T12:00:00.000Z",
    });

    expect(normalized).toEqual({
      trackId: 3,
      format: "line_synced",
      source: "lrclib",
      lines: [{ text: "Synced line", startMs: 12_500 }],
      plainText: "Synced line",
      updatedAt: "2026-07-07T12:00:00.000Z",
    });
  });

  it("normalizes embedded lyrics input from IPC", () => {
    const input = normalizeTrackLyricsInput({
      format: "plain",
      source: "embedded",
      lines: [{ text: "Line A" }, { text: "Line B" }],
      plain_text: "Line A\nLine B",
    });

    expect(input).toEqual({
      format: "plain",
      source: "embedded",
      lines: [{ text: "Line A" }, { text: "Line B" }],
      plainText: "Line A\nLine B",
    });
  });

  it("round-trips normalized lyrics back to plain text", () => {
    const lyrics = normalizeTrackLyrics({
      trackId: 1,
      format: "plain",
      source: "manual",
      lines: [{ text: "A" }, { text: "B" }],
      plainText: "A\nB",
      updatedAt: "2026-07-07T12:00:00.000Z",
    });

    expect(linesToPlainText(lyrics.lines)).toBe(lyrics.plainText);
  });

  it("builds line-synced input when editor text matches deduped LRC plain text", () => {
    const parsed = parseLrc(
      "[03:25.54] Bob your head, rag top\n[03:27.40] Bob your head, rag top\n[03:28.96] Bob your head, rag top",
    );

    const input = buildTrackLyricsInputFromEditor(
      parsed.plainText,
      parsed.lines,
      "manual",
    );

    expect(input).toMatchObject({
      format: "line_synced",
      plainText: "Bob your head, rag top",
      lines: parsed.lines,
    });
  });

  it("builds line-synced input when plain text ends with timed empty line", () => {
    const parsed = parseLrc(
      "[03:02.77] \n[03:25.93] Bob your head, rag top\n[05:01.87] ",
    );

    const input = buildTrackLyricsInputFromEditor(
      parsed.plainText.trim(),
      parsed.lines,
      "manual",
    );

    expect(input).toMatchObject({
      format: "line_synced",
      plainText: parsed.plainText.trim(),
      lines: parsed.lines,
    });
  });

  it("treats reverted plain lyrics as equivalent to the original", () => {
    const original = { lyrics: "Hello world", syncedLines: null };
    const edited = { lyrics: "Hello worldx", syncedLines: null };

    expect(lyricsEditorStatesEquivalent(edited, original)).toBe(false);
    expect(lyricsEditorStatesEquivalent(original, original)).toBe(true);
  });

  it("treats re-parsed synced lyrics as equivalent when LRC matches", () => {
    const originalLines = [
      { text: "Synced line", startMs: 12_500 },
      { text: "Next line", startMs: 20_000 },
    ];
    const original = {
      lyrics: "Synced line\nNext line",
      syncedLines: originalLines,
    };
    const reparsed = parseLrc(serializeLrc(originalLines));

    expect(
      lyricsEditorStatesEquivalent(
        { lyrics: reparsed.plainText, syncedLines: reparsed.lines },
        original,
      ),
    ).toBe(true);
  });

  it("detects real synced lyric edits", () => {
    const original = {
      lyrics: "Synced line",
      syncedLines: [{ text: "Synced line", startMs: 12_500 }],
    };
    const edited = {
      lyrics: "Changed line",
      syncedLines: [{ text: "Changed line", startMs: 12_500 }],
    };

    expect(lyricsEditorStatesEquivalent(edited, original)).toBe(false);
  });

  it("formats track list lyrics column labels", () => {
    expect(formatTrackLyricsColumnLabel(null)).toBe("—");
    expect(formatTrackLyricsColumnLabel("plain")).toBe("Plain");
    expect(formatTrackLyricsColumnLabel("line_synced")).toBe("Line Synced");
    expect(formatTrackLyricsColumnLabel("word_synced")).toBe("Word Synced");
    expect(formatTrackLyricsColumnLabel("instrumental")).toBe("Instrumental");
  });

  it("detects import lyrics conflicts only when both sides differ", () => {
    expect(importLyricsConflict(plainLyrics("A"), plainLyrics("B"))).toBe(true);
    expect(importLyricsConflict(plainLyrics("A"), plainLyrics("A"))).toBe(false);
    expect(importLyricsConflict(plainLyrics("A"), null)).toBe(false);
    expect(importLyricsConflict(null, plainLyrics("A"))).toBe(false);
  });
});
