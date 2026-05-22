import { useCallback, useId, useRef, type ReactNode } from "react";
import { useFocusTrap } from "../../../hooks/useFocusTrap";
import { Button, type ButtonVariant } from "../Button/Button";
import {
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from "../Modal/Modal";
import "./AlertConfirmation.css";

export interface AlertConfirmationProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  onConfirm: () => void | Promise<void>;
  confirmVariant?: ButtonVariant;
  cancelLabel?: string;
  titleId?: string;
}

export function AlertConfirmation({
  open,
  onClose,
  title,
  children,
  confirmLabel,
  onConfirm,
  confirmVariant = "danger",
  cancelLabel = "Cancel",
  titleId: titleIdProp,
}: AlertConfirmationProps) {
  const generatedTitleId = useId();
  const titleId = titleIdProp ?? generatedTitleId;
  const dialogRef = useRef<HTMLDivElement>(null);
  const confirmingRef = useRef(false);

  useFocusTrap(dialogRef, open);

  const handleConfirm = useCallback(async () => {
    if (confirmingRef.current) return;
    confirmingRef.current = true;
    try {
      await onConfirm();
      onClose();
    } catch (err) {
      console.error("AlertConfirmation confirm failed:", err);
      confirmingRef.current = false;
    }
  }, [onClose, onConfirm]);

  return (
    <Modal
      open={open}
      onClose={onClose}
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

      <ModalFooter onCancel={onClose} cancelLabel={cancelLabel}>
        <Button
          variant={confirmVariant}
          onClick={() => void handleConfirm()}
        >
          {confirmLabel}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
