import { useCallback, useId, useRef, type ReactNode } from "react";
import { useFocusTrap } from "../../../hooks/useFocusTrap";
import { t } from "../../../lib/i18n";
import { MODAL_EXIT_MS } from "../../../lib/motion";
import { Button, type ButtonVariant } from "../Button/Button";
import {
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  type ModalSize,
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
  /** Optional middle/right action (e.g. Keep unique) before the confirm button. */
  secondaryLabel?: string;
  onSecondary?: () => void | Promise<void>;
  secondaryVariant?: ButtonVariant;
  cancelLabel?: string;
  titleId?: string;
  size?: ModalSize;
  panelClassName?: string;
  /**
   * Close and finish the exit fade before running confirm/secondary.
   * Use when the action starts heavy UI work (bulk saves) that would stutter
   * against the dismiss animation.
   */
  deferActionUntilClosed?: boolean;
}

function waitForModalExit(): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, MODAL_EXIT_MS);
  });
}

export function AlertConfirmation({
  open,
  onClose,
  title,
  children,
  confirmLabel,
  onConfirm,
  confirmVariant = "danger",
  secondaryLabel,
  onSecondary,
  secondaryVariant = "secondary",
  cancelLabel = t("common:cancel"),
  titleId: titleIdProp,
  size = "sm",
  panelClassName,
  deferActionUntilClosed = false,
}: AlertConfirmationProps) {
  const generatedTitleId = useId();
  const titleId = titleIdProp ?? generatedTitleId;
  const dialogRef = useRef<HTMLDivElement>(null);
  const confirmingRef = useRef(false);

  useFocusTrap(dialogRef, open);

  const runAction = useCallback(
    async (action: () => void | Promise<void>) => {
      if (confirmingRef.current) return;
      confirmingRef.current = true;
      try {
        if (deferActionUntilClosed) {
          onClose();
          await waitForModalExit();
          await action();
        } else {
          await action();
          onClose();
        }
      } catch (err) {
        console.error("AlertConfirmation action failed:", err);
      } finally {
        confirmingRef.current = false;
      }
    },
    [deferActionUntilClosed, onClose],
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      size={size}
      panelClassName={["alert-confirmation", panelClassName]
        .filter(Boolean)
        .join(" ")}
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
        {secondaryLabel != null && onSecondary != null ? (
          <Button
            variant={secondaryVariant}
            onClick={() => void runAction(onSecondary)}
          >
            {secondaryLabel}
          </Button>
        ) : null}
        <Button
          variant={confirmVariant}
          onClick={() => void runAction(onConfirm)}
        >
          {confirmLabel}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
