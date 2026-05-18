import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import { createPortal } from "react-dom";
import "../components/TrackRowMenu/TrackRowMenu.css";
import { IconEditInfo } from "../components/icons";
import { fitContextMenuPosition } from "../lib/contextMenuPosition";
import { panelMotion } from "../lib/motion";
import { usePlayerStore } from "../store/usePlayerStore";
import type { Album } from "../types/album";

function ContextMenuItem({
  icon,
  label,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button type="button" role="menuitem" onClick={onClick}>
      <span className="track-row-menu__item-icon" aria-hidden>
        {icon}
      </span>
      <span className="track-row-menu__item-label">{label}</span>
    </button>
  );
}

export function useAlbumEditMenu(album: Album) {
  const openAlbumEditor = usePlayerStore((s) => s.openAlbumEditor);

  const [menuAnchor, setMenuAnchor] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [menuPosition, setMenuPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const openEditor = useCallback(() => {
    setMenuAnchor(null);
    setMenuPosition(null);
    openAlbumEditor(album.key);
  }, [openAlbumEditor, album.key]);

  const closeMenu = useCallback(() => {
    setMenuAnchor(null);
    setMenuPosition(null);
  }, []);

  const onContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setMenuPosition(null);
    setMenuAnchor({ x: e.clientX, y: e.clientY });
  }, []);

  useLayoutEffect(() => {
    if (!menuAnchor || !menuRef.current) return;
    const { width, height } = menuRef.current.getBoundingClientRect();
    setMenuPosition(
      fitContextMenuPosition(menuAnchor.x, menuAnchor.y, width, height),
    );
  }, [menuAnchor]);

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

  const contextMenu = createPortal(
    <AnimatePresence>
      {menuAnchor != null && (
        <motion.div
          ref={menuRef}
          className="track-row-menu__popup"
          style={{
            left: menuPosition?.left ?? menuAnchor.x,
            top: menuPosition?.top ?? menuAnchor.y,
            transformOrigin: "0 0",
            pointerEvents: menuPosition == null ? "none" : undefined,
          }}
          role="menu"
          initial={panelMotion.initial}
          animate={menuPosition ? panelMotion.animate : panelMotion.initial}
          exit={panelMotion.exit}
          transition={panelMotion.transition}
        >
          <ContextMenuItem
            icon={<IconEditInfo />}
            label="Edit Album"
            onClick={openEditor}
          />
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );

  return { onContextMenu, openEditor, contextMenu };
}
