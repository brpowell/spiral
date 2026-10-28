import { invoke } from "@tauri-apps/api/core";
import { normalizeActivityLogEntry } from "./activityLogLine";
import type {
  CrashReport,
  CrashReportSummary,
  CrashSource,
} from "../types/crashReport";

let handlingCrash = false;

function normalizeCrashSource(raw: unknown): CrashSource {
  return raw === "rust" ? "rust" : "renderer";
}

function normalizeCrashReportSummary(
  raw: Record<string, unknown>,
): CrashReportSummary {
  return {
    id: String(raw.id ?? ""),
    timestampMs: Number(raw.timestampMs ?? raw.timestamp_ms ?? 0),
    source: normalizeCrashSource(raw.source),
    messagePreview: String(raw.messagePreview ?? raw.message_preview ?? ""),
  };
}

export function normalizeCrashReport(
  raw: Record<string, unknown>,
): CrashReport {
  const rawEntries = raw.recentEntries ?? raw.recent_entries;
  const recentEntries = Array.isArray(rawEntries)
    ? rawEntries.map((entry: unknown) =>
        normalizeActivityLogEntry(entry as Record<string, unknown>),
      )
    : [];

  return {
    timestampMs: Number(raw.timestampMs ?? raw.timestamp_ms ?? 0),
    source: normalizeCrashSource(raw.source),
    message: String(raw.message ?? ""),
    stackOrBacktrace: String(
      raw.stackOrBacktrace ?? raw.stack_or_backtrace ?? "",
    ),
    appVersion: String(raw.appVersion ?? raw.app_version ?? ""),
    recentEntries,
  };
}

export async function listUnacknowledgedStartupRustCrashReports(): Promise<
  CrashReportSummary[]
> {
  const reports = await invoke<Record<string, unknown>[]>(
    "list_crash_reports",
    {
      priorSessionOnly: true,
      source: "rust",
      excludeAcknowledged: true,
    },
  );
  return reports.map(normalizeCrashReportSummary);
}

export async function readCrashReport(id: string): Promise<CrashReport> {
  const report = await invoke<Record<string, unknown>>("read_crash_report", {
    id,
  });
  return normalizeCrashReport(report);
}

export async function acknowledgeCrashReport(id: string): Promise<void> {
  await invoke("acknowledge_crash_report", { id });
}

function formatError(error: unknown): { message: string; stack: string } {
  if (error instanceof Error) {
    return {
      message: error.message,
      stack: error.stack ?? "",
    };
  }
  return {
    message: String(error),
    stack: "",
  };
}

function reportRendererCrash(message: string, stack: string): void {
  if (handlingCrash) return;
  handlingCrash = true;

  void (async () => {
    try {
      await invoke("append_activity_log", {
        draft: {
          level: "error",
          domain: "app",
          message,
          details: stack ? { stack } : undefined,
        },
      });
    } catch (err: unknown) {
      console.error("Failed to log renderer crash:", err);
    } finally {
      handlingCrash = false;
    }
  })();
}

export function initCrashHandlers(): void {
  window.addEventListener("error", (event) => {
    const message = event.message || "Unhandled error";
    const stack = event.error instanceof Error ? (event.error.stack ?? "") : "";
    reportRendererCrash(message, stack);
  });

  window.addEventListener("unhandledrejection", (event) => {
    const { message, stack } = formatError(event.reason);
    reportRendererCrash(message, stack);
  });
}

/** Dev-only: fire an unhandled rejection to verify renderer crash logging. */
function triggerTestRendererCrash(): void {
  void Promise.reject(
    new Error("Spiral test renderer crash — activity log verification"),
  );
}

const SPIRAL_CRASH_DEV_HELP = `
spiralCrash — crash capture dev helpers (DEV builds only)

  await spiralCrash.testRustPanic()       trigger a Rust panic (writes crash file, app exits)
  spiralCrash.testRendererCrash()         trigger an unhandled JS rejection (activity log only)
  await spiralCrash.reportsDir()          print crash-reports directory path
  spiralCrash.help()                      this message
`.trim();

declare global {
  interface Window {
    spiralCrash?: {
      testRustPanic: () => Promise<void>;
      testRendererCrash: () => void;
      reportsDir: () => Promise<string>;
      help: () => void;
    };
  }
}

export function installCrashDevConsole(): void {
  if (!import.meta.env.DEV || typeof window === "undefined") return;

  window.spiralCrash = {
    testRustPanic: () => invoke("trigger_test_panic"),
    testRendererCrash: triggerTestRendererCrash,
    reportsDir: () => invoke<string>("get_crash_reports_dir"),
    help: () => {
      console.info(SPIRAL_CRASH_DEV_HELP);
    },
  };
}
