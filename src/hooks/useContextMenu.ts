import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { fitContextMenuPosition } from "../lib/contextMenuPosition";

const TRIGGER_MENU_GAP = 4;

export interface UseContextMenuOptions {
  /** Re-run viewport fit when menu content size may change */
  layoutDeps?: unknown[];
  /** Called when menu opens, after preventDefault/stopPropagation */
  onBeforeOpen?: (e: React.MouseEvent) => void;
  /** Clicks on these elements do not dismiss the menu (e.g. a toggle trigger) */
  dismissExcludeRefs?: RefObject<HTMLElement | null>[];
}

export function useContextMenu(options: UseContextMenuOptions = {}) {
  const { layoutDeps = [], onBeforeOpen, dismissExcludeRefs = [] } = options;

  const [menuAnchor, setMenuAnchor] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [menuPosition, setMenuPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const dismissExcludeRefsRef = useRef(dismissExcludeRefs);
  dismissExcludeRefsRef.current = dismissExcludeRefs;

  const closeMenu = useCallback(() => {
    setMenuAnchor(null);
    setMenuPosition(null);
  }, []);

  const onContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      onBeforeOpen?.(e);
      setMenuPosition(null);
      setMenuAnchor({ x: e.clientX, y: e.clientY });
    },
    [onBeforeOpen],
  );

  const openAt = useCallback((x: number, y: number) => {
    setMenuPosition(null);
    setMenuAnchor({ x, y });
  }, []);

  const openFromTrigger = useCallback((el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    openAt(rect.right, rect.bottom + TRIGGER_MENU_GAP);
  }, [openAt]);

  const toggleFromTrigger = useCallback(
    (el: HTMLElement | null) => {
      if (!el) return;
      if (menuAnchor) {
        closeMenu();
        return;
      }
      openFromTrigger(el);
    },
    [menuAnchor, closeMenu, openFromTrigger],
  );

  useLayoutEffect(() => {
    if (!menuAnchor || !menuRef.current) return;
    const { width, height } = menuRef.current.getBoundingClientRect();
    setMenuPosition(
      fitContextMenuPosition(menuAnchor.x, menuAnchor.y, width, height),
    );
    // layoutDeps drives refit when menu items change
    // eslint-disable-next-line react-hooks/exhaustive-deps -- layoutDeps is intentional
  }, [menuAnchor, ...layoutDeps]);

  useEffect(() => {
    if (!menuAnchor) return;
    const onPointerDown = (e: PointerEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      if (
        dismissExcludeRefsRef.current.some((ref) =>
          ref.current?.contains(e.target as Node),
        )
      ) {
        return;
      }
      closeMenu();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeMenu();
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", closeMenu, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", closeMenu, true);
    };
  }, [menuAnchor, closeMenu]);

  return {
    open: menuAnchor != null,
    anchor: menuAnchor,
    position: menuPosition,
    menuRef,
    onContextMenu,
    closeMenu,
    openAt,
    openFromTrigger,
    toggleFromTrigger,
  };
}
