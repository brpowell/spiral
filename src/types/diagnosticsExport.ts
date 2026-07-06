import type { ActivityLogEntry } from "./activityLog";
import type { CrashReport } from "./crashReport";

export interface DiagnosticsEnvironment {
  appVersion: string;
  os: string;
  arch: string;
}

export interface DiagnosticsCrashReport extends CrashReport {
  id: string;
}

export interface DiagnosticsBundle {
  exportedAtMs: number;
  environment: DiagnosticsEnvironment;
  /** Current-session log — only present when no crash report is bundled. */
  activityLogEntries?: ActivityLogEntry[];
  crashReport: DiagnosticsCrashReport | null;
}
