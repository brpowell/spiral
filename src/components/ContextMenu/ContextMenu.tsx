import { AnimatePresence, motion } from "framer-motion";
import { createPortal } from "react-dom";
import type { ReactNode, RefObject } from "react";
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
