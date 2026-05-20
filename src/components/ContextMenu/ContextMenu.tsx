import { AnimatePresence, motion } from "framer-motion";
import { createPortal } from "react-dom";
import type { ReactNode, RefObject } from "react";
import { IconCheck } from "../icons";
import { panelMotion } from "../../lib/motion";
import "./ContextMenu.css";

export function ContextMenuItem({
  icon,
  label,
  onClick,
  className,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className={className}
      onClick={onClick}
    >
      <span className="context-menu__item-icon" aria-hidden>
        {icon}
      </span>
      <span className="context-menu__item-label">{label}</span>
    </button>
  );
}

export function ContextMenuSeparator() {
  return <div className="context-menu__separator" role="separator" />;
}

export function ContextMenuHeading({ children }: { children: ReactNode }) {
  return <p className="context-menu__heading">{children}</p>;
}

export function ContextMenuCheckboxItem({
  checked,
  label,
  onClick,
}: {
  checked: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={checked}
      onClick={onClick}
    >
      <span className="context-menu__item-icon" aria-hidden>
        {checked ? <IconCheck /> : null}
      </span>
      <span className="context-menu__item-label">{label}</span>
    </button>
  );
}

interface ContextMenuProps {
  open: boolean;
  anchor: { x: number; y: number } | null;
  position: { left: number; top: number } | null;
  menuRef: RefObject<HTMLDivElement | null>;
  children: ReactNode;
}

export function ContextMenu({
  open,
  anchor,
  position,
  menuRef,
  children,
}: ContextMenuProps) {
  return createPortal(
    <AnimatePresence>
      {open && anchor != null && (
        <motion.div
          ref={menuRef}
          className="context-menu"
          style={{
            left: position?.left ?? anchor.x,
            top: position?.top ?? anchor.y,
            transformOrigin: "0 0",
            pointerEvents: position == null ? "none" : undefined,
          }}
          role="menu"
          initial={panelMotion.initial}
          animate={position ? panelMotion.animate : panelMotion.initial}
          exit={panelMotion.exit}
          transition={panelMotion.transition}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
