import { useCallback, useEffect, useRef } from "react";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import {
  useCdImportStore,
  type CdImportCancelChoice,
} from "../../store/useCdImportStore";
import { Button } from "../common/Button/Button";
import {
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from "../common/Modal/Modal";
import "../RemoveTrackDialog/RemoveTrackDialog.css";
import "./CdImportCancelDialog.css";

export function CdImportCancelDialog() {
  const cancelPrompt = useCdImportStore((s) => s.cancelPrompt);
  const resolveCancelPrompt = useCdImportStore((s) => s.resolveCancelPrompt);
  const dialogRef = useRef<HTMLDivElement>(null);
  const resolvingRef = useRef(false);

  const open = cancelPrompt != null;
  const tracks = cancelPrompt?.tracks ?? [];
  const count = tracks.length;

  useFocusTrap(dialogRef, open);

  useEffect(() => {
    if (open) resolvingRef.current = false;
  }, [open]);

  const handleChoice = useCallback(
    async (choice: CdImportCancelChoice) => {
      if (resolvingRef.current) return;
      resolvingRef.current = true;
      try {
        await resolveCancelPrompt(choice);
      } catch (err) {
        console.error("resolveCancelPrompt failed:", err);
        resolvingRef.current = false;
      }
    },
    [resolveCancelPrompt],
  );

  const heading =
    count === 1
      ? "Keep this imported track in your library?"
      : `Keep these ${count} imported tracks in your library?`;

  return (
    <Modal
      open={open}
      onClose={() => {}}
      dismissible={false}
      size="xl"
      panelRef={dialogRef}
      labelledBy="cd-import-cancel-title"
    >
      <ModalHeader>
        <ModalTitle id="cd-import-cancel-title">Import cancelled</ModalTitle>
      </ModalHeader>

      <ModalBody>
        <p className="cd-import-cancel-dialog__lead">{heading}</p>
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

      <ModalFooter>
        <Button variant="secondary" onClick={() => void handleChoice("keep")}>
          Keep
        </Button>
        <Button variant="danger" onClick={() => void handleChoice("delete")}>
          Delete
        </Button>
      </ModalFooter>
    </Modal>
  );
}
