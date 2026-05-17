import type { ReactNode } from "react";
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
          <button
            type="button"
            className="modal-footer__cancel"
            onClick={onCancel}
            disabled={cancelDisabled}
          >
            {cancelLabel}
          </button>
        )}
      </div>
      <div className="modal-footer__end">{children}</div>
    </footer>
  );
}
