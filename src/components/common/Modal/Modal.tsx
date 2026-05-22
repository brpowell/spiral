import { AnimatePresence, motion } from "framer-motion";
import { useEffect, type ReactNode, type RefObject } from "react";
import { backdropMotion, panelMotion } from "../../../lib/motion";
import { Button } from "../Button/Button";
import { IconClose } from "../../icons";
import "./Modal.css";

export type ModalSize = "sm" | "md" | "lg" | "xl" | "editor";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  size?: ModalSize;
  panelClassName?: string;
  panelRef?: RefObject<HTMLDivElement | null>;
  labelledBy?: string;
}

export function Modal({
  open,
  onClose,
  children,
  size = "lg",
  panelClassName,
  panelRef,
  labelledBy,
}: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const panelClasses = [
    "modal-panel",
    `modal-panel--${size}`,
    panelClassName,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="modal-backdrop"
          onClick={onClose}
          {...backdropMotion}
        >
          <motion.div
            ref={panelRef}
            className={panelClasses}
            role="dialog"
            aria-modal="true"
            aria-labelledby={labelledBy}
            onClick={(e) => e.stopPropagation()}
            {...panelMotion}
          >
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function ModalHeader({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={["modal-header", className].filter(Boolean).join(" ")}
    >
      {children}
    </header>
  );
}

export function ModalHeaderMain({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={["modal-header__main", className].filter(Boolean).join(" ")}
    >
      {children}
    </div>
  );
}

export function ModalHeaderActions({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={["modal-header__actions", className].filter(Boolean).join(" ")}
    >
      {children}
    </div>
  );
}

export function ModalTitle({
  id,
  children,
  className,
}: {
  id?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <h2 id={id} className={["modal-title", className].filter(Boolean).join(" ")}>
      {children}
    </h2>
  );
}

export function ModalDescription({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <p
      className={["modal-description", className].filter(Boolean).join(" ")}
    >
      {children}
    </p>
  );
}

export function ModalCloseButton({
  onClick,
  className,
  label = "Close",
}: {
  onClick: () => void;
  className?: string;
  label?: string;
}) {
  return (
    <Button
      variant="ghost"
      size="md"
      iconOnly
      className={["modal-close", className].filter(Boolean).join(" ")}
      aria-label={label}
      onClick={onClick}
    >
      <IconClose />
    </Button>
  );
}

export function ModalBody({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={["modal-body", className].filter(Boolean).join(" ")}
    >
      {children}
    </div>
  );
}

export function ModalFooter({
  children,
  cancelLabel = "Cancel",
  onCancel,
  cancelDisabled = false,
}: {
  children: ReactNode;
  cancelLabel?: string;
  onCancel?: () => void;
  cancelDisabled?: boolean;
}) {
  return (
    <footer className="modal-footer">
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
