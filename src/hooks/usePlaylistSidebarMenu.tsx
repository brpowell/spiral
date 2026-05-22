import { useCallback } from "react";
import {
  ContextMenu,
  ContextMenuItem,
  ContextMenuSeparator,
} from "../components/ContextMenu/ContextMenu";
import { IconDelete, IconEditInfo } from "../components/icons";
import { usePlaylistStore } from "../store/usePlaylistStore";
import type { Playlist } from "../types/playlist";
import { useContextMenu } from "./useContextMenu";
import { useDeletePlaylistDialog } from "./useDeletePlaylistDialog";

export function usePlaylistSidebarMenu(playlist: Playlist) {
  const openPlaylistEditor = usePlaylistStore((s) => s.openPlaylistEditor);
  const { requestDelete, deleteDialog } = useDeletePlaylistDialog(playlist);

  const { onContextMenu, closeMenu, open, anchor, position, menuRef } =
    useContextMenu();

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
