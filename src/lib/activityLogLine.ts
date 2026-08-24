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
  const operationId = getEntryOperationId(entry);
  const line: ActivityLogLine = {
    id: entry.id,
    timestampMs: entry.timestampMs,
    level: entry.level,
    domain: entry.domain,
    message: entry.message,
  };

  if (operationId != null) line.operationId = operationId;
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
