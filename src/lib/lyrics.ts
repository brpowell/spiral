import type {
  LyricsFormat,
  LyricsLine,
  LyricsSource,
  TrackLyrics,
  TrackLyricsInput,
} from "../types/lyrics";
import { t } from "./i18n";
import {
  createTrackLyricsInputFromText,
  isLrcContent,
  parseLrc,
  plainTextFromSyncedLines,
  serializeLrc,
} from "./lyricsLrc";

function parseLyricsFormat(value: unknown): LyricsFormat {
  if (
    value === "line_synced" ||
    value === "word_synced" ||
    value === "instrumental"
  ) {
    return value;
  }
  return "plain";
}

function parseLyricsSource(value: unknown): LyricsSource {
  if (
    value === "manual" ||
    value === "embedded" ||
    value === "sidecar" ||
    value === "lrclib"
  ) {
    return value;
  }
  return null;
}

function parseLyricsLine(raw: Record<string, unknown>): LyricsLine {
  return {
    text: String(raw.text ?? ""),
    startMs:
      (raw.startMs as number | undefined) ??
      (raw.start_ms as number | undefined),
    endMs:
      (raw.endMs as number | undefined) ?? (raw.end_ms as number | undefined),
    words: Array.isArray(raw.words)
      ? raw.words.map((word) => {
          const entry = word as Record<string, unknown>;
          return {
            text: String(entry.text ?? ""),
            startMs:
              (entry.startMs as number | undefined) ??
              (entry.start_ms as number | undefined) ??
              0,
            endMs:
              (entry.endMs as number | undefined) ??
              (entry.end_ms as number | undefined),
          };
        })
      : undefined,
  };
}

/** Normalize lyrics JSON from the Tauri IPC boundary. */
export function normalizeTrackLyricsInput(
  raw: Record<string, unknown>,
): TrackLyricsInput {
  const normalized = normalizeTrackLyrics({
    trackId: 0,
    updatedAt: "",
    ...raw,
  });
  return {
    format: normalized.format,
    source: normalized.source,
    lines: normalized.lines,
    plainText: normalized.plainText,
  };
}

/** Normalize lyrics JSON from the Tauri IPC boundary. */
export function normalizeTrackLyrics(
  raw: Record<string, unknown>,
): TrackLyrics {
  const lines = Array.isArray(raw.lines)
    ? raw.lines.map((line) => parseLyricsLine(line as Record<string, unknown>))
    : [];

  return {
    trackId:
      (raw.trackId as number | undefined) ??
      (raw.track_id as number | undefined) ??
      0,
    format: parseLyricsFormat(raw.format),
    source: parseLyricsSource(raw.source),
    lines,
    plainText:
      (raw.plainText as string | undefined) ??
      (raw.plain_text as string | undefined) ??
      "",
    updatedAt:
      (raw.updatedAt as string | undefined) ??
      (raw.updated_at as string | undefined) ??
      "",
  };
}

export function plainTextToLines(plainText: string): LyricsLine[] {
  return plainText.split("\n").map((text) => ({ text }));
}

export function linesToPlainText(lines: LyricsLine[]): string {
  return lines.map((line) => line.text).join("\n");
}

export function buildTrackLyricsInputFromEditor(
  text: string,
  syncedLines: LyricsLine[] | null,
  source: LyricsSource = "manual",
): TrackLyricsInput | null {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }

  const hasSyncedTimestamps =
    syncedLines?.some((line) => line.startMs !== undefined) ?? false;
  const dedupedPlain = syncedLines
    ? plainTextFromSyncedLines(syncedLines).trim()
    : null;
  const plainMatches = dedupedPlain === trimmed;

  if (syncedLines && hasSyncedTimestamps && plainMatches) {
    return {
      format: "line_synced",
      source,
      lines: syncedLines,
      plainText: trimmed,
    };
  }

  return createTrackLyricsInputFromText(trimmed, source);
}

export function trackLyricsToInput(lyrics: TrackLyrics): TrackLyricsInput {
  return {
    format: lyrics.format,
    source: lyrics.source,
    lines: lyrics.lines,
    plainText: lyrics.plainText,
  };
}

