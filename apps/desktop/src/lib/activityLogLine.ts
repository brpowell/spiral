import type { ActivityLogEntry, ActivityLogLine } from "../types/activityLog";

export function normalizeActivityLogEntry(
  raw: Record<string, unknown>,
): ActivityLogEntry {
  return {
    id: String(raw.id ?? ""),
    timestampMs: Number(raw.timestampMs ?? raw.timestamp_ms ?? Date.now()),
    level: (raw.level as ActivityLogEntry["level"]) ?? "info",
    domain: String(raw.domain ?? ""),
    message: String(raw.message ?? ""),
    context:
      raw.context != null && typeof raw.context === "object"
        ? (raw.context as ActivityLogEntry["context"])
        : undefined,
    details:
      raw.details != null && typeof raw.details === "object"
        ? (raw.details as Record<string, unknown>)
        : undefined,
  };
}

function detailsWithDriveAndDisc(
  entry: ActivityLogEntry,
): Record<string, unknown> | undefined {
  const driveId = entry.context?.driveId;
  const discId = entry.context?.discId;
  const existing = entry.details;
  const hasExisting = existing != null && Object.keys(existing).length > 0;
  if (driveId == null && discId == null && !hasExisting) {
    return undefined;
  }

  return {
    ...(driveId != null ? { driveId } : {}),
    ...(discId != null ? { discId } : {}),
    ...existing,
  };
}

/** Canonical single-line JSON object for one log entry. */
export function entryToLogLine(entry: ActivityLogEntry): ActivityLogLine {
  const line: ActivityLogLine = {
    id: entry.id,
    timestampMs: entry.timestampMs,
    level: entry.level,
    domain: entry.domain,
    message: entry.message,
  };

  if (entry.context?.releaseMbid != null) {
    line.releaseMbid = entry.context.releaseMbid;
  }
  if (entry.context?.artist != null) line.artist = entry.context.artist;
  if (entry.context?.album != null) line.album = entry.context.album;
  const details = detailsWithDriveAndDisc(entry);
  if (details != null) line.details = details;

  return line;
}

export function serializeLogLine(entry: ActivityLogEntry): string {
  return JSON.stringify(entryToLogLine(entry));
}

export function serializeLogLines(entries: ActivityLogEntry[]): string {
  return entries.map(serializeLogLine).join("\n");
}

export function formatLogLinePretty(entry: ActivityLogEntry): string {
  return JSON.stringify(entryToLogLine(entry), null, 2);
}

/** Locale time shown in the activity logs list (and copied with it). */
export function formatActivityLogTimestamp(timestampMs: number): string {
  return new Date(timestampMs).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** One list row as the user sees it: time, level, message. */
export function formatActivityLogDisplayLine(entry: ActivityLogEntry): string {
  return `${formatActivityLogTimestamp(entry.timestampMs)}  ${entry.level}  ${entry.message}`;
}

/** Visible log list text for the More menu Copy logs action. */
export function formatActivityLogDisplayList(
  entries: ActivityLogEntry[],
): string {
  return entries.map(formatActivityLogDisplayLine).join("\n");
}
