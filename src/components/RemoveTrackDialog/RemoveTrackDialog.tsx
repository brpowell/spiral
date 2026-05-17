import { useCallback, useEffect, useRef } from "react";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import type { Track } from "../../types/track";
import { AnimatedModal } from "../AnimatedModal/AnimatedModal";
import { ModalFooter } from "../ModalFooter/ModalFooter";
import "./RemoveTrackDialog.css";

interface RemoveTrackDialogProps {
  open: boolean;
  track: Track;
  onClose: () => void;
  onRemove: (deleteFromDisk: boolean) => Promise<void>;
}

export function RemoveTrackDialog({
  open,
  track,
  onClose,
  onRemove,
}: RemoveTrackDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const removingRef = useRef(false);

  useFocusTrap(dialogRef, open);

  const handleRemove = useCallback(
    async (deleteFromDisk: boolean) => {
      if (removingRef.current) return;
      removingRef.current = true;
      try {
        await onRemove(deleteFromDisk);
        onClose();
      } catch (err) {
        console.error("removeTrack failed:", err);
        removingRef.current = false;
      }
    },
    [onClose, onRemove],
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const subtitle = [track.artist, track.album].filter(Boolean).join(" · ");

  return (
    <AnimatedModal
      open={open}
      backdropClassName="remove-track-backdrop"
      panelClassName="remove-track-dialog"
      panelRef={dialogRef}
      labelledBy="remove-track-title"
      onBackdropClick={onClose}
    >
      <h2 id="remove-track-title" className="remove-track-dialog__heading">
        Remove from library?
      </h2>
      <p className="remove-track-dialog__track">
        <strong>{track.title}</strong>
        {subtitle ? <span>{subtitle}</span> : null}
      </p>

      <ModalFooter onCancel={onClose}>
        <button
          type="button"
          className="modal-footer__btn"
          onClick={() => void handleRemove(false)}
        >
          Remove from library
        </button>
        <button
          type="button"
          className="modal-footer__btn modal-footer__btn--danger"
          onClick={() => void handleRemove(true)}
        >
          Remove and delete file
        </button>
      </ModalFooter>
    </AnimatedModal>
  );
}
