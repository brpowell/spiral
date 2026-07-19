import { AnimatePresence, motion } from "framer-motion";
import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { fitContextMenuPosition } from "../../lib/contextMenuPosition";
import {
  focusContextMenuOnOpen,
  handleContextMenuKeyDown,
} from "../../lib/contextMenuKeyboard";
import { IconChevronRight, IconCheck } from "../icons";
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
  icon?: ReactNode;
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
      {icon != null ? (
        <span className="context-menu__item-icon" aria-hidden>
          {icon}
        </span>
      ) : null}
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

export function ContextMenuOptionItem({
  label,
  description,
  selected,
  onClick,
  disabled,
}: {
  label: ReactNode;
  description?: ReactNode;
  selected: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      className="context-menu__option"
      aria-checked={selected}
      disabled={disabled}
      onClick={onClick}
    >
      <span className="context-menu__option-content">
        <span className="context-menu__item-label">{label}</span>
        {description != null ? (
          <span className="context-menu__option-description">{description}</span>
        ) : null}
      </span>
      <span className="context-menu__option-check" aria-hidden>
        {selected ? <IconCheck /> : null}
      </span>
    </button>
  );
}

interface ContextMenuProps {
  open: boolean;
  anchor: { x: number; y: number } | null;
  position: { left: number; top: number } | null;
  menuRef: RefObject<HTMLDivElement | null>;
  /** Focus first item (keyboard). Pointer opens focus the menu root. */
  focusFirstItem?: boolean;
  className?: string;
  style?: React.CSSProperties;
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
  const openFromKeyboardRef = useRef(false);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(
    null,
  );

  const openFromKeyboard = useCallback(() => {
    openFromKeyboardRef.current = true;
    setOpen(true);
  }, []);

  const closeFromKeyboard = useCallback(() => {
    setOpen(false);
    itemRef.current?.focus();
  }, []);

  useLayoutEffect(() => {
    if (!flyoutOpen || !itemRef.current || !resolvedPanelRef.current) return;
    const itemRect = itemRef.current.getBoundingClientRect();
    const { width, height } =
      resolvedPanelRef.current.getBoundingClientRect();
    setPosition(
      fitContextMenuPosition(itemRect.right - 2, itemRect.top, width, height, {
        flipUpAlignBottomY: itemRect.bottom,
      }),
    );
  }, [flyoutOpen, children, resolvedPanelRef]);

  useLayoutEffect(() => {
    if (!flyoutOpen || !openFromKeyboardRef.current || !resolvedPanelRef.current) {
      return;
    }
    openFromKeyboardRef.current = false;
    focusContextMenuOnOpen(resolvedPanelRef.current, true);
  }, [flyoutOpen, resolvedPanelRef]);

  const onTriggerKeyDown = useCallback(
    (e: KeyboardEvent<HTMLButtonElement>) => {
      if (e.key === "ArrowRight" || e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        openFromKeyboard();
      }
    },
    [openFromKeyboard],
  );

  const onFlyoutKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      const panel = resolvedPanelRef.current;
      if (!panel) return;
      if (handleContextMenuKeyDown(e, panel, e.target)) return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        e.stopPropagation();
        closeFromKeyboard();
      }
    },
    [closeFromKeyboard, resolvedPanelRef],
  );

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
        onKeyDown={onTriggerKeyDown}
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
              data-context-menu-ignore-scroll=""
              style={{
                left: position?.left ?? -9999,
                top: position?.top ?? -9999,
                pointerEvents: position == null ? "none" : undefined,
              }}
              role="menu"
              onKeyDown={onFlyoutKeyDown}
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
  focusFirstItem = false,
  className,
  style,
  children,
}: ContextMenuProps) {
  const menuClass = ["context-menu", className].filter(Boolean).join(" ");
  const didFocusRef = useRef(false);

  useLayoutEffect(() => {
    if (!open) {
      didFocusRef.current = false;
      return;
    }
    const menu = menuRef.current;
    if (!position || !menu || didFocusRef.current) return;
    didFocusRef.current = true;
    focusContextMenuOnOpen(menu, focusFirstItem);
  }, [open, position, menuRef, focusFirstItem]);

  const onMenuKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      const menu = menuRef.current;
      if (!menu) return;
      handleContextMenuKeyDown(e, menu, e.target);
    },
    [menuRef],
  );

  return createPortal(
    <ContextMenuOpenContext.Provider value={open}>
      <AnimatePresence>
        {open && anchor != null && (
          <motion.div
            ref={menuRef}
            className={menuClass}
            style={{
              left: position?.left ?? anchor.x,
              top: position?.top ?? anchor.y,
              transformOrigin: "0 0",
              pointerEvents: position == null ? "none" : undefined,
              ...style,
            }}
            role="menu"
            tabIndex={-1}
            onKeyDown={onMenuKeyDown}
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
