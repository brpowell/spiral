import { useCallback, useEffect, useState, type RefObject } from "react";
import { useContextMenu } from "./useContextMenu";

const MENU_GAP = 4;

export type UseInputAnchoredMenuOptions = {
  inputRef: RefObject<HTMLInputElement | null>;
  containerRef: RefObject<HTMLElement | null>;
  disabled?: boolean;
  shouldOpen: boolean;
  closeOnScroll?: boolean;
  layoutDeps?: unknown[];
};

export function useInputAnchoredMenu({
  inputRef,
  containerRef,
  disabled = false,
  shouldOpen,
  closeOnScroll = false,
  layoutDeps = [],
}: UseInputAnchoredMenuOptions) {
  const { open, anchor, position, menuRef, openAt, closeMenu } = useContextMenu({
    dismissExcludeRefs: [containerRef],
    closeOnScroll,
    layoutDeps,
  });
  const [menuWidth, setMenuWidth] = useState<number | null>(null);

  const syncAnchor = useCallback(() => {
    const input = inputRef.current;
    const widthEl = containerRef.current ?? input;
    if (!input || !widthEl) return;
    const rect = widthEl.getBoundingClientRect();
    setMenuWidth(rect.width);
    openAt(rect.left, rect.bottom + MENU_GAP, {
      flipUpAlignBottomY: rect.top - MENU_GAP,
    });
  }, [inputRef, containerRef, openAt]);

  useEffect(() => {
    const input = inputRef.current;
    if (
      !input ||
      disabled ||
      document.activeElement !== input ||
      !shouldOpen
    ) {
      closeMenu();
      setMenuWidth(null);
      return;
    }
    syncAnchor();
  }, [shouldOpen, disabled, inputRef, closeMenu, syncAnchor]);

  useEffect(() => {
    if (!open) return;
    const reposition = () => {
      syncAnchor();
    };
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [open, syncAnchor]);

  return { open, anchor, position, menuRef, menuWidth, closeMenu };
}
