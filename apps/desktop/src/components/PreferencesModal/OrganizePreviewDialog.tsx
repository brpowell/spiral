import { listen } from "@tauri-apps/api/event";
import type { TFunction } from "i18next";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { sourceDisplayName } from "../../lib/sourceAccess";
import {
  applyOrganizeSource,
  FILE_PLAN_PROGRESS_EVENT,
  previewOrganizeSource,
} from "../../lib/tauri";
import type {
  FileConflict,
  FilePlanApplySummary,
  FilePlanProgress,
  FilePlanSummary,
  Source,
} from "../../types/source";
import { Button } from "../common/Button/Button";
import {
  Modal,
  ModalBody,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalHeaderMain,
  ModalTitle,
} from "../common/Modal/Modal";
import { ProgressBar } from "../common/ProgressBar/ProgressBar";
import "./OrganizePreviewDialog.css";

/** At most this many apply errors are listed in the result. */
const MAX_ERRORS_SHOWN = 5;

export interface OrganizeRequest {
  source: Source;
  /** The format to organize by; unset uses the source's own (or the default). */
  pathFormat?: string;
}

interface OrganizePreviewDialogProps {
  request: OrganizeRequest | null;
  onClose: () => void;
  /** After files moved and organizing turned on, before the result shows. */
  onApplied?: (summary: FilePlanApplySummary) => Promise<void> | void;
}

type Phase =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "preview"; summary: FilePlanSummary }
  | { kind: "applying"; summary: FilePlanSummary; done: number; total: number }
  | { kind: "done"; result: FilePlanApplySummary };

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function conflictMessage(
  t: TFunction<"dialogs">,
  conflict: FileConflict,
): string {
  switch (conflict.kind) {
    case "targetExists":
      return t("organize.conflicts.targetExists", { path: conflict.wanted });
    case "duplicateTarget":
      return t("organize.conflicts.duplicateTarget", { path: conflict.wanted });
    case "sourceMissing":
      return t("organize.conflicts.sourceMissing");
    case "sourceUnreadable":
      return t("organize.conflicts.sourceUnreadable", {
        error: conflict.error,
      });
    case "insideSpiralFolder":
      return t("organize.conflicts.insideSpiralFolder");
    case "hiddenTarget":
      return t("organize.conflicts.hiddenTarget");
    case "invalidTarget":
      return t("organize.conflicts.invalidTarget", { error: conflict.error });
  }
}

/**
 * Shows what organizing a source would move, and on confirm moves the files
 * and turns organizing on. Cancelling changes nothing.
 */
