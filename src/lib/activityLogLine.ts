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

export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      document.body.appendChild(textarea);
      textarea.select();
      const copied = document.execCommand("copy");
      document.body.removeChild(textarea);
      return copied;
    } catch {
      return false;
    }
  }
}
