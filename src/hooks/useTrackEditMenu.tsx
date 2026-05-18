import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import { createPortal } from "react-dom";
import { RemoveTrackDialog } from "../components/RemoveTrackDialog/RemoveTrackDialog";
import "../components/TrackRowMenu/TrackRowMenu.css";
import {
  IconAddToQueue,
  IconDelete,
  IconEditInfo,
  IconRemoveFromQueue,
} from "../components/icons";
import { fitContextMenuPosition } from "../lib/contextMenuPosition";
import { panelMotion } from "../lib/motion";
import { tracksForContextAction } from "../lib/trackSelection";
import { usePlayerStore } from "../store/usePlayerStore";
import type { Track } from "../types/track";

function ContextMenuItem({
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
      <span className="track-row-menu__item-icon" aria-hidden>
        {icon}
      </span>
      <span className="track-row-menu__item-label">{label}</span>
    </button>
  );
}

export function useTrackEditMenu(track: Track) {
  const library = usePlayerStore((s) => s.library);
  const selectedTrackIds = usePlayerStore((s) => s.selectedTrackIds);
  const manualQueueIds = usePlayerStore((s) => s.manualQueueIds);
  const openTrackEditor = usePlayerStore((s) => s.openTrackEditor);
  const addToQueue = usePlayerStore((s) => s.addToQueue);
  const removeFromQueue = usePlayerStore((s) => s.removeFromQueue);
  const removeTracksFromLibrary = usePlayerStore((s) => s.removeTracksFromLibrary);
  const selectTracksInList = usePlayerStore((s) => s.selectTracksInList);

  const [menuAnchor, setMenuAnchor] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [menuPosition, setMenuPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const [removeDialogOpen, setRemoveDialogOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const libraryIdSet = useMemo(
    () => new Set(library.map((t) => t.id)),
    [library],
  );

  const contextTrackIds = useMemo(
    () => tracksForContextAction(track.id, selectedTrackIds, libraryIdSet),
    [track.id, selectedTrackIds, libraryIdSet],
  );

  const contextTracks = useMemo(
    () =>
      contextTrackIds
        .map((id) => library.find((t) => t.id === id))
        .filter((t): t is Track => t != null),
    [contextTrackIds, library],
  );

  const anyInQueue = contextTrackIds.some((id) => manualQueueIds.includes(id));
  const bulkRemove = contextTracks.length > 1;

  const openEditor = useCallback(() => {
    setMenuAnchor(null);
    setMenuPosition(null);
    openTrackEditor(contextTrackIds);
  }, [openTrackEditor, contextTrackIds]);

  const closeMenu = useCallback(() => {
    setMenuAnchor(null);
    setMenuPosition(null);
  }, []);

  const onContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!selectedTrackIds.includes(track.id)) {
        selectTracksInList(track.id, [track.id], {
          shiftKey: false,
          metaKey: false,
        });
      }
      setMenuPosition(null);
      setMenuAnchor({ x: e.clientX, y: e.clientY });
    },
    [selectTracksInList, selectedTrackIds, track.id],
  );

  useLayoutEffect(() => {
    if (!menuAnchor || !menuRef.current) return;
    const { width, height } = menuRef.current.getBoundingClientRect();
    setMenuPosition(
      fitContextMenuPosition(menuAnchor.x, menuAnchor.y, width, height),
    );
  }, [menuAnchor, anyInQueue, bulkRemove, contextTracks.length]);

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
              label={
                bulkRemove
                  ? `Edit Info (${contextTracks.length})`
                  : "Edit Info"
              }
              onClick={openEditor}
            />
            <ContextMenuItem
              icon={<IconAddToQueue />}
              label={
                bulkRemove
                  ? `Add ${contextTracks.length} to Queue`
                  : "Add to Queue"
              }
              onClick={() => {
                closeMenu();
                addToQueue(contextTrackIds);
              }}
            />
            {anyInQueue ? (
              <ContextMenuItem
                icon={<IconRemoveFromQueue />}
                label={
                  bulkRemove
                    ? `Remove ${contextTracks.length} from Queue`
                    : "Remove from Queue"
                }
                onClick={() => {
                  closeMenu();
                  for (const id of contextTrackIds) {
                    if (manualQueueIds.includes(id)) removeFromQueue(id);
                  }
                }}
              />
            ) : null}
            <div className="track-row-menu__separator" role="separator" />
            <ContextMenuItem
              icon={<IconDelete />}
              label={
                bulkRemove
                  ? `Remove ${contextTracks.length} from Library`
                  : "Remove from Library"
              }
              className="track-row-menu__danger"
              onClick={() => {
                closeMenu();
                setRemoveDialogOpen(true);
              }}
            />
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );

  const removeDialog = createPortal(
    <RemoveTrackDialog
      open={removeDialogOpen}
      tracks={contextTracks}
      onClose={() => setRemoveDialogOpen(false)}
      onRemove={(deleteFromDisk) =>
        removeTracksFromLibrary(
          contextTracks.map((t) => t.id),
          deleteFromDisk,
        )
      }
    />,
    document.body,
  );

  return { onContextMenu, contextMenu, removeDialog };
}
