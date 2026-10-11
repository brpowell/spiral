import type { ActivityLogEntry } from "./activityLog";

export type CrashSource = "rust" | "renderer";

export interface CrashReportSummary {
  id: string;
  timestampMs: number;
  source: CrashSource;
  messagePreview: string;
}

export interface CrashReport {
  timestampMs: number;
  source: CrashSource;
  message: string;
  stackOrBacktrace: string;
  appVersion: string;
  recentEntries: ActivityLogEntry[];
}
