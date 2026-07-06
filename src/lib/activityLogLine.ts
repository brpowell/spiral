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
    operationId:
      raw.operationId != null
        ? String(raw.operationId)
        : raw.operation_id != null
          ? String(raw.operation_id)
          : undefined,
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
