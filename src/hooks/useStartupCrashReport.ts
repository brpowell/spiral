import { useCallback, useEffect, useState } from "react";
import {
  acknowledgeCrashReport,
  listUnacknowledgedStartupRustCrashReports,
  readCrashReport,
} from "../lib/crashReport";
import type { CrashReport } from "../types/crashReport";

export function useStartupCrashReport() {
  const [open, setOpen] = useState(false);
  const [report, setReport] = useState<CrashReport | null>(null);
  const [crashReportId, setCrashReportId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const summaries = await listUnacknowledgedStartupRustCrashReports();
        if (cancelled || summaries.length === 0) return;

        const summary = summaries[0];
        const loaded = await readCrashReport(summary.id);
        if (cancelled) return;

        setCrashReportId(summary.id);
        setReport(loaded);
        setOpen(true);
      } catch (err: unknown) {
        console.error("Failed to load startup crash report:", err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const dismiss = useCallback(() => {
    if (crashReportId != null) {
      void acknowledgeCrashReport(crashReportId).catch((err: unknown) => {
        console.error("Failed to acknowledge crash report:", err);
      });
    }
    setOpen(false);
  }, [crashReportId]);

  return {
    open,
    report,
    crashReportId,
    dismiss,
  };
}
