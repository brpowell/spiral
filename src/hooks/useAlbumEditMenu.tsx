import { useCallback, useMemo } from "react";
import {
  ContextMenu,
  ContextMenuItem,
} from "../components/ContextMenu/ContextMenu";
import {
  IconAddToQueue,
  IconConvert,
  IconEditInfo,
  IconRemoveFromQueue,
} from "../components/icons";
import { openConvertForTrackIds } from "../lib/convertTracks";
import { isTrackConvertible } from "../lib/pendingImportTrack";
import { usePlayerStore } from "../store/usePlayerStore";
import type { Album } from "../types/album";
import { useContextMenu } from "./useContextMenu";

export function useAlbumEditMenu(album: Album) {
  const manualQueueIds = usePlayerStore((s) => s.manualQueueIds);
  const openAlbumEditor = usePlayerStore((s) => s.openAlbumEditor);
  const addToQueue = usePlayerStore((s) => s.addToQueue);
  const removeFromQueue = usePlayerStore((s) => s.removeFromQueue);

  const albumTrackIds = useMemo(
    () => album.tracks.map((t) => t.id),
    [album.tracks],
  );

  const anyInQueue = albumTrackIds.some((id) => manualQueueIds.includes(id));
  const trackCount = album.tracks.length;
  const convertibleCount = album.tracks.filter((track) =>
    isTrackConvertible(track),
  ).length;

  const { onContextMenu, closeMenu, open, anchor, position, menuRef } =
    useContextMenu({
      layoutDeps: [anyInQueue, trackCount, convertibleCount],
    });

  const openEditor = useCallback(() => {
    closeMenu();
    openAlbumEditor(album.key);
  }, [closeMenu, openAlbumEditor, album.key]);

  const contextMenu = (
    <ContextMenu
      open={open}
      anchor={anchor}
      position={position}
      menuRef={menuRef}
    >
      <ContextMenuItem
        icon={<IconEditInfo />}
        label="Edit Album"
        onClick={openEditor}
      />
      {trackCount > 0 ? (
        <ContextMenuItem
          icon={<IconAddToQueue />}
          label={
            trackCount > 1 ? `Add ${trackCount} to Queue` : "Add to Queue"
          }
          onClick={() => {
            closeMenu();
            addToQueue(albumTrackIds);
          }}
        />
      ) : null}
      {anyInQueue ? (
        <ContextMenuItem
          icon={<IconRemoveFromQueue />}
          label={
            trackCount > 1
              ? `Remove ${trackCount} from Queue`
              : "Remove from Queue"
          }
          onClick={() => {
            closeMenu();
            for (const id of albumTrackIds) {
              if (manualQueueIds.includes(id)) removeFromQueue(id);
            }
          }}
        />
      ) : null}
      {convertibleCount > 0 ? (
        <ContextMenuItem
          icon={<IconConvert />}
          label={
            convertibleCount > 1
              ? `Convert ${convertibleCount} Tracks…`
              : "Convert Album…"
          }
          onClick={() => {
            closeMenu();
            openConvertForTrackIds(albumTrackIds);
          }}
        />
      ) : null}
    </ContextMenu>
  );

  return { onContextMenu, openEditor, contextMenu };
}
