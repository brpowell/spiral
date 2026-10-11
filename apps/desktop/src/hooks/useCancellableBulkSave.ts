import { useCallback, useRef, useState } from "react";

export type BulkSaveProgress = { current: number; total: number };

export function useCancellableBulkSave() {
  const [saving, setSaving] = useState(false);
  const [saveProgress, setSaveProgress] = useState<BulkSaveProgress | null>(
    null,
  );
  const [cancelRequested, setCancelRequested] = useState(false);
  const cancelRef = useRef(false);

  const begin = useCallback((total: number) => {
    cancelRef.current = false;
    setCancelRequested(false);
    setSaving(true);
    setSaveProgress({ current: 0, total });
  }, []);

  const beginQuick = useCallback(() => {
    cancelRef.current = false;
    setCancelRequested(false);
    setSaving(true);
    setSaveProgress(null);
  }, []);

  const requestCancel = useCallback(() => {
    cancelRef.current = true;
    setCancelRequested(true);
  }, []);

  const isCancelled = useCallback(() => cancelRef.current, []);

  const setProgress = useCallback((current: number, total: number) => {
    setSaveProgress({ current, total });
  }, []);

  const enterQuickPhase = useCallback(() => {
    setSaveProgress(null);
  }, []);

  const finish = useCallback(() => {
    setSaving(false);
    setSaveProgress(null);
    setCancelRequested(false);
    cancelRef.current = false;
  }, []);

  return {
    saving,
    saveProgress,
    cancelRequested,
    begin,
    beginQuick,
    requestCancel,
    isCancelled,
    setProgress,
    enterQuickPhase,
    finish,
  };
}

/** True when a multi-track save loop is running and can be cancelled. */
export function canCancelBulkSave(
  saving: boolean,
  saveProgress: BulkSaveProgress | null,
): boolean {
  return saving && saveProgress != null;
}

type EditorTranslate = (key: string, opts?: Record<string, unknown>) => string;

export function bulkSaveLabel(
  saving: boolean,
  saveProgress: BulkSaveProgress | null,
  t: EditorTranslate,
): string {
  if (!saving) return t("common:save");
  if (saveProgress) {
    return t("library:editor.savingProgress", {
      current: saveProgress.current,
      total: saveProgress.total,
    });
  }
  return t("common:saving");
}

export function bulkSaveFooterProps(options: {
  saving: boolean;
  saveProgress: BulkSaveProgress | null;
  cancelRequested: boolean;
  requestCancel: () => void;
  requestClose: () => void;
  t: EditorTranslate;
}) {
  const cancelSaveActive = canCancelBulkSave(
    options.saving,
    options.saveProgress,
  );

  return {
    onCancel: cancelSaveActive ? options.requestCancel : options.requestClose,
    cancelDisabled:
      options.saving && (!cancelSaveActive || options.cancelRequested),
    cancelLabel: options.cancelRequested
      ? options.t("common:cancelling")
      : options.t("common:cancel"),
  };
}
