import { getEntryOperationId } from "./activityLogLine";
import type { ActivityLogRevealTarget } from "./activityLogsWindow";
import type { ActivityLogEntry, LogLevel } from "../types/activityLog";

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const SEVERITY_PREFERENCE: Record<LogLevel, number> = {
  error: 3,
  warn: 2,
  info: 1,
  debug: 0,
};

/** Pick the best entry for a reveal target from the full buffer. */
export function resolveActivityLogRevealEntry(
  entries: ActivityLogEntry[],
  target: ActivityLogRevealTarget,
): ActivityLogEntry | null {
  if (target.entryId) {
    const byId = entries.find((entry) => entry.id === target.entryId);
    if (byId) return byId;
  }

  if (!target.operationId) return null;

  const matches = entries.filter(
    (entry) => getEntryOperationId(entry) === target.operationId,
  );
  if (matches.length === 0) return null;

  let best = matches[0];
  for (let i = 1; i < matches.length; i += 1) {
    const candidate = matches[i];
    const bestSeverity = SEVERITY_PREFERENCE[best.level];
    const candidateSeverity = SEVERITY_PREFERENCE[candidate.level];
    if (candidateSeverity > bestSeverity) {
      best = candidate;
      continue;
    }
    if (
      candidateSeverity === bestSeverity &&
      candidate.timestampMs >= best.timestampMs
    ) {
      best = candidate;
    }
  }
  return best;
}

export function entryVisibleWithFilters(
  entry: ActivityLogEntry,
  domainFilters: string[],
  minLevel: LogLevel,
): boolean {
  if (LEVEL_RANK[entry.level] < LEVEL_RANK[minLevel]) return false;
  if (domainFilters.length === 0) return true;
  return domainFilters.some(
    (domain) =>
      entry.domain === domain || entry.domain.startsWith(`${domain}.`),
  );
}
