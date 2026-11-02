import { create } from "zustand";
import type {
  ActivityLogDomain,
  ActivityLogEntry,
  LogLevel,
} from "../types/activityLog";

const MIN_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

interface ActivityLogState {
  entries: ActivityLogEntry[];
  domainFilters: ActivityLogDomain[];
  minLevel: LogLevel;
  autoScroll: boolean;
  append: (entry: ActivityLogEntry) => void;
  hydrate: (entries: ActivityLogEntry[]) => void;
  clear: () => void;
  setDomainFilters: (filters: ActivityLogDomain[]) => void;
  setMinLevel: (level: LogLevel) => void;
  setAutoScroll: (enabled: boolean) => void;
}

function entryMatchesDomain(entry: ActivityLogEntry, domain: ActivityLogDomain): boolean {
  return (
    entry.domain === domain ||
    entry.domain.startsWith(`${domain}.`)
  );
}

export function filterActivityLogEntries(
  entries: ActivityLogEntry[],
  domainFilters: ActivityLogDomain[],
  minLevel: LogLevel,
): ActivityLogEntry[] {
  const min = MIN_LEVELS[minLevel];
  return entries.filter((entry) => {
    if (MIN_LEVELS[entry.level] < min) return false;
    if (domainFilters.length === 0) return true;
    return domainFilters.some((domain) => entryMatchesDomain(entry, domain));
  });
}

export const useActivityLogStore = create<ActivityLogState>((set) => ({
  entries: [],
  domainFilters: [],
  minLevel: "info",
  autoScroll: true,

  append: (entry) =>
    set((state) => ({
      entries: [...state.entries, entry].slice(-500),
    })),

  hydrate: (entries) => set({ entries }),

  clear: () => set({ entries: [] }),

  setDomainFilters: (domainFilters) => set({ domainFilters }),

  setMinLevel: (minLevel) => set({ minLevel }),

  setAutoScroll: (autoScroll) => set({ autoScroll }),
}));
