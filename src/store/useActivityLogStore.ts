import { create } from "zustand";
import type {
  ActivityLogDomainFilter,
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
  domainFilter: ActivityLogDomainFilter;
  minLevel: LogLevel;
  autoScroll: boolean;
  append: (entry: ActivityLogEntry) => void;
  hydrate: (entries: ActivityLogEntry[]) => void;
  clear: () => void;
  setDomainFilter: (filter: ActivityLogDomainFilter) => void;
  setMinLevel: (level: LogLevel) => void;
  setAutoScroll: (enabled: boolean) => void;
}

export function filterActivityLogEntries(
  entries: ActivityLogEntry[],
  domainFilter: ActivityLogDomainFilter,
  minLevel: LogLevel,
): ActivityLogEntry[] {
  const min = MIN_LEVELS[minLevel];
  return entries.filter((entry) => {
    if (MIN_LEVELS[entry.level] < min) return false;
    if (domainFilter === "all") return true;
    return (
      entry.domain === domainFilter ||
      entry.domain.startsWith(`${domainFilter}.`)
    );
  });
}

export const useActivityLogStore = create<ActivityLogState>((set) => ({
  entries: [],
  domainFilter: "all",
  minLevel: "info",
  autoScroll: true,

  append: (entry) =>
    set((state) => ({
      entries: [...state.entries, entry].slice(-500),
    })),

  hydrate: (entries) => set({ entries }),

  clear: () => set({ entries: [] }),

  setDomainFilter: (domainFilter) => set({ domainFilter }),

  setMinLevel: (minLevel) => set({ minLevel }),

  setAutoScroll: (autoScroll) => set({ autoScroll }),
}));
