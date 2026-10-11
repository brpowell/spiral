import { invoke } from "@tauri-apps/api/core";
import { normalizeActivityLogEntry } from "./activityLogLine";
import { copyTextToClipboard } from "./clipboard";
import { normalizeCrashReport } from "./crashReport";
import {
  diagnosticsCopiedPayload,
  diagnosticsSavedPayload,
} from "./toastPayloads";
import { useBackgroundTasksStore } from "../store/useBackgroundTasksStore";
import type {
  DiagnosticsBundle,
  DiagnosticsCrashReport,
  DiagnosticsEnvironment,
} from "../types/diagnosticsExport";

function normalizeEnvironment(
  raw: Record<string, unknown>,
): DiagnosticsEnvironment {
  return {
    appVersion: String(raw.appVersion ?? raw.app_version ?? ""),
    os: String(raw.os ?? ""),
    arch: String(raw.arch ?? ""),
  };
}

function normalizeDiagnosticsCrashReport(
  raw: Record<string, unknown>,
): DiagnosticsCrashReport {
  return {
    id: String(raw.id ?? ""),
    ...normalizeCrashReport(raw),
  };
}

function normalizeDiagnosticsBundle(
  raw: Record<string, unknown>,
): DiagnosticsBundle {
  const rawEntries = raw.activityLogEntries ?? raw.activity_log_entries;
  const activityLogEntries = Array.isArray(rawEntries)
    ? rawEntries.map((entry: unknown) =>
        normalizeActivityLogEntry(entry as Record<string, unknown>),
      )
    : undefined;

  const rawCrashReport = raw.crashReport ?? raw.crash_report;
  const crashReport =
    rawCrashReport != null && typeof rawCrashReport === "object"
      ? normalizeDiagnosticsCrashReport(
          rawCrashReport as Record<string, unknown>,
        )
      : null;

  return {
    exportedAtMs: Number(raw.exportedAtMs ?? raw.exported_at_ms ?? 0),
    environment: normalizeEnvironment(
      (raw.environment as Record<string, unknown> | undefined) ?? {},
    ),
    activityLogEntries,
    crashReport,
  };
}

export async function fetchDiagnosticsBundle(
  crashReportId?: string,
): Promise<DiagnosticsBundle> {
  const bundle = await invoke<Record<string, unknown>>("export_diagnostics", {
    crashReportId: crashReportId ?? null,
  });
  return normalizeDiagnosticsBundle(bundle);
}

export async function copyDiagnosticsToClipboard(
  crashReportId?: string,
  options?: { showToast?: boolean },
): Promise<boolean> {
  const bundle = await fetchDiagnosticsBundle(crashReportId);
  const json = JSON.stringify(bundle, null, 2);
  const copied = await copyTextToClipboard(json);
  if (copied && options?.showToast !== false) {
    showDiagnosticsCopiedToast();
  }
  return copied;
}

export async function saveDiagnosticsToFile(
  crashReportId?: string,
): Promise<string | null> {
  const path = await invoke<string | null>("save_diagnostics_export", {
    crashReportId: crashReportId ?? null,
  });
  if (path != null) {
    showDiagnosticsSavedToast(path);
  }
  return path;
}

function showDiagnosticsCopiedToast(): void {
  useBackgroundTasksStore.getState().showToast(diagnosticsCopiedPayload());
}

function showDiagnosticsSavedToast(path: string): void {
  const fileName = path.split(/[/\\]/).pop() ?? path;
  useBackgroundTasksStore
    .getState()
    .showToast(diagnosticsSavedPayload(fileName));
}
