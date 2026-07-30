import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import {
  fitContextMenuPosition,
  type FitContextMenuPositionOptions,
} from "../lib/contextMenuPosition";

const TRIGGER_MENU_GAP = 4;

/** Put on scroll containers whose scroll should not dismiss context menus. */
export const CONTEXT_MENU_IGNORE_SCROLL_ATTR = "data-context-menu-ignore-scroll";

type MenuAnchor = {
  x: number;
  y: number;
  fitOptions?: FitContextMenuPositionOptions;
  keyboard?: boolean;
};

export type ContextMenuTriggerPlacement =
  | "below-end"
  | "below-start"
  | "above-end"
  | "above-start";

export type OpenContextMenuOptions = {
  /** Focus first item instead of the menu root (keyboard opens). */
  keyboard?: boolean;
};

export interface UseContextMenuOptions {
  /** Re-run viewport fit when menu content size may change */
  layoutDeps?: unknown[];
  /** Called when menu opens, after preventDefault/stopPropagation */
  onBeforeOpen?: (e: React.MouseEvent) => void;
  /** Clicks on these elements do not dismiss the menu (e.g. a toggle trigger) */
  dismissExcludeRefs?: RefObject<HTMLElement | null>[];
  /** Whether scrolling should dismiss an open menu. Defaults to true. */
  closeOnScroll?: boolean;
  /** Where to anchor menus opened from a trigger element */
  triggerPlacement?: ContextMenuTriggerPlacement;
}

export function useContextMenu(options: UseContextMenuOptions = {}) {
  const {
    layoutDeps = [],
    onBeforeOpen,
    dismissExcludeRefs = [],
    closeOnScroll = true,
    triggerPlacement = "below-end",
  } = options;

  const [menuAnchor, setMenuAnchor] = useState<MenuAnchor | null>(null);
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

  const openAt = useCallback(
    (
      x: number,
      y: number,
      fitOptions?: FitContextMenuPositionOptions,
      openOptions?: OpenContextMenuOptions,
    ) => {
      setMenuPosition(null);
      setMenuAnchor({
        x,
        y,
        fitOptions,
        keyboard: openOptions?.keyboard,
      });
    },
    [],
  );

  const openFromTrigger = useCallback(
    (el: HTMLElement, openOptions?: OpenContextMenuOptions) => {
      const rect = el.getBoundingClientRect();
      const preferAbove = triggerPlacement.startsWith("above");
      const align = triggerPlacement.endsWith("start") ? "start" : "end";
      const x = align === "start" ? rect.left : rect.right;
      if (preferAbove) {
        openAt(
          x,
          rect.top - TRIGGER_MENU_GAP,
          {
            align,
            vertical: "above",
            flipDownAlignTopY: rect.bottom + TRIGGER_MENU_GAP,
          },
          openOptions,
        );
        return;
      }
      openAt(x, rect.bottom + TRIGGER_MENU_GAP, { align }, openOptions);
    },
    [openAt, triggerPlacement],
  );

  const toggleFromTrigger = useCallback(
    (el: HTMLElement | null, openOptions?: OpenContextMenuOptions) => {
      if (!el) return;
      if (menuAnchor) {
        closeMenu();
        return;
      }
      openFromTrigger(el, openOptions);
    },
    [menuAnchor, closeMenu, openFromTrigger],
  );

  useLayoutEffect(() => {
    if (!menuAnchor || !menuRef.current) return;
    const { width, height } = menuRef.current.getBoundingClientRect();
    setMenuPosition(
      fitContextMenuPosition(
        menuAnchor.x,
        menuAnchor.y,
        width,
        height,
        menuAnchor.fitOptions,
      ),
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
    const onScroll = (e: Event) => {
      const target = e.target;
      if (!(target instanceof Node)) {
        closeMenu();
        return;
      }
      // Submenus portal outside menuRef; treat them like pointerdown excludes.
      if (menuRef.current?.contains(target)) return;
      if (
        dismissExcludeRefsRef.current.some((ref) =>
          ref.current?.contains(target),
        )
      ) {
        return;
      }
      if (
        target instanceof Element &&
        target.closest(`[${CONTEXT_MENU_IGNORE_SCROLL_ATTR}]`)
      ) {
        return;
      }
      closeMenu();
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    if (closeOnScroll) {
      window.addEventListener("scroll", onScroll, true);
    }
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
      if (closeOnScroll) {
        window.removeEventListener("scroll", onScroll, true);
      }
    };
  }, [menuAnchor, closeMenu, closeOnScroll]);

  return {
    open: menuAnchor != null,
    anchor: menuAnchor,
    position: menuPosition,
    menuRef,
    openedWithKeyboard: menuAnchor?.keyboard === true,
    onContextMenu,
    closeMenu,
    openAt,
    openFromTrigger,
    toggleFromTrigger,
  };
}
