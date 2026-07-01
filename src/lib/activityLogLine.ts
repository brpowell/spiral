import type { ActivityLogEntry, ActivityLogLine } from "../types/activityLog";

export function getEntryOperationId(
  entry: ActivityLogEntry,
): string | undefined {
  return entry.operationId ?? entry.context?.operationId;
}

/** Canonical single-line JSON object for one log entry. */
export function entryToLogLine(entry: ActivityLogEntry): ActivityLogLine {
  const operationId = getEntryOperationId(entry);
  const line: ActivityLogLine = {
    id: entry.id,
    timestampMs: entry.timestampMs,
    level: entry.level,
    domain: entry.domain,
    message: entry.message,
  };

  if (operationId != null) line.operationId = operationId;
  if (entry.context?.driveId != null) line.driveId = entry.context.driveId;
  if (entry.context?.discId != null) line.discId = entry.context.discId;
  if (entry.context?.releaseMbid != null) {
    line.releaseMbid = entry.context.releaseMbid;
  }
  if (entry.context?.artist != null) line.artist = entry.context.artist;
  if (entry.context?.album != null) line.album = entry.context.album;
  if (entry.details != null && Object.keys(entry.details).length > 0) {
    line.details = entry.details;
  }

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