export function OrganizePreviewDialog({
  request,
  onClose,
  onApplied,
}: OrganizePreviewDialogProps) {
  const { t } = useTranslation(["dialogs", "common"]);
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const open = request != null;
  const sourceId = request?.source.id;
  const pathFormat = request?.pathFormat;

  useFocusTrap(panelRef, open);

  useEffect(() => {
    if (sourceId == null) return;
    let cancelled = false;
    setPhase({ kind: "loading" });
    previewOrganizeSource(sourceId, pathFormat).then(
      (summary) => {
        if (!cancelled) setPhase({ kind: "preview", summary });
      },
      (err: unknown) => {
        if (!cancelled) setPhase({ kind: "error", message: errorMessage(err) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [sourceId, pathFormat]);

  const applying = phase.kind === "applying";

  useEffect(() => {
    if (!applying || sourceId == null) return;
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void listen<FilePlanProgress>(FILE_PLAN_PROGRESS_EVENT, (event) => {
      const { sourceId: from, done, total } = event.payload;
      if (from !== sourceId) return;
      setPhase((prev) =>
        prev.kind === "applying" ? { ...prev, done, total } : prev,
      );
    }).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [applying, sourceId]);

  const confirm = async () => {
    if (phase.kind !== "preview" || sourceId == null) return;
    const { summary } = phase;
    setPhase({ kind: "applying", summary, done: 0, total: summary.moves });
    try {
      const result = await applyOrganizeSource(sourceId, pathFormat);
      await onApplied?.(result);
      setPhase({ kind: "done", result });
    } catch (err) {
      setPhase({ kind: "error", message: errorMessage(err) });
    }
  };

  const close = () => {
    if (applying) return;
    onClose();
  };

  const name = request ? sourceDisplayName(request.source) : "";

  return (
    <Modal
      open={open}
      onClose={close}
      size="lg"
      panelRef={panelRef}
      labelledBy={titleId}
      dismissible={!applying}
    >
      <ModalHeader>
        <ModalHeaderMain>
          <ModalTitle id={titleId}>
            {t("dialogs:organize.title", { name })}
          </ModalTitle>
          {pathFormat != null ? (
            <ModalDescription>
              {t("dialogs:organize.format")} <code>{pathFormat}</code>
            </ModalDescription>
          ) : null}
        </ModalHeaderMain>
      </ModalHeader>

      <ModalBody className="organize-preview">
        {phase.kind === "loading" ? (
          <p className="organize-preview__status" role="status">
            {t("dialogs:organize.loading")}
          </p>
        ) : null}

        {phase.kind === "error" ? (
          <p className="organize-preview__error" role="alert">
            {t("dialogs:organize.failed", { message: phase.message })}
          </p>
        ) : null}

        {phase.kind === "preview" || phase.kind === "applying" ? (
          <PlanSummary summary={phase.summary} />
        ) : null}

        {phase.kind === "applying" ? (
          <div className="organize-preview__progress" role="status">
            <ProgressBar
              value={phase.done}
              max={Math.max(phase.total, 1)}
              label={t("dialogs:organize.progress", {
                done: phase.done,
                total: phase.total,
              })}
            />
          </div>
        ) : null}

        {phase.kind === "done" ? (
          <div className="organize-preview__result" role="status">
            <p>{t("dialogs:organize.moved", { count: phase.result.moved })}</p>
            {phase.result.failed > 0 ? (
              <>
                <p className="organize-preview__error">
                  {t("dialogs:organize.failedCount", {
                    count: phase.result.failed,
                  })}
                </p>
                <ul className="organize-preview__errors">
                  {phase.result.errors
                    .slice(0, MAX_ERRORS_SHOWN)
                    .map((error, i) => (
                      <li key={i}>{error}</li>
                    ))}
                </ul>
              </>
            ) : null}
          </div>
        ) : null}
      </ModalBody>

      <ModalFooter
        onCancel={phase.kind === "done" ? undefined : close}
        cancelDisabled={applying}
      >
        {phase.kind === "preview" || phase.kind === "applying" ? (
          <Button
            variant="primary"
            disabled={applying}
            isLoading={applying}
            onClick={() => void confirm()}
          >
            {phase.summary.moves > 0
              ? t("dialogs:organize.confirm", { count: phase.summary.moves })
              : t("dialogs:organize.confirmNoMoves")}
          </Button>
        ) : null}
        {phase.kind === "done" ? (
          <Button variant="primary" onClick={onClose}>
            {t("common:close")}
          </Button>
        ) : null}
      </ModalFooter>
    </Modal>
  );
}

function PlanSummary({ summary }: { summary: FilePlanSummary }) {
  const { t } = useTranslation("dialogs");
  const counts = [
    { key: "moves", value: summary.moves - summary.renamed },
    { key: "renamed", value: summary.renamed },
    { key: "skipped", value: summary.skipped },
    { key: "unchanged", value: summary.unchanged },
  ] as const;
  const moreMoves = summary.moves - summary.sample.length;
  const moreConflicts =
    summary.renamed + summary.skipped - summary.conflicts.length;

  return (
    <>
      {summary.moves === 0 ? (
        <p>{t("organize.nothingToMove")}</p>
      ) : (
        <p>{t("organize.intro")}</p>
      )}
      <dl className="organize-preview__counts">
        {counts.map(({ key, value }) => (
          <div key={key} className="organize-preview__count">
            <dt>{t(`organize.counts.${key}`)}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>

      {summary.sample.length > 0 ? (
        <section>
          <h3 className="organize-preview__heading">
            {t("organize.sampleTitle")}
          </h3>
          <ul className="organize-preview__moves">
            {summary.sample.map(({ op }) => (
              <li key={op.trackId} className="organize-preview__move">
                <code className="organize-preview__from">
                  {op.from.relPath}
                </code>
                <span role="img" aria-label={t("organize.movesTo")}>
                  →
                </span>
                <code className="organize-preview__to">{op.to.relPath}</code>
              </li>
            ))}
          </ul>
          {moreMoves > 0 ? (
            <p className="organize-preview__more">
              {t("organize.moreMoves", { count: moreMoves })}
            </p>
          ) : null}
        </section>
      ) : null}

      {summary.conflicts.length > 0 ? (
        <section>
          <h3 className="organize-preview__heading">
            {t("organize.conflictsTitle")}
          </h3>
          <ul className="organize-preview__conflicts">
            {summary.conflicts.map(({ op, conflict }) => (
              <li
                key={op.trackId}
                className="organize-preview__conflict"
                data-conflict={conflict?.kind}
              >
                <code>{op.from.relPath}</code>
                <span>{conflict ? conflictMessage(t, conflict) : null}</span>
              </li>
            ))}
          </ul>
          {moreConflicts > 0 ? (
            <p className="organize-preview__more">
              {t("organize.moreConflicts", { count: moreConflicts })}
            </p>
          ) : null}
        </section>
      ) : null}
    </>
  );
}
