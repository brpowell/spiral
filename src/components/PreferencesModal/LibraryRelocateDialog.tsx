import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import type { LibraryRelocateMode } from "../../types/library";
import { Button } from "../common/Button/Button";
import {
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from "../common/Modal/Modal";

export interface LibraryRelocateAction {
  label: string;
  mode: LibraryRelocateMode;
}

interface LibraryRelocateDialogProps {
  open: boolean;
  title: string;
  children: ReactNode;
  primary: LibraryRelocateAction;
  secondary?: LibraryRelocateAction;
  busy: boolean;
  onClose: () => void;
  onConfirm: (mode: LibraryRelocateMode) => Promise<void>;
}

export function LibraryRelocateDialog({
  open,
  title,
  children,
  primary,
  secondary,
  busy,
  onClose,
  onConfirm,
}: LibraryRelocateDialogProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [activeMode, setActiveMode] = useState<LibraryRelocateMode | null>(
    null,
  );
  const confirmingRef = useRef(false);

  useFocusTrap(dialogRef, open);

  useEffect(() => {
    if (!open) {
      confirmingRef.current = false;
      setActiveMode(null);
    }
  }, [open]);

  const handleConfirm = useCallback(
    async (mode: LibraryRelocateMode) => {
      if (confirmingRef.current || busy) return;
      confirmingRef.current = true;
      setActiveMode(mode);
      try {
        await onConfirm(mode);
        onClose();
      } catch {
        confirmingRef.current = false;
        setActiveMode(null);
      }
    },
    [busy, onClose, onConfirm],
  );

  const handleClose = () => {
    if (busy) return;
    confirmingRef.current = false;
    setActiveMode(null);
    onClose();
  };

  const primaryLabel =
    busy && activeMode === primary.mode ? "Working…" : primary.label;
  const secondaryLabel =
    secondary && busy && activeMode === secondary.mode
      ? "Working…"
      : secondary?.label;

  return (
    <Modal
      open={open}
      onClose={handleClose}
      size="sm"
      panelClassName="alert-confirmation"
      panelRef={dialogRef}
      labelledBy={titleId}
    >
      <ModalHeader>
        <ModalTitle id={titleId}>{title}</ModalTitle>
      </ModalHeader>

      <ModalBody>
        <div className="alert-confirmation__message">{children}</div>
      </ModalBody>

      <ModalFooter onCancel={handleClose} cancelDisabled={busy}>
        {secondary ? (
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => void handleConfirm(secondary.mode)}
          >
            {secondaryLabel}
          </Button>
        ) : null}
        <Button
          variant="primary"
          disabled={busy}
          onClick={() => void handleConfirm(primary.mode)}
        >
          {primaryLabel}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
