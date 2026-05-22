import { AnimatePresence, motion } from "framer-motion";
import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { fitContextMenuPosition } from "../../lib/contextMenuPosition";
import { IconChevronRight } from "../icons";
import { IconCheck } from "../icons";
import { panelMotion } from "../../lib/motion";
import "./ContextMenu.css";

const ContextMenuOpenContext = createContext(true);

export function ContextMenuItem({
  icon,
  label,
  onClick,
  className,
  disabled,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className={className}
      disabled={disabled}
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

interface ContextMenuSubmenuProps {
  label: string;
  icon?: ReactNode;
  children: ReactNode;
  panelRef?: RefObject<HTMLDivElement | null>;
}

export function ContextMenuSubmenu({
  label,
  icon,
  children,
  panelRef,
}: ContextMenuSubmenuProps) {
  const parentOpen = useContext(ContextMenuOpenContext);
  const [open, setOpen] = useState(false);
  const flyoutOpen = open && parentOpen;
  const itemRef = useRef<HTMLButtonElement>(null);
  const internalPanelRef = useRef<HTMLDivElement>(null);
  const resolvedPanelRef = panelRef ?? internalPanelRef;
  const [position, setPosition] = useState<{ left: number; top: number } | null>(
    null,
  );

  useLayoutEffect(() => {
    if (!flyoutOpen || !itemRef.current || !resolvedPanelRef.current) return;
    const itemRect = itemRef.current.getBoundingClientRect();
    const { width, height } =
      resolvedPanelRef.current.getBoundingClientRect();
    setPosition(
      fitContextMenuPosition(itemRect.right - 2, itemRect.top, width, height),
    );
  }, [flyoutOpen, children, resolvedPanelRef]);

  return (
    <div
      className="context-menu__submenu-wrap"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        ref={itemRef}
        type="button"
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={open}
        className="context-menu__submenu-trigger"
      >
        {icon != null ? (
          <span className="context-menu__item-icon" aria-hidden>
            {icon}
          </span>
        ) : (
          <span className="context-menu__item-icon" aria-hidden />
        )}
        <span className="context-menu__item-label">{label}</span>
        <span className="context-menu__submenu-chevron" aria-hidden>
          <IconChevronRight />
        </span>
      </button>
      {createPortal(
        <AnimatePresence>
          {flyoutOpen ? (
            <motion.div
              ref={resolvedPanelRef}
              className="context-menu context-menu--flyout"
              style={{
                left: position?.left ?? -9999,
                top: position?.top ?? -9999,
                pointerEvents: position == null ? "none" : undefined,
              }}
              role="menu"
              onMouseEnter={() => setOpen(true)}
              onMouseLeave={() => setOpen(false)}
              initial={panelMotion.initial}
              animate={position ? panelMotion.animate : panelMotion.initial}
              exit={panelMotion.exit}
              transition={panelMotion.transition}
            >
              {children}
            </motion.div>
          ) : null}
        </AnimatePresence>,
        document.body,
      )}
    </div>
  );
}

export function ContextMenu({
  open,
  anchor,
  position,
  menuRef,
  children,
}: ContextMenuProps) {
  return createPortal(
    <ContextMenuOpenContext.Provider value={open}>
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
      </AnimatePresence>
    </ContextMenuOpenContext.Provider>,
    document.body,
  );
}
