import { useCallback, useMemo } from "react";
import {
  ContextMenu,
  ContextMenuItem,
  ContextMenuSeparator,
} from "../components/ContextMenu/ContextMenu";
import { IconAddToQueue, IconDelete, IconEditInfo } from "../components/icons";
import { resolvePlaylistTracks } from "../lib/playlists";
import { usePlayerStore } from "../store/usePlayerStore";
import { usePlaylistStore } from "../store/usePlaylistStore";
import type { Playlist } from "../types/playlist";
import { useContextMenu } from "./useContextMenu";
import { useDeletePlaylistDialog } from "./useDeletePlaylistDialog";

export function usePlaylistSidebarMenu(playlist: Playlist) {
  const library = usePlayerStore((s) => s.library);
  const addToQueue = usePlayerStore((s) => s.addToQueue);
  const openPlaylistEditor = usePlaylistStore((s) => s.openPlaylistEditor);
  const { requestDelete, deleteDialog } = useDeletePlaylistDialog(playlist);

  const tracks = useMemo(
    () => resolvePlaylistTracks(playlist, library),
    [playlist, library],
  );
  const trackIds = useMemo(() => tracks.map((t) => t.id), [tracks]);

  const { onContextMenu, closeMenu, open, anchor, position, menuRef } =
    useContextMenu({ layoutDeps: [trackIds.length] });

  const openEditor = useCallback(() => {
    closeMenu();
    openPlaylistEditor(playlist.id);
  }, [closeMenu, openPlaylistEditor, playlist.id]);

  const openDelete = useCallback(() => {
    closeMenu();
    requestDelete();
  }, [closeMenu, requestDelete]);

  const contextMenu = (
    <ContextMenu
      open={open}
      anchor={anchor}
      position={position}
      menuRef={menuRef}
    >
      <ContextMenuItem
        icon={<IconEditInfo />}
        label="Edit"
        onClick={openEditor}
      />
      {trackIds.length > 0 ? (
        <ContextMenuItem
          icon={<IconAddToQueue />}
          label="Add to Queue"
          onClick={() => {
            closeMenu();
            addToQueue(trackIds);
          }}
        />
      ) : null}
      <ContextMenuSeparator />
      <ContextMenuItem
        icon={<IconDelete />}
        label="Delete"
        className="context-menu__danger"
        onClick={openDelete}
      />
    </ContextMenu>
  );

  return { onContextMenu, contextMenu, deleteDialog };
}
