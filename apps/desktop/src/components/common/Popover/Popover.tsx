import { AnimatePresence, motion } from "framer-motion";
import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type Ref,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import {
  useContextMenu,
  type ContextMenuTriggerPlacement,
} from "../../../hooks/useContextMenu";
import { panelMotion } from "../../../lib/motion";
import { Button, type ButtonProps } from "../Button/Button";
import "./Popover.css";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function assignRef<T>(ref: Ref<T> | undefined, node: T | null) {
  if (typeof ref === "function") ref(node);
  else if (ref) ref.current = node;
}

function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.tabIndex !== -1,
  );
}

export type PopoverCloseOptions = {
  /**
   * Move focus back to the trigger. Set this for Escape and explicit
   * selection. Outside clicks should leave focus on whatever was pressed.
   */
  restoreFocus?: boolean;
};

type PopoverContextValue = {
  open: boolean;
  contentId: string;
  triggerRef: RefObject<HTMLButtonElement | null>;
  panelRef: RefObject<HTMLDivElement | null>;
  anchor: { x: number; y: number } | null;
  position: { left: number; top: number } | null;
  toggle: () => void;
  close: (options?: PopoverCloseOptions) => void;
  onPanelKeyDown: (e: ReactKeyboardEvent<HTMLDivElement>) => void;
};

const PopoverContext = createContext<PopoverContextValue | null>(null);

function usePopoverContext(): PopoverContextValue {
  const ctx = useContext(PopoverContext);
  if (!ctx) {
    throw new Error("Popover components must be used within Popover");
  }
  return ctx;
}

/** Close the surrounding popover from its content. */
export function usePopover(): {
  close: PopoverContextValue["close"];
} {
  const { close } = usePopoverContext();
  return { close };
}

export type PopoverProps = {
  children: ReactNode;
  /** Where the panel anchors relative to the trigger. */
  placement?: ContextMenuTriggerPlacement;
  onOpenChange?: (open: boolean) => void;
};

/**
 * Anchored panel opened from a button. Positioning and outside-click / Escape
 * dismissal come from the shared menu hook; this shell is not a menu, so
 * search fields and grids inside keep their own keyboard behavior.
 */
export function Popover({
  children,
  placement = "below-start",
  onOpenChange,
}: PopoverProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const contentId = useId();
  const restoreFocusOnClose = useRef(false);
  const openRef = useRef(false);
  const [contentSize, setContentSize] = useState({ w: 0, h: 0 });

  // Registered before useContextMenu's Escape listener so this runs first.
  // That listener stops the event, which also keeps a parent modal from closing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && openRef.current) {
        restoreFocusOnClose.current = true;
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  const { open, anchor, position, menuRef, closeMenu, toggleFromTrigger } =
    useContextMenu({
      layoutDeps: [contentSize.w, contentSize.h],
      dismissExcludeRefs: [triggerRef],
      triggerPlacement: placement,
    });

  openRef.current = open;

  const close = useCallback(
    (options?: PopoverCloseOptions) => {
      if (options?.restoreFocus) restoreFocusOnClose.current = true;
      closeMenu();
    },
    [closeMenu],
  );

  const toggle = useCallback(() => {
    toggleFromTrigger(triggerRef.current);
  }, [toggleFromTrigger]);

  useEffect(() => {
    if (open) return;
    if (!restoreFocusOnClose.current) return;
    restoreFocusOnClose.current = false;
    triggerRef.current?.focus();
  }, [open]);

  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current === open) return;
    wasOpen.current = open;
    onOpenChangeRef.current?.(open);
  }, [open]);

  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!open || !el) return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const width = Math.round(entry.contentRect.width);
      const height = Math.round(entry.contentRect.height);
      setContentSize((prev) =>
        prev.w === width && prev.h === height ? prev : { w: width, h: height },
      );
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [open, menuRef]);

  const didFocus = useRef(false);
  useEffect(() => {
    if (!open) {
      didFocus.current = false;
      return;
    }
    if (!position || didFocus.current) return;
    const panel = menuRef.current;
    if (!panel) return;
    didFocus.current = true;
    const items = getFocusable(panel);
    (items[0] ?? panel).focus();
  }, [open, position, menuRef]);

  const onPanelKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      if (e.key !== "Tab") return;
      const panel = menuRef.current;
      if (!panel) return;
      const items = getFocusable(panel);
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    },
    [menuRef],
  );

  const value = useMemo<PopoverContextValue>(
    () => ({
      open,
      contentId,
      triggerRef,
      panelRef: menuRef,
      anchor,
      position,
      toggle,
      close,
      onPanelKeyDown,
    }),
    [open, menuRef, anchor, position, contentId, toggle, close, onPanelKeyDown],
  );

  return (
    <PopoverContext.Provider value={value}>{children}</PopoverContext.Provider>
  );
}

export type PopoverTriggerProps = ButtonProps;

export const PopoverTrigger = forwardRef<
  HTMLButtonElement,
  PopoverTriggerProps
>(function PopoverTrigger({ className, onClick, disabled, ...props }, ref) {
  const { open, contentId, triggerRef, toggle } = usePopoverContext();

  const setRef = useCallback(
    (node: HTMLButtonElement | null) => {
      triggerRef.current = node;
      assignRef(ref, node);
    },
    [ref, triggerRef],
  );

  return (
    <Button
      {...props}
      ref={setRef}
      className={className}
      disabled={disabled}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-controls={open ? contentId : undefined}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented || disabled) return;
        toggle();
      }}
    />
  );
});

export type PopoverContentProps = {
  children: ReactNode;
  className?: string;
  /** Accessible name for the panel. */
  "aria-label": string;
};

export function PopoverContent({
  children,
  className,
  "aria-label": ariaLabel,
}: PopoverContentProps) {
  const { open, anchor, position, panelRef, contentId, onPanelKeyDown } =
    usePopoverContext();

  return createPortal(
    <AnimatePresence>
      {open && anchor != null ? (
        <motion.div
          ref={panelRef}
          id={contentId}
          role="dialog"
          aria-label={ariaLabel}
          tabIndex={-1}
          className={["popover", className].filter(Boolean).join(" ")}
          style={{
            left: position?.left ?? anchor.x,
            top: position?.top ?? anchor.y,
            pointerEvents: position == null ? "none" : undefined,
          }}
          onKeyDown={onPanelKeyDown}
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
  );
}
