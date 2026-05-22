import { useCallback, useRef } from "react";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import type { Track } from "../../types/track";
import { Button } from "../common/Button/Button";
import {
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from "../common/Modal/Modal";
import "./RemoveTrackDialog.css";

interface RemoveTrackDialogProps {
  open: boolean;
  tracks: Track[];
  onClose: () => void;
  onRemove: (deleteFromDisk: boolean) => Promise<void>;
}

export function RemoveTrackDialog({
  open,
  tracks,
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

  const count = tracks.length;
  const heading =
    count === 1
      ? "Remove from library?"
      : `Remove ${count} tracks from library?`;

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      panelRef={dialogRef}
      labelledBy="remove-track-title"
    >
      <ModalHeader>
        <ModalTitle id="remove-track-title">{heading}</ModalTitle>
      </ModalHeader>

      <ModalBody>
        <ul className="remove-track-dialog__list">
          {tracks.map((track) => {
            const subtitle = [track.artist, track.album]
              .filter(Boolean)
              .join(" · ");
            return (
              <li key={track.id} className="remove-track-dialog__track">
                <strong>{track.title}</strong>
                {subtitle ? <span>{subtitle}</span> : null}
              </li>
            );
          })}
        </ul>
      </ModalBody>

      <ModalFooter onCancel={onClose}>
        <Button
          variant="secondary"
          onClick={() => void handleRemove(false)}
        >
          Remove from library
        </Button>
        <Button variant="danger" onClick={() => void handleRemove(true)}>
          Remove and delete file{count > 1 ? "s" : ""}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