function hasNonEmptyLyrics(
  lyrics: TrackLyricsInput | TrackLyrics | null | undefined,
): boolean {
  return Boolean(lyrics?.plainText.trim());
}

function trackLyricsInputEquivalent(
  a: TrackLyricsInput | null | undefined,
  b: TrackLyricsInput | null | undefined,
): boolean {
  if (a === b) {
    return true;
  }
  if (!a || !b) {
    return !a && !b;
  }
  if (a.format !== b.format || a.plainText !== b.plainText) {
    return false;
  }
  if (a.format === "line_synced") {
    return serializeLrc(a.lines) === serializeLrc(b.lines);
  }
  return true;
}

/** True when both sides have lyrics and content differs. */
export function importLyricsConflict(
  incoming: TrackLyricsInput | null | undefined,
  existing: TrackLyricsInput | null | undefined,
): boolean {
  if (!hasNonEmptyLyrics(incoming) || !hasNonEmptyLyrics(existing)) {
    return false;
  }
  return !trackLyricsInputEquivalent(incoming, existing);
}

export function lyricsEditorStatesEquivalent(
  a: { lyrics: string; syncedLines: LyricsLine[] | null },
  b: { lyrics: string; syncedLines: LyricsLine[] | null },
): boolean {
  if (
    a.lyrics === b.lyrics &&
    JSON.stringify(a.syncedLines) === JSON.stringify(b.syncedLines)
  ) {
    return true;
  }

  if (!a.lyrics.trim() && !b.lyrics.trim()) {
    return true;
  }

  return trackLyricsInputEquivalent(
    buildTrackLyricsInputFromEditor(a.lyrics, a.syncedLines, "manual"),
    buildTrackLyricsInputFromEditor(b.lyrics, b.syncedLines, "manual"),
  );
}

export function parseEditorLyricsChange(
  value: string,
  previousSyncedLines: LyricsLine[] | null,
): { text: string; syncedLines: LyricsLine[] | null; format: LyricsFormat } {
  const trimmed = value.trim();

  if (!trimmed) {
    return { text: value, syncedLines: null, format: "plain" };
  }

  if (isLrcContent(trimmed)) {
    const parsed = parseLrc(trimmed);
    return {
      text: parsed.plainText,
      syncedLines: parsed.lines,
      format: "line_synced",
    };
  }

  if (
    previousSyncedLines &&
    previousSyncedLines.some((line) => line.startMs !== undefined) &&
    plainTextFromSyncedLines(previousSyncedLines).trim() === trimmed
  ) {
    return {
      text: trimmed,
      syncedLines: previousSyncedLines,
      format: "line_synced",
    };
  }

  return {
    text: value,
    syncedLines: null,
    format: "plain",
  };
}

export function createPlainTrackLyrics(
  trackId: number,
  plainText: string,
  source: LyricsSource = "manual",
  updatedAt = new Date().toISOString(),
): TrackLyrics {
  const lines = plainTextToLines(plainText);
  return {
    trackId,
    format: "plain",
    source,
    lines,
    plainText: linesToPlainText(lines),
    updatedAt,
  };
}

export function formatLyricsFormatLabel(format: LyricsFormat): string {
  switch (format) {
    case "plain":
      return t("library:editor.lyrics.formatPlain");
    case "line_synced":
      return t("library:editor.lyrics.formatLineSynced");
    case "word_synced":
      return t("library:editor.lyrics.formatWordSynced");
    case "instrumental":
      return t("library:editor.lyrics.formatInstrumental");
  }
}

export function formatTrackLyricsColumnLabel(
  format: LyricsFormat | null | undefined,
): string {
  if (!format) return "—";
  return formatLyricsFormatLabel(format);
}

const LYRICS_FORMAT_SORT_RANK: Record<LyricsFormat, number> = {
  instrumental: 0,
  plain: 1,
  line_synced: 2,
  word_synced: 3,
};

export function lyricsFormatSortRank(
  format: LyricsFormat | null | undefined,
  noLyricsRank = 99,
): number {
  if (!format) return noLyricsRank;
  return LYRICS_FORMAT_SORT_RANK[format];
}
