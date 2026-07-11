import type { LyricsLine, LyricsSource, TrackLyricsInput } from "../types/lyrics";
import { linesToPlainText } from "./lyrics";

const METADATA_TAG_KEYS = new Set([
  "ar",
  "ti",
  "al",
  "by",
  "au",
  "length",
  "tool",
  "ve",
  "re",
  "la",
  "creator",
]);

export interface ParsedLrc {
  lines: LyricsLine[];
  plainText: string;
  offsetMs: number;
}

/** True when a trimmed line starts with an LRC timestamp tag. */
export function looksLikeLrcTimestamp(line: string): boolean {
  const trimmed = line.trim();
  const close = trimmed.indexOf("]");
  if (!trimmed.startsWith("[") || close <= 1) {
    return false;
  }

  const inner = trimmed.slice(1, close);
  if (inner.toLowerCase().startsWith("offset:")) {
    return true;
  }

  const colon = inner.indexOf(":");
  if (colon === -1) {
    return false;
  }

  const mins = inner.slice(0, colon);
  const secsPart = inner.slice(colon + 1);
  if (!mins || !/^\d+$/.test(mins)) {
    return false;
  }

  const dot = secsPart.indexOf(".");
  const secs = dot === -1 ? secsPart : secsPart.slice(0, dot);
  return /^\d{1,2}$/.test(secs);
}

/** True when any non-empty line looks like LRC content. */
export function isLrcContent(text: string): boolean {
  return text
    .split("\n")
    .some((line) => line.trim() && looksLikeLrcTimestamp(line));
}

function parseTimestampMs(inner: string): number | null {
  const colon = inner.indexOf(":");
  if (colon === -1) {
    return null;
  }

  const mins = Number.parseInt(inner.slice(0, colon), 10);
  const rest = inner.slice(colon + 1);
  if (!Number.isFinite(mins)) {
    return null;
  }

  const dot = rest.indexOf(".");
  const secsStr = dot === -1 ? rest : rest.slice(0, dot);
  const fracStr = dot === -1 ? "" : rest.slice(dot + 1);
  const secs = Number.parseInt(secsStr, 10);
  if (!Number.isFinite(secs)) {
    return null;
  }

  let fracMs = 0;
  if (fracStr.length === 1) {
    fracMs = Number.parseInt(fracStr, 10) * 100;
  } else if (fracStr.length === 2) {
    fracMs = Number.parseInt(fracStr, 10) * 10;
  } else if (fracStr.length >= 3) {
    fracMs = Number.parseInt(fracStr.slice(0, 3), 10);
  }

  if (!Number.isFinite(fracMs)) {
    return null;
  }

  return mins * 60_000 + secs * 1_000 + fracMs;
}

function parseOffsetMs(inner: string): number | null {
  const lower = inner.toLowerCase();
  if (!lower.startsWith("offset:")) {
    return null;
  }
  const value = inner.slice("offset:".length).trim();
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function isMetadataTag(inner: string): boolean {
  const colon = inner.indexOf(":");
  if (colon === -1) {
    return false;
  }
  const key = inner.slice(0, colon).toLowerCase();
  return METADATA_TAG_KEYS.has(key);
}

/** Collapse repeated timed lines into one row per unique lyric (LRC plain text). */
export function plainTextFromSyncedLines(lines: LyricsLine[]): string {
  const parts: string[] = [];
  let previousText: string | null = null;

  for (const line of lines) {
    if (line.text === "" && line.startMs === undefined) {
      parts.push("");
      previousText = null;
      continue;
    }

    if (line.text !== previousText) {
      parts.push(line.text);
      previousText = line.text;
    }
  }

  return parts.join("\n");
}

/** Parse LRC text into timed lyric lines. */
export function parseLrc(text: string): ParsedLrc {
  let offsetMs = 0;
  const lines: LyricsLine[] = [];

  for (const rawLine of text.split("\n")) {
    let remaining = rawLine.trim();
    if (!remaining) {
      lines.push({ text: "" });
      continue;
    }

    const timestamps: number[] = [];
    let metadataOnly = false;

    while (remaining.startsWith("[")) {
      const close = remaining.indexOf("]");
      if (close === -1) {
        break;
      }

      const inner = remaining.slice(1, close);
      remaining = remaining.slice(close + 1).trimStart();

      const offset = parseOffsetMs(inner);
      if (offset !== null) {
        offsetMs = offset;
        metadataOnly = remaining.length === 0;
        continue;
      }

      if (isMetadataTag(inner)) {
        metadataOnly = remaining.length === 0;
        continue;
      }

      const timestamp = parseTimestampMs(inner);
      if (timestamp !== null) {
        timestamps.push(timestamp + offsetMs);
      }
    }

    if (metadataOnly) {
      continue;
    }

    if (timestamps.length === 0) {
      if (remaining) {
        lines.push({ text: remaining });
      }
      continue;
    }

    for (const startMs of timestamps) {
      lines.push({ text: remaining, startMs });
    }
  }

  return {
    lines,
    plainText: plainTextFromSyncedLines(lines),
    offsetMs,
  };
}

function formatTimestamp(ms: number): string {
  const clamped = Math.max(0, ms);
  const mins = Math.floor(clamped / 60_000);
  const secs = Math.floor((clamped % 60_000) / 1_000);
  const centis = Math.floor((clamped % 1_000) / 10);
  return `[${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(centis).padStart(2, "0")}]`;
}

/** Serialize timed lines back to LRC. */
export function serializeLrc(
  lines: LyricsLine[],
  offsetMs = 0,
): string {
  const output: string[] = [];
  if (offsetMs !== 0) {
    output.push(`[offset:${offsetMs}]`);
  }

  for (const line of lines) {
    if (line.startMs !== undefined) {
      const tag = formatTimestamp(line.startMs - offsetMs);
      const suffix = line.text
        ? line.text.startsWith(" ")
          ? line.text
          : ` ${line.text}`
        : "";
      output.push(`${tag}${suffix}`);
      continue;
    }

    if (line.text) {
      output.push(line.text);
    } else {
      output.push("");
    }
  }

  return output.join("\n");
}

function createLineSyncedTrackLyricsInput(
  parsed: ParsedLrc,
  source: LyricsSource = "manual",
): TrackLyricsInput {
  return {
    format: "line_synced",
    source,
    lines: parsed.lines,
    plainText: parsed.plainText,
  };
}

/** Build track lyrics input from editor text, detecting LRC when present. */
export function createTrackLyricsInputFromText(
  text: string,
  source: LyricsSource = "manual",
): TrackLyricsInput {
  const trimmed = text.trim();
  if (!trimmed) {
    return {
      format: "plain",
      source,
      lines: [],
      plainText: "",
    };
  }

  if (isLrcContent(trimmed)) {
    return createLineSyncedTrackLyricsInput(parseLrc(trimmed), source);
  }

  const lines = trimmed.split("\n").map((line) => ({ text: line }));
  return {
    format: "plain",
    source,
    lines,
    plainText: linesToPlainText(lines),
  };
}
