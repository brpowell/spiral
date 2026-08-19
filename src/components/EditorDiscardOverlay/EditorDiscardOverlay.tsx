import { useEffect, useId, useRef } from "react";
import { useTranslation } from "react-i18next";
import { AnimatePresence, motion } from "framer-motion";
import { backdropMotion, panelMotion } from "../../lib/motion";
import { Button } from "../common/Button/Button";
import "./EditorDiscardOverlay.css";

interface EditorDiscardOverlayProps {
  open: boolean;
  description: string;
  onKeepEditing: () => void;
  onDiscard: () => void;
  /** When set, shows a Save action (e.g. theme editor unsaved close). */
  onSave?: () => void;
  saveLabel?: string;
  saveDisabled?: boolean;
}

export function EditorDiscardOverlay({
  open,
  description,
  onKeepEditing,
  onDiscard,
  onSave,
  saveLabel,
  saveDisabled = false,
}: EditorDiscardOverlayProps) {
  const { t } = useTranslation("common");
  const resolvedSaveLabel = saveLabel ?? t("save");
  const titleId = useId();
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const firstButton = overlayRef.current?.querySelector<HTMLElement>(
      "button:not([disabled])",
    );
    firstButton?.focus();
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="editor-discard"
          ref={overlayRef}
          className="track-editor__discard-overlay"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby={titleId}
          {...backdropMotion}
        >
          <motion.div className="track-editor__discard-dialog" {...panelMotion}>
            <p id={titleId} className="track-editor__discard-title">
              {onSave ? t("saveChanges") : t("discardChanges")}
            </p>
            <p className="track-editor__discard-desc">{description}</p>
            <div className="track-editor__discard-actions">
              <Button
                variant="ghost"
                size="sm"
                className="track-editor__discard-keep"
                onClick={onKeepEditing}
              >
                {t("keepEditing")}
              </Button>
              <Button variant="danger" size="sm" onClick={onDiscard}>
                {t("discard")}
              </Button>
              {onSave ? (
                <Button
                  variant="primary"
                  size="sm"
                  disabled={saveDisabled}
                  onClick={onSave}
                >
                  {resolvedSaveLabel}
                </Button>
              ) : null}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
