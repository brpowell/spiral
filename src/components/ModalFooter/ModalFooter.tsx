import type { ReactNode } from "react";
import { Button } from "../Button/Button";
import "./ModalFooter.css";

interface ModalFooterProps {
  children: ReactNode;
  cancelLabel?: string;
  onCancel?: () => void;
  cancelDisabled?: boolean;
  padded?: boolean;
}

export function ModalFooter({
  children,
  cancelLabel = "Cancel",
  onCancel,
  cancelDisabled = false,
  padded = false,
}: ModalFooterProps) {
  return (
    <footer
      className={
        padded ? "modal-footer modal-footer--padded" : "modal-footer"
      }
    >
      <div className="modal-footer__start">
        {onCancel != null && (
          <Button
            variant="ghost"
            size="md"
            onClick={onCancel}
            disabled={cancelDisabled}
          >
            {cancelLabel}
          </Button>
        )}
      </div>
      <div className="modal-footer__end">{children}</div>
    </footer>
  );
}
