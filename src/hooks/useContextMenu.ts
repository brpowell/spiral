import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { fitContextMenuPosition } from "../lib/contextMenuPosition";

export interface UseContextMenuOptions {
  /** Re-run viewport fit when menu content size may change */
  layoutDeps?: unknown[];
  /** Called when menu opens, after preventDefault/stopPropagation */
  onBeforeOpen?: (e: React.MouseEvent) => void;
}

export function useContextMenu(options: UseContextMenuOptions = {}) {
  const { layoutDeps = [], onBeforeOpen } = options;

  const [menuAnchor, setMenuAnchor] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [menuPosition, setMenuPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

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
      closeMenu();
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("scroll", closeMenu, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
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
  };
}
