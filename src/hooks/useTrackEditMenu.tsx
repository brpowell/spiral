import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { RemoveTrackDialog } from "../components/RemoveTrackDialog/RemoveTrackDialog";
import "../components/TrackRowMenu/TrackRowMenu.css";
import { tracksForContextAction } from "../lib/trackSelection";
import { usePlayerStore } from "../store/usePlayerStore";
import type { Track } from "../types/track";

export function useTrackEditMenu(track: Track) {
  const library = usePlayerStore((s) => s.library);
  const selectedTrackIds = usePlayerStore((s) => s.selectedTrackIds);
  const manualQueueIds = usePlayerStore((s) => s.manualQueueIds);
  const openTrackEditor = usePlayerStore((s) => s.openTrackEditor);
  const addToQueue = usePlayerStore((s) => s.addToQueue);
  const removeFromQueue = usePlayerStore((s) => s.removeFromQueue);
  const removeTracksFromLibrary = usePlayerStore((s) => s.removeTracksFromLibrary);
  const selectTracksInList = usePlayerStore((s) => s.selectTracksInList);

  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
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
    setMenu(null);
    openTrackEditor(track.id);
  }, [openTrackEditor, track.id]);

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
      setMenu({ x: e.clientX, y: e.clientY });
    },
    [selectTracksInList, selectedTrackIds, track.id],
  );

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onPointerDown = (e: PointerEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      close();
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("scroll", close, true);
    };
  }, [menu]);

  const contextMenu =
    menu != null
      ? createPortal(
          <div
            ref={menuRef}
            className="track-row-menu__popup"
            style={{ left: menu.x, top: menu.y }}
            role="menu"
          >
            <button type="button" role="menuitem" onClick={openEditor}>
              Edit Info
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenu(null);
                addToQueue(contextTrackIds);
              }}
            >
              {bulkRemove ? `Add ${contextTracks.length} to Queue` : "Add to Queue"}
            </button>
            {anyInQueue ? (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenu(null);
                  for (const id of contextTrackIds) {
                    if (manualQueueIds.includes(id)) removeFromQueue(id);
                  }
                }}
              >
                {bulkRemove
                  ? `Remove ${contextTracks.length} from Queue`
                  : "Remove from Queue"}
              </button>
            ) : null}
            <button
              type="button"
              role="menuitem"
              className="track-row-menu__danger"
              onClick={() => {
                setMenu(null);
                setRemoveDialogOpen(true);
              }}
            >
              {bulkRemove
                ? `Remove ${contextTracks.length} from Library`
                : "Remove from Library"}
            </button>
          </div>,
          document.body,
        )
      : null;

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

  return { onContextMenu, openEditor, contextMenu, removeDialog };
}
