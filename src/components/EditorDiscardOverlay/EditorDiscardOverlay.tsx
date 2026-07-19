import { useEffect, useId, useRef } from "react";
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
  saveLabel = "Save",
  saveDisabled = false,
}: EditorDiscardOverlayProps) {
  const titleId = useId();
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const firstButton =
      overlayRef.current?.querySelector<HTMLElement>(
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
              {onSave ? "Save changes?" : "Discard changes?"}
            </p>
            <p className="track-editor__discard-desc">{description}</p>
            <div className="track-editor__discard-actions">
              <Button
                variant="ghost"
                size="sm"
                className="track-editor__discard-keep"
                onClick={onKeepEditing}
              >
                Keep editing
              </Button>
              <Button variant="danger" size="sm" onClick={onDiscard}>
                Discard
              </Button>
              {onSave ? (
                <Button
                  variant="primary"
                  size="sm"
                  disabled={saveDisabled}
                  onClick={onSave}
                >
                  {saveLabel}
                </Button>
              ) : null}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
