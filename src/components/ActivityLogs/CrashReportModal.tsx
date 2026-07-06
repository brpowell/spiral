import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import {
  copyDiagnosticsToClipboard,
  fetchDiagnosticsBundle,
  saveDiagnosticsToFile,
} from "../../lib/diagnosticsExport";
import type { CrashReport } from "../../types/crashReport";
import { Button } from "../common/Button/Button";
import {
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  ModalHeaderMain,
  ModalTitle,
} from "../common/Modal/Modal";
import {
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconCopy,
  IconOpenFolder,
} from "../icons";
import "./CrashReportModal.css";

const COPY_FEEDBACK_MS = 2000;

interface CrashReportModalProps {
  open: boolean;
  report: CrashReport | null;
  crashReportId?: string | null;
  onDismiss: () => void;
}

export function CrashReportModal({
  open,
  report,
  crashReportId,
  onDismiss,
}: CrashReportModalProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const copyResetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const [detailsJson, setDetailsJson] = useState<string | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [copying, setCopying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);

  useFocusTrap(panelRef, open);

  const resolvedCrashReportId = crashReportId ?? undefined;

  useEffect(() => {
    return () => {
      if (copyResetTimeoutRef.current) {
        clearTimeout(copyResetTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (open) return;
    setDetailsExpanded(false);
    setDetailsJson(null);
    setDetailsLoading(false);
    setDetailsError(null);
    setCopying(false);
    setCopied(false);
    setSaving(false);
    if (copyResetTimeoutRef.current) {
      clearTimeout(copyResetTimeoutRef.current);
      copyResetTimeoutRef.current = null;
    }
  }, [open]);

  useEffect(() => {
    if (!open || !detailsExpanded) return;

    let cancelled = false;
    setDetailsLoading(true);
    setDetailsError(null);

    void fetchDiagnosticsBundle(resolvedCrashReportId)
      .then((bundle) => {
        if (cancelled) return;
        setDetailsJson(JSON.stringify(bundle, null, 2));
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message =
          err instanceof Error ? err.message : "Failed to load log details";
        setDetailsError(message);
        setDetailsJson(null);
      })
      .finally(() => {
        if (!cancelled) setDetailsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, detailsExpanded, resolvedCrashReportId]);

  const handleCopy = useCallback(() => {
    setCopying(true);
    void copyDiagnosticsToClipboard(resolvedCrashReportId, { showToast: false })
      .then((didCopy) => {
        if (!didCopy) return;

        setCopied(true);
        if (copyResetTimeoutRef.current) {
          clearTimeout(copyResetTimeoutRef.current);
        }
        copyResetTimeoutRef.current = setTimeout(() => {
          setCopied(false);
          copyResetTimeoutRef.current = null;
        }, COPY_FEEDBACK_MS);
      })
      .finally(() => {
        setCopying(false);
      });
  }, [resolvedCrashReportId]);

  const handleSave = useCallback(() => {
    setSaving(true);
    void saveDiagnosticsToFile(resolvedCrashReportId).finally(() => {
      setSaving(false);
    });
  }, [resolvedCrashReportId]);

  return (
    <Modal
      open={open && report != null}
      onClose={onDismiss}
      size="editor"
      panelClassName="crash-report-modal__panel"
      panelRef={panelRef}
      labelledBy={titleId}
      dismissible={false}
    >
      {report != null && (
        <>
          <ModalHeader>
            <ModalHeaderMain>
              <ModalTitle id={titleId}>Spiral quit unexpectedly</ModalTitle>
            </ModalHeaderMain>
          </ModalHeader>

          <ModalBody className="crash-report-modal__body">
            <p className="crash-report-modal__intro">
              Something went wrong, causing the app to close.
            </p>

            <div className="crash-report-modal__export-actions">
              <Button
                variant="secondary"
                size="sm"
                onClick={handleCopy}
                disabled={copying || saving}
              >
                {copied ? <IconCheck /> : <IconCopy />}
                {copied ? "Copied" : copying ? "Copying…" : "Copy logs"}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleSave}
                disabled={copying || saving}
              >
                <IconOpenFolder />
                {saving ? "Exporting…" : "Export logs…"}
              </Button>
            </div>

            <div className="crash-report-modal__details">
              <button
                type="button"
                className="crash-report-modal__details-toggle"
                aria-expanded={detailsExpanded}
                onClick={() => setDetailsExpanded((previous) => !previous)}
              >
                {detailsExpanded ? <IconChevronDown /> : <IconChevronRight />}
                Technical details
              </button>

              {detailsExpanded && (
                <div className="crash-report-modal__details-body">
                  {detailsLoading ? (
                    <p className="crash-report-modal__details-status">Loading…</p>
                  ) : detailsError != null ? (
                    <p className="crash-report-modal__details-status crash-report-modal__details-status--error">
                      {detailsError}
                    </p>
                  ) : detailsJson != null ? (
                    <pre className="crash-report-modal__json">{detailsJson}</pre>
                  ) : null}
                </div>
              )}
            </div>
          </ModalBody>

          <ModalFooter>
            <Button variant="primary" size="md" onClick={onDismiss}>
              Continue
            </Button>
          </ModalFooter>
        </>
      )}
    </Modal>
  );
}
