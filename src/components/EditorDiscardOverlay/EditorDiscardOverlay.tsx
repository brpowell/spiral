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
}

export function EditorDiscardOverlay({
  open,
  description,
  onKeepEditing,
  onDiscard,
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
              Discard changes?
            </p>
            <p className="track-editor__discard-desc">{description}</p>
            <div className="track-editor__discard-actions">
              <Button variant="ghost" size="sm" onClick={onKeepEditing}>
                Keep editing
              </Button>
              <Button variant="danger" size="sm" onClick={onDiscard}>
                Discard
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
